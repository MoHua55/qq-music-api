import { logger } from '../../util/logger';
import { type AndroidDevice, buildQimeiRequest, QIMEI_URL } from './androidDevice';
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

export const buildQimeiHeadersAndBody = async (
  device: AndroidDevice,
): Promise<{ headers: Record<string, string>; body: Dictionary }> => {
  const request = await buildQimeiRequest(device);
  const rawHeaders = dictionaryOf(request.headers);
  const headers = Object.fromEntries(
    Object.entries(rawHeaders).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
  return { headers, body: dictionaryOf(request.body) };
};

/**
 * Reuses the stored QIMEI while it is fresh and returns whether the device context changed.
 * Diagnostics stay at code/type/length granularity: raw bodies and identifiers never leave
 * this function.
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
  const request = await buildQimeiHeadersAndBody(device);
  const response = await http.post<unknown>(QIMEI_URL, request.body, { headers: request.headers });
  const outer = parseDictionary(response.data);
  const inner = parseDictionary(outer.data);
  const data = dictionaryOf(inner.data);
  const qimei = stringOf(data.q16);
  const qimei36 = stringOf(data.q36);
  const outerCode = numberOf(outer.code);
  const innerCode = numberOf(inner.code);
  logger.info('qq-auth.qimei-result', {
    source: 'upstream',
    httpStatus: response.status,
    outerCode,
    outerDataType: typeof outer.data,
    innerCode,
    q16Length: qimei.length,
    q36Length: qimei36.length,
  });
  if (!qimei || !qimei36) throw new QqDeviceBootstrapError(response.status, outerCode, innerCode);
  device.qimei = qimei;
  device.qimei36 = qimei36;
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
