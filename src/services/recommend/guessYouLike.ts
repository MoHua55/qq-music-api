import { QqApiError } from '../../protocol/errors';
import type { MusicuDescriptor } from '../../protocol/musicu';
import type { AuthSession } from '../auth/qrLogin';
import { isDictionary } from '../auth/values';
import { failureResult, type NewRouteResult, okResult } from './newRouteResult';
import { createSessionMusicuClient, type SessionMusicuOptions } from './sessionMusicu';

// src/services/recommend/guessYouLike.ts
//
// `/user/guess-you-like`：QQ 的「猜你喜欢」电台（id 99）。Node 与 serverless 共用。
// 实测（2026-10）：带凭证每次固定回 5 首，条目与 `track_info` 同形；不带凭证回 1000。

interface GuessYouLikeData {
  tracks: unknown[];
  extras?: unknown[];
}

const decode = (data: unknown): GuessYouLikeData => {
  if (!isDictionary(data)) throw new QqApiError('invalid-response');
  const { tracks, extras } = data;
  // 上游没有歌时给的是 null，和空数组同样当作「没有」；其他类型是格式变了。
  if (tracks !== null && tracks !== undefined && !Array.isArray(tracks))
    throw new QqApiError('invalid-response');
  return {
    tracks: Array.isArray(tracks) ? tracks : [],
    ...(Array.isArray(extras) ? { extras } : {}),
  };
};

export const GUESS_YOU_LIKE: MusicuDescriptor<GuessYouLikeData> = {
  module: 'music.radioProxy.MbTrackRadioSvr',
  method: 'get_radio_track',
  // 实测可用的参数组；num 再大也只回 5 首。
  param: { id: 99, firstplay: 1, num: 15 },
  readOnly: true,
  operation: 'recommend.guess-you-like',
  decode,
};

/** 没有会话回 401（不把匿名结果当成个人推荐）；上游成功但没有歌回 422。 */
export const guessYouLikeResult = async (
  session: AuthSession | null,
  options: SessionMusicuOptions = {},
): Promise<NewRouteResult> => {
  try {
    if (!session) throw new QqApiError('auth-missing');
    const data = await createSessionMusicuClient(session, options).execute(GUESS_YOU_LIKE);
    if (!data.tracks.length) throw new QqApiError('not-found');
    // 条目原样交出去，由前端自己正规化。
    return okResult({ songs: data.tracks, ...(data.extras ? { extras: data.extras } : {}) });
  } catch (error) {
    return failureResult('get-guess-you-like', error);
  }
};
