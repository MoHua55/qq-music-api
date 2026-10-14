import { logger } from '../../util/logger';
import { type AndroidDevice, buildQimeiRequest, QIMEI_URL } from './androidDevice';
import { Buffer } from './bytes';
import type { AuthHttpClient } from './httpClient';
import { callMusicu, QqDeviceBootstrapError } from './musicuProtocol';
import {
  type Dictionary,
  dictionaryOf,
  identifierOf,
  numberOf,
  parseDictionary,
  stringOf,
} from './values';

// src/services/auth/bootstrap.ts
// 从认证入口搬出的同一套实现；协议、状态与对外回包沿用原规则。

export const QIMEI_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * QIMEI rejects a request whose signed timestamp is more than about five minutes away from the
 * server clock (HTTP 200, outer code -30000). A rejection on a local clock that is off by more
 * than this is retried once, signed with the server's time instead. The `Date` header only has
 * second precision, so anything below a minute is treated as an accurate clock.
 */
export const QIMEI_CLOCK_SKEW_RETRY_MS = 60 * 1000;

export const buildQimeiHeadersAndBody = async (
  device: AndroidDevice,
  signedAt: Date = new Date(),
): Promise<{ headers: Record<string, string>; body: Dictionary }> => {
  const request = await buildQimeiRequest(device, signedAt);
  const rawHeaders = dictionaryOf(request.headers);
  const headers = Object.fromEntries(
    Object.entries(rawHeaders).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
  return { headers, body: dictionaryOf(request.body) };
};

/** Server time minus `sentAt`, from the response `Date` header; undefined when there is none. */
const serverClockSkewMs = (headers: unknown, sentAt: number): number | undefined => {
  const date = dictionaryOf(headers).date;
  const serverAt = typeof date === 'string' ? Date.parse(date) : Number.NaN;
  return Number.isFinite(serverAt) ? serverAt - sentAt : undefined;
};

/** One QIMEI round trip signed at `signedAt`, logged at code/type/length granularity. */
const requestQimei = async (
  http: AuthHttpClient,
  device: AndroidDevice,
  sentAt: number,
  signedAt: number,
) => {
  const request = await buildQimeiHeadersAndBody(device, new Date(signedAt));
  const response = await http.post<unknown>(QIMEI_URL, request.body, { headers: request.headers });
  const outer = parseDictionary(response.data);
  const inner = parseDictionary(outer.data);
  const data = dictionaryOf(inner.data);
  const result = {
    httpStatus: response.status,
    qimei: stringOf(data.q16),
    qimei36: stringOf(data.q36),
    outerCode: numberOf(outer.code),
    innerCode: numberOf(inner.code),
    clockSkewMs: serverClockSkewMs(response.headers, sentAt),
  };
  logger.info('qq-auth.qimei-result', {
    source: 'upstream',
    httpStatus: result.httpStatus,
    outerCode: result.outerCode,
    outerDataType: typeof outer.data,
    innerCode: result.innerCode,
    q16Length: result.qimei.length,
    q36Length: result.qimei36.length,
    signedWith: signedAt === sentAt ? 'local-clock' : 'server-clock',
    clockSkewSec:
      result.clockSkewMs === undefined ? undefined : Math.round(result.clockSkewMs / 1000),
  });
  return result;
};

/**
 * Reuses the stored QIMEI while it is fresh and returns whether the device context changed.
 * Diagnostics stay at code/type/length granularity: raw bodies and identifiers never leave
 * this function.
 *
 * A rejection while the local clock is off from the server's by more than
 * `QIMEI_CLOCK_SKEW_RETRY_MS` is retried once with the server's time. Nothing about the skew
 * is stored: the QIMEI it buys is cached for a day, so the next bootstrap pays the retry again
 * at most once a day.
 */
export const ensureQimei = async (
  http: AuthHttpClient,
  device: AndroidDevice,
  now: number,
): Promise<boolean> => {
  const fresh =
    device.qimei &&
    device.qimei36 &&
    device.qimeiSavedAt &&
    now - device.qimeiSavedAt < QIMEI_TTL_MS;
  if (fresh) {
    logger.info('qq-auth.qimei-result', { source: 'cache' });
    return false;
  }
  let result = await requestQimei(http, device, now, now);
  const rejected = !result.qimei || !result.qimei36;
  const skewMs = result.clockSkewMs;
  if (rejected && skewMs !== undefined && Math.abs(skewMs) > QIMEI_CLOCK_SKEW_RETRY_MS) {
    result = await requestQimei(http, device, now, now + skewMs);
  }
  if (!result.qimei || !result.qimei36)
    throw new QqDeviceBootstrapError(result.httpStatus, result.outerCode, result.innerCode);
  device.qimei = result.qimei;
  device.qimei36 = result.qimei36;
  device.qimeiSavedAt = now;
  return true;
};

export const refreshAndroidSession = async (
  http: AuthHttpClient,
  device: AndroidDevice,
): Promise<void> => {
  const data = await callMusicu(
    http,
    device,
    'get-session',
    'music.getSession.session',
    'GetSession',
    {
      uid: device.sessionUid ?? '',
      vkey: 0,
      caller: 0,
    },
  );
  const session = dictionaryOf(data.session);
  const uid = identifierOf(session.uid);
  const sid = identifierOf(session.sid);
  if (!uid || !sid) throw new Error('GetSession response missing uid/sid');
  device.sessionUid = uid;
  device.sessionSid = sid;
  device.sessionVkey = session.vkey;
};

export const createNativeQr = async (http: AuthHttpClient, device: AndroidDevice) => {
  const data = await callMusicu(
    http,
    device,
    'create-qr',
    'music.login.LoginServer',
    'CreateQRCode',
    {
      tmeAppID: 'qqmusic',
      ct: 11,
      cv: 14090008,
    },
    undefined,
    { ct: 23, cv: 0 },
  );
  const qrcodeId = stringOf(data.qrcodeID);
  const encoded = stringOf(data.qrcode).split(',').at(-1) ?? '';
  const image = Buffer.from(encoded, 'base64');
  if (!qrcodeId || image.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error('CreateQRCode response missing a valid PNG/qrcodeID');
  }
  return {
    qrcodeId,
    imageUrl: `data:image/png;base64,${image.toString('base64')}`,
    expiresIn: numberOf(data.expiresIn),
  };
};
