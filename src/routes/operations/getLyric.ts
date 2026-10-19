import getLyric from '../../services/music/getLyric';
import { rawQuery } from './requestValues';
import type { OperationHandler } from './types';

// src/routes/operations/getLyric.ts
// 歌词原样转交，回包形状和以前一样。参数照两边原来的方式读：Node 带重复参数时是数组，
// 原样交给业务；Serverless 只有第一个值。
// 带 trans=1 时，旧接口的翻译是空的才补一次新接口（见 services/music/playLyricTranslation）。
export const getLyricOperation: OperationHandler = async (request) => {
  const songmid = rawQuery(request, 'songmid');
  const isFormat = rawQuery(request, 'isFormat');
  const trans = rawQuery(request, 'trans');
  if (!songmid) return { status: 400, headers: {}, body: { response: 'no songmid' } };
  const { status, body } = await getLyric({
    method: 'get',
    params: { songmid },
    isFormat: isFormat === 'true' || isFormat === '1',
    trans: trans === '1',
  });
  return { status, headers: {}, body };
};
