// src/protocol/loginHints.ts
//
// 扫码登录失败时给使用者看的原因（`failureHint`）。只从已经验证过的诊断字段推，不改任何原有字段。
// 手机 QQ 换凭证失败后会用扫码票据再验证一次，真正的原因在 `primaryFailure`，所以先看它再看顶层。
// 「扫错 App」没有受控实验，文案写成建议而不是断言。文案是英文预设，前端可以按 key 换成自己的。
// 零依赖，两个运行时共用。

export type LoginHintKey =
  | 'login.device-limit'
  | 'login.wrong-scan-app'
  | 'login.rate-limited'
  | 'login.account-restricted'
  | 'login.account-banned'
  | 'login.account-binding'
  | 'login.rejected';

export interface LoginHint {
  key: LoginHintKey;
  message: string;
}

export const LOGIN_HINT_MESSAGES: Readonly<Record<LoginHintKey, string>> = {
  'login.device-limit':
    'This account has reached its login device limit. Remove an old device in the QQ Music app, then try again.',
  'login.wrong-scan-app':
    'If you scanned with the QQ Music app, choose QQ Music app login instead, or scan this code with the mobile QQ app.',
  'login.rate-limited': 'Too many login attempts. Wait a moment and try again.',
  'login.account-restricted': 'This account is restricted and cannot log in right now.',
  'login.account-banned': 'This account has been banned.',
  'login.account-binding':
    'There is a problem with how this account is linked. Check it in the QQ Music app.',
  'login.rejected': 'QQ Music rejected this login. Please try again.',
};

const DEVICE_LIMIT_CODE = 20279;
const RATE_LIMITED_CODE = 104604;
/** 手机 QQ 换凭证时实测见过的码（用 QQ 音乐 App 扫码时出现），含义没有受控验证。 */
const WRONG_SCAN_APP_CODE = 50006;

const BY_ERROR_KEY: Readonly<Record<string, LoginHintKey>> = {
  'auth.device-limit': 'login.device-limit',
  'auth.rate-limited': 'login.rate-limited',
  'auth.account-restricted': 'login.account-restricted',
  'auth.account-banned': 'login.account-banned',
  'auth.account-binding': 'login.account-binding',
  'auth.login-rejected': 'login.rejected',
};

export interface LoginHintInput {
  upstreamCode?: number;
  upstreamErrorKey?: string;
  upstreamHttpStatus?: number;
  primaryFailure?: { upstreamCode?: number; upstreamErrorKey?: string };
  fallbackAttempted?: true;
}

const hint = (key: LoginHintKey): LoginHint => ({ key, message: LOGIN_HINT_MESSAGES[key] });

const byCodeOrKey = (code: number | undefined, errorKey: string | undefined) => {
  if (code === DEVICE_LIMIT_CODE) return hint('login.device-limit');
  if (code === RATE_LIMITED_CODE) return hint('login.rate-limited');
  const key = errorKey === undefined ? undefined : BY_ERROR_KEY[errorKey];
  return key === undefined ? undefined : hint(key);
};

/** 认不出的失败（取消、过期、网络、未知码）不给提示。 */
export const loginFailureHintOf = (details: LoginHintInput): LoginHint | undefined => {
  const primary = details.primaryFailure;
  if (primary) {
    const fromPrimary = byCodeOrKey(primary.upstreamCode, primary.upstreamErrorKey);
    if (fromPrimary) return fromPrimary;
    if (details.fallbackAttempted === true && primary.upstreamCode === WRONG_SCAN_APP_CODE)
      return hint('login.wrong-scan-app');
  }
  if (details.upstreamHttpStatus === 429) return hint('login.rate-limited');
  // 上游 HTTP 本身失败时，单项码不可信。
  if (details.upstreamHttpStatus !== undefined && details.upstreamHttpStatus >= 400)
    return undefined;
  return byCodeOrKey(details.upstreamCode, details.upstreamErrorKey);
};
