import { logger } from '../../util/logger';
import type { UpstreamPhase } from '../../util/safeError';
import { type AndroidDevice, buildAndroidComm } from './androidDevice';
import type { AuthHttpClient } from './httpClient';
import { type QqCredential, type QrFailureDiagnostics } from './qrTypes';
import { type Dictionary, dictionaryOf, identifierOf, numberOf } from './values';

// src/services/auth/musicuProtocol.ts
// 从认证入口搬出的同一套实现；协议、状态与对外回包沿用原规则。

export const MUSICU_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg';

export class QrLoginServiceError extends Error {
  public constructor(
    message: string,
    public readonly httpStatus: number,
    public readonly retryAfterMs?: number,
    public readonly upstreamCode?: number,
    public readonly diagnostics: QrFailureDiagnostics = {},
  ) {
    super(message);
    this.name = 'QrLoginServiceError';
  }
}

/**
 * QIMEI bootstrap rejection. Only the upstream numeric codes are carried; they are opaque
 * security codes and must never be renamed into an official error meaning.
 */
export class QqDeviceBootstrapError extends Error {
  public constructor(
    public readonly httpStatus: number,
    public readonly outerCode: number | undefined,
    public readonly innerCode: number | undefined,
  ) {
    super(
      `QIMEI bootstrap failed (HTTP ${httpStatus}, outer=${outerCode ?? 'unknown'}, inner=${innerCode ?? 'unknown'})`,
    );
    this.name = 'QqDeviceBootstrapError';
  }
}

export class QqProtocolError extends Error {
  public constructor(
    public readonly phase: string,
    public readonly upstreamCode: number | undefined,
    public readonly globalCode: number,
    public readonly httpStatus: number,
  ) {
    super(
      `${phase} failed (HTTP ${httpStatus}, global=${globalCode}, code=${upstreamCode ?? 'unknown'})`,
    );
    this.name = 'QqProtocolError';
  }
}

/** The cookie form of a credential, accepted by both the musicu RPC face and the legacy CGIs. */
export const credentialCookieHeader = (credential: QqCredential): string => {
  const musicid = identifierOf(credential.str_musicid) || String(credential.musicid);
  return [
    `uin=${musicid}`,
    `qqmusic_uin=${musicid}`,
    `qm_keyst=${credential.musickey}`,
    `qqmusic_key=${credential.musickey}`,
  ].join('; ');
};

export const callMusicu = async (
  http: AuthHttpClient,
  device: AndroidDevice,
  phase: UpstreamPhase,
  module: string,
  method: string,
  param: Dictionary,
  credential?: QqCredential,
  overrides: Dictionary = {},
): Promise<Dictionary> => {
  const credentialCookies = credential ? credentialCookieHeader(credential) : '';
  const response = await http.post<unknown>(
    MUSICU_URL,
    {
      comm: buildAndroidComm(device, credential, overrides),
      req_0: { module, method, param },
    },
    {
      headers: {
        'User-Agent': `QQMusic 14090008(android ${device.osRelease})`,
        ...(credentialCookies ? { Cookie: credentialCookies } : {}),
      },
    },
  );
  const body = dictionaryOf(response.data);
  const item = dictionaryOf(body.req_0);
  const globalCode = numberOf(body.code) ?? 0;
  const upstreamCode = numberOf(item.code);
  logger.info('qq-auth.upstream-result', {
    phase,
    httpStatus: response.status,
    globalCode,
    upstreamCode,
  });
  if (!Object.keys(item).length || globalCode !== 0 || (upstreamCode ?? 0) !== 0) {
    throw new QqProtocolError(phase, upstreamCode, globalCode, response.status);
  }
  return dictionaryOf(item.data);
};
