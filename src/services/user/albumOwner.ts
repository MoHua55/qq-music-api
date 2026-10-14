import { QqApiError } from '../../protocol/errors';

/** 只处理专辑 owner；不从已经失真的 number 回建账号，也不改变其他接口的 uin。 */
export const albumOwnerOf = (credential: { musicid?: unknown; str_musicid?: unknown }) => {
  const stringId = typeof credential.str_musicid === 'string' ? credential.str_musicid.trim() : '';
  const value = stringId && stringId !== '0' ? stringId : credential.musicid;
  let uin: string;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new QqApiError('invalid-response');
    uin = String(value);
  } else if (typeof value === 'string') uin = value.trim();
  else throw new QqApiError('invalid-response');
  if (!/^\d{1,19}$/.test(uin) || BigInt(uin) === 0n) throw new QqApiError('invalid-response');
  const exact = BigInt(uin);
  // 仅已证明安全的值转 number，保持既有协议；超范围字符串的上游接受度仍待验证。
  return { uin, statusUin: exact <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(exact) : uin };
};
