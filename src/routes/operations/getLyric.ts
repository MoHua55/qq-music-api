import getLyric from '../../services/music/getLyric';
import type { OperationHandler } from './types';

// src/routes/operations/getLyric.ts
// 歌词原样转交，回包形状和 Node 的旧控制器一样；重复参数只取第一项。
// 带 trans=1 时，旧接口的翻译是空的才补一次新接口（见 services/music/playLyricTranslation）。
const firstOf = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export const getLyricOperation: OperationHandler = async ({ queryRaw }) => {
  const songmid = firstOf(queryRaw('songmid'));
  const isFormat = firstOf(queryRaw('isFormat'));
  const trans = firstOf(queryRaw('trans'));
  if (!songmid) return { status: 400, headers: {}, body: { response: 'no songmid' } };
  const { status, body } = await getLyric({
    method: 'get',
    params: { songmid },
    isFormat: isFormat === 'true' || isFormat === '1',
    trans: trans === '1',
  });
  return { status, headers: {}, body };
};
