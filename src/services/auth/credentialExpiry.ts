import { type QqCredential } from './qrTypes';
import { numberOf } from './values';

// src/services/auth/credentialExpiry.ts
// 凭证寿命的计算。会话保存与静默续期都要用，单独放一个不依赖协议调用的模块，免得互相引用。

/** 上游没有交代 musickey 寿命时的兜底会话时长，也是这个常量原本的唯一用途。 */
export const AUTH_TTL_MS = 24 * 60 * 60 * 1000;

/** 推导出来的会话时长夹在这个区间内，挡住上游给出畸形时间时的两个极端。 */
export const AUTH_TTL_MIN_MS = 60 * 60 * 1000;

export const AUTH_TTL_MAX_MS = 7 * 24 * 60 * 60 * 1000;

/** musickey 自己说的到期时间（毫秒）；缺字段或值不合理时是 `null`。 */
export const credentialExpiryAt = (credential: QqCredential): number | null => {
  const createdAtSeconds = numberOf(credential.musickeyCreateTime);
  const lifetimeSeconds = numberOf(credential.keyExpiresIn);
  if (!createdAtSeconds || !lifetimeSeconds || createdAtSeconds <= 0 || lifetimeSeconds <= 0)
    return null;
  return (createdAtSeconds + lifetimeSeconds) * 1000;
};

/**
 * 会话到期时间跟着 musickey 自己的寿命走。
 *
 * 上游的凭证带着 `musickeyCreateTime`（epoch 秒）与 `keyExpiresIn`（秒，实测 259200 = 整三天）。
 * 之前这里硬编 24 小时，比上游短，于是用户每天都得重新扫码——而那并不是 QQ 要求的。缺字段或者值不
 * 合理时退回原来的 24 小时，结果再夹进 `[1 小时, 7 天]`，因此一份畸形的上游回应既不会立刻作废会话，
 * 也不会签发一个远超凭证寿命的会话。
 *
 * 凭证已经过期时算出来的时长是负的，会被夹到 1 小时；那一小时里任何一次上游调用都会被拒绝并映射成
 * 401，客户端照样能干净地登出。
 */
export const authSessionExpiryAt = (credential: QqCredential, now: number): number => {
  const credentialExpiresAt = credentialExpiryAt(credential);
  if (credentialExpiresAt === null) return now + AUTH_TTL_MS;
  const ttl = credentialExpiresAt - now;
  if (ttl < AUTH_TTL_MIN_MS) return now + AUTH_TTL_MIN_MS;
  if (ttl > AUTH_TTL_MAX_MS) return now + AUTH_TTL_MAX_MS;
  return now + ttl;
};
