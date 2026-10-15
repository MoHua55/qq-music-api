import { type AndroidDevice } from './androidDevice';
import type { AuthHttpClient } from './httpClient';
import { callMusicu } from './musicuProtocol';
import { type QqCredential } from './qrTypes';
import { type Dictionary, isDictionary, numberOf, stringOf } from './values';
import { WECHAT_APP_ID, WECHAT_LOGIN_TYPE } from './wechatLogin';

// src/services/auth/credentialWire.ts
// 从认证入口搬出的同一套实现；协议、状态与对外回包沿用原规则。

export const MOBILE_LOGIN_TYPE = 6;

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
 * MQTT channels' exchange. `loginType` is what the comm sends as `tmeLoginType`: mobile QQ and a
 * QQ Music app signed in with a QQ account take 6; an app signed in with WeChat reports 1 in its
 * callback and is only accepted with 1.
 */
export const exchangeCredential = async (
  http: AuthHttpClient,
  device: AndroidDevice,
  qrcodeId: string,
  musicid: string,
  token: string,
  loginType: number = MOBILE_LOGIN_TYPE,
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
      { tmeLoginType: loginType },
    ),
    loginType,
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
