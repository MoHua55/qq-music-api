import { QqApiError } from '../../protocol/errors';
import type { MusicuDescriptor } from '../../protocol/musicu';
import type { AuthSession } from '../auth/qrLogin';
import { type Dictionary, dictionaryOf, isDictionary, stringOf } from '../auth/values';
import { failureResult, type NewRouteResult, okResult } from './newRouteResult';
import { createSessionMusicuClient, type SessionMusicuOptions } from './sessionMusicu';

// src/services/recommend/recommendPlaylists.ts
//
// `/recommend/playlists`：歌单广场的推荐。有会话就带凭证，没有就匿名。Node 与 serverless 共用。
// 实测（2026-10）：参数是 `{ From, Size }`；条目在 `List[].Playlist.basic`。翻页不像有限列表
// （From 往后仍有条目、HasMore 却变 false），所以只开放 limit，不提供续读位置。

const DEFAULT_LIMIT = 25;
/** 实测一次要 60 张能拿到 60 张；更大的没有验证过。 */
const MAX_LIMIT = 60;

/** 和其他路由的分页参数一样宽松：不是正整数就用默认值，超过上限就压到上限。 */
export const recommendPlaylistsLimitOf = (raw: unknown): number => {
  const value = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isSafeInteger(value) || value <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, value);
};

interface RecommendFeedData {
  list: unknown[];
  hasMore: boolean;
}

const decode = (data: unknown): RecommendFeedData => {
  if (!isDictionary(data)) throw new QqApiError('invalid-response');
  const { List: list, HasMore: hasMore } = data;
  if (list !== null && list !== undefined && !Array.isArray(list))
    throw new QqApiError('invalid-response');
  return { list: Array.isArray(list) ? list : [], hasMore: hasMore === true };
};

const recommendFeed = (limit: number): MusicuDescriptor<RecommendFeedData> => ({
  module: 'music.playlist.PlaylistSquare',
  method: 'GetRecommendFeed',
  param: { From: 0, Size: limit },
  readOnly: true,
  operation: 'recommendation-read',
  decode,
});

const countOf = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

const coverOf = (cover: Dictionary): string =>
  [cover.default_url, cover.big_url, cover.medium_url, cover.small_url]
    .map(stringOf)
    .find((url) => url !== '') ?? '';

const creatorOf = (creator: Dictionary): Dictionary =>
  Object.fromEntries(
    ['uin', 'encrypt_uin', 'nick', 'avatar']
      .filter((key) => typeof creator[key] === 'string')
      .map((key) => [key, creator[key]]),
  );

/**
 * 摊平成歌单列表常用的字段名（`tid`、`title`、`picurl`、`songnum`……），前端认歌单的那套读法就能用。
 * 没有可用 tid 的条目读不了歌，直接跳过；数字缺失就不给，不补 0。
 */
const toPlaylist = (entry: unknown): Dictionary | null => {
  const basic = dictionaryOf(dictionaryOf(dictionaryOf(entry).Playlist).basic);
  const tid = basic.tid;
  if (typeof tid !== 'number' || !Number.isSafeInteger(tid) || tid <= 0) return null;
  const songnum = countOf(basic.song_cnt);
  const playCount = countOf(basic.play_cnt);
  return {
    tid,
    title: stringOf(basic.title),
    desc: stringOf(basic.desc),
    picurl: coverOf(dictionaryOf(basic.cover)),
    ...(songnum === undefined ? {} : { songnum }),
    ...(playCount === undefined ? {} : { play_cnt: playCount }),
    creator: creatorOf(dictionaryOf(basic.creator)),
  };
};

/**
 * 会话解不开时由宿主传 `null`，这里就匿名读；解得开但上游拒绝凭证时回 401，让前端清掉坏会话。
 * 没有一张可用的歌单回 422。`more` 原样反映上游的 HasMore，只是提示，不代表读完。
 */
export const recommendPlaylistsResult = async (
  session: AuthSession | null,
  limit: number,
  options: SessionMusicuOptions = {},
): Promise<NewRouteResult> => {
  try {
    const data = await createSessionMusicuClient(session, options).execute(recommendFeed(limit));
    const playlists = data.list.map(toPlaylist).filter((item) => item !== null);
    if (!playlists.length) throw new QqApiError('not-found');
    return okResult({ playlists, more: data.hasMore });
  } catch (error) {
    return failureResult('get-recommend-playlists', error);
  }
};
