import { type AndroidDevice } from './androidDevice';
import type { AuthHttpClient } from './httpClient';
import { callMusicu, ExactInteger } from './musicuProtocol';
import { type QqCredential } from './qrTypes';
import { type Dictionary, isDictionary, numberOf, stringOf } from './values';
import { WECHAT_APP_ID, WECHAT_LOGIN_TYPE } from './wechatLogin';

// src/services/auth/credentialWire.ts
// 从认证入口搬出的同一套实现；协议、状态与对外回包沿用原规则。

export const MOBILE_LOGIN_TYPE = 6;

/**
 * QQ 音乐 App 通道换凭证时的账号 id。QQ 账号的 id 放得进数字；微信账号是 19 位，超过安全整数。
 * 实测官方客户端送的是不带引号、不失真的整数字面量：`Number()` 会变成另一个账号（50006），
 * 送字符串会被拒（10006），所以长 id 用 `ExactInteger` 原样写进请求体。
 */
export const exchangeMusicIdOf = (musicid: string): number | string | ExactInteger => {
  if (!/^\d{1,19}$/.test(musicid)) return musicid;
  return BigInt(musicid) <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(musicid)
    : new ExactInteger(musicid);
};

export const credentialFrom = (value: Dictionary, defaultLoginType: number): QqCredential => {
  const musicid = value.musicid ?? value.str_musicid;
  const musickey = stringOf(value.musickey);
  if ((!stringOf(musicid) && typeof musicid !== 'number') || !musickey)
    throw new Error('Login response missing credential');
  return {
    ...value,
    musicid: musicid as string | number,
    musickey,
    // The channel that produced the credential is the fallback, never a fixed 6: a WeChat
    // credential sent back with `tmeLoginType: 6` would be rejected on every later request.
    loginType: numberOf(value.loginType) ?? defaultLoginType,
  };
};

export const PRIVATE_RESPONSE_KEYS = new Set([
  'musickey',
  'authst',
  'qqmusic_key',
  'token',
  'qimei',
  'qimei36',
  'sid',
  'vkey',
]);

export const sanitizePublicValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sanitizePublicValue);
  if (!isDictionary(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !PRIVATE_RESPONSE_KEYS.has(key.toLowerCase()))
      .map(([key, item]) => [key, sanitizePublicValue(item)]),
  );
};

/**
 * 手机 QQ 通道换凭证，照 3.3.1 送数字。QQ 账号的 id 不会超过安全整数；微信账号的 App 扫到这张码时 id 会失真，
 * 上游回 50006，前端据此提示改用 QQ 音乐 App 登录，所以这里不改。
 */
export const exchangeCredential = async (
  http: AuthHttpClient,
  device: AndroidDevice,
  qrcodeId: string,
  musicid: string,
  token: string,
): Promise<QqCredential> =>
  credentialFrom(
    await callMusicu(
      http,
      device,
      'credential-exchange',
      'music.login.LoginServer',
      'Login',
      { musicid: Number(musicid), qrCodeID: qrcodeId, token },
      undefined,
      { tmeLoginType: MOBILE_LOGIN_TYPE },
    ),
    MOBILE_LOGIN_TYPE,
  );

/**
 * QQ 音乐 App 通道换凭证，照官方客户端的实测：不管 App 登的是 QQ 还是微信账号，comm 一律送 6，
 * 账号 id 原样送（见 `exchangeMusicIdOf`）。账号类型以回包的 `loginType` 为准，回包没给才用回调里的；
 * 之后的请求要照这个类型送，微信账号是 1。
 */
export const exchangeAppCredential = async (
  http: AuthHttpClient,
  device: AndroidDevice,
  qrcodeId: string,
  musicid: string,
  token: string,
  accountLoginType: number,
): Promise<QqCredential> =>
  credentialFrom(
    await callMusicu(
      http,
      device,
      'credential-exchange',
      'music.login.LoginServer',
      'Login',
      { musicid: exchangeMusicIdOf(musicid), qrCodeID: qrcodeId, token },
      undefined,
      { tmeLoginType: MOBILE_LOGIN_TYPE },
    ),
    accountLoginType,
  );

/**
 * WeChat channel exchange: the OAuth `code` from the web flow, not an MQTT token. It runs on
 * the shared device-bound client because it is a musicu call and needs the Android comm; the
 * WeChat endpoints themselves never see that device context.
 */
export const exchangeWechatCredential = async (
  http: AuthHttpClient,
  device: AndroidDevice,
  code: string,
): Promise<QqCredential> =>
  credentialFrom(
    await callMusicu(
      http,
      device,
      'credential-exchange',
      'music.login.LoginServer',
      'Login',
      { code, strAppid: WECHAT_APP_ID },
      undefined,
      { tmeLoginType: WECHAT_LOGIN_TYPE },
    ),
    WECHAT_LOGIN_TYPE,
  );
