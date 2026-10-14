import { QqApiError } from '../../protocol/errors';
import { isDictionary } from '../auth/values';

export const positiveIntegerOf = (value: unknown): number | undefined => {
  const number = typeof value === 'string' && /^\d{1,15}$/.test(value) ? Number(value) : value;
  return typeof number === 'number' && Number.isSafeInteger(number) && number > 0
    ? number
    : undefined;
};
export const exactObjectOf = (value: unknown, keys: readonly string[]): Record<string, unknown> => {
  if (!isDictionary(value) || Object.keys(value).some((key) => !keys.includes(key)))
    throw new QqApiError('input');
  return value;
};
export interface PlaylistSongInput {
  id: number;
  type: number;
}
/** 已确认的曲库输入编码器。以后新增类型需独立验证编码，不沿用读取条目的 type/songtype。 */
const SONG_ENCODERS: ReadonlyMap<number, (id: number) => { songId: number; songType: number }> =
  new Map([[0, (id) => ({ songId: id, songType: 0 })]]);
export const playlistSongOf = (value: unknown) => {
  const input = exactObjectOf(value, ['id', 'type']);
  const id = positiveIntegerOf(input.id);
  const encoder = typeof input.type === 'number' ? SONG_ENCODERS.get(input.type) : undefined;
  if (id === undefined || !encoder) throw new QqApiError('input');
  return encoder(id);
};
