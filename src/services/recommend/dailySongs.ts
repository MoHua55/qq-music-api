import { QqApiError } from '../../protocol/errors';
import type { MusicuDescriptor } from '../../protocol/musicu';
import { isDictionary } from '../../util/values';
import type { AuthSession } from '../auth/qrLogin';
import { failureResult, type NewRouteResult, okResult } from './newRouteResult';
import { createSessionMusicuClient, type SessionMusicuOptions } from './sessionMusicu';

// src/services/recommend/dailySongs.ts
//
// `/user/daily-songs`：每日 30 首。Node 与 serverless 共用。
// 实测（2026-10，手机 QQ 与微信各一个账号）：每日 30 首是账号自己的系统目录 202，带凭证按目录读就能拿到
// 当天的 30 首，收藏与否结果一样；按歌单 id 读在部分账号只回几首，所以不用。回应里的歌单 id 不可靠，不回传。

interface DailySongsData {
  songs: unknown[];
}

const decode = (data: unknown): DailySongsData => {
  if (!isDictionary(data)) throw new QqApiError('invalid-response');
  // 实测成功时内层 code、subcode 都是 0；非 0 的意思没有分离，不当成功也不当凭证失效。
  if (data.code !== undefined && data.code !== 0) throw new QqApiError('invalid-response');
  const { songlist } = data;
  if (songlist !== null && songlist !== undefined && !Array.isArray(songlist))
    throw new QqApiError('invalid-response');
  return { songs: Array.isArray(songlist) ? songlist : [] };
};

export const DAILY_SONGS: MusicuDescriptor<DailySongsData> = {
  module: 'music.srfDissInfo.aiDissInfo',
  method: 'uniform_get_Dissinfo',
  param: { dirid: 202, optype: 3, tag: 1, userinfo: 0, pic_dpi: 300 },
  readOnly: true,
  operation: 'recommend.daily-songs',
  decode,
};

/** 没有会话回 401；上游成功但没有歌回 422。歌曲条目原样交出去，由前端自己正规化。 */
export const dailySongsResult = async (
  session: AuthSession | null,
  options: SessionMusicuOptions = {},
): Promise<NewRouteResult> => {
  try {
    if (!session) throw new QqApiError('auth-missing');
    const data = await createSessionMusicuClient(session, options).execute(DAILY_SONGS);
    if (!data.songs.length) throw new QqApiError('not-found');
    return okResult({ songs: data.songs });
  } catch (error) {
    return failureResult('get-daily-songs', error);
  }
};
