import { QqApiError } from '../../protocol/errors';

/** songid 在这些接口中是安全的正整数；超出精度范围时拒绝，不截断。 */
export const songIdOf = (raw: unknown): number => {
  const text = typeof raw === 'string' ? raw.trim() : '';
  const id = /^\d+$/.test(text) ? Number(text) : Number.NaN;
  if (!Number.isSafeInteger(id) || id <= 0) throw new QqApiError('input');
  return id;
};
