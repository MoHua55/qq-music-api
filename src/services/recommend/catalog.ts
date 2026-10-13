import { QqApiError } from '../../protocol/errors';
import type { MusicuDescriptor } from '../../protocol/musicu';
import { type Dictionary, dictionaryOf, isDictionary, stringOf } from '../auth/values';
import { failureResult, type NewRouteResult, okResult } from './newRouteResult';
import { createSessionMusicuClient, type SessionMusicuOptions } from './sessionMusicu';

// src/services/recommend/catalog.ts
//
// `/recommend/categories`、`/recommend/category-playlists`、`/recommend/new-songs`：公开内容，一律匿名读，
// 带了会话也不用。Node 与 serverless 共用。实测（2026-10，匿名）：分类是 `get_hot_category`，分类歌单是
// `get_playlist_by_category`（`total`＋`v_playlist[]`），新歌是 `get_new_song_info`（`songlist` 与
// `track_info` 同形、`lanlist` 是地区）。

const DEFAULT_PAGE_SIZE = 20;
/** 网页和旧路由一次要 40 张都拿得到；更大的没有验证过。 */
const MAX_PAGE_SIZE = 40;
/** 上游的「最新」。 */
const DEFAULT_NEW_SONG_AREA = 5;
/** 分类歌单的排序方式；网页和旧路由都用 5，其他值的意思没验证过，所以不开放。 */
const CATEGORY_ORDER = 5;

const positiveIdOf = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;

const countOf = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

/** 必填的 id：只认纯数字的正整数。 */
const requiredIdOf = (raw: unknown): number => {
  const text = String(raw ?? '');
  const value = /^\d{1,15}$/.test(text) ? positiveIdOf(Number(text)) : undefined;
  if (value === undefined) throw new QqApiError('input');
  return value;
};

/** 分页参数和其他路由一样宽松：不是正整数就用默认值，超过上限就压到上限。 */
const pagingOf = (raw: unknown, fallback: number, max = Number.MAX_SAFE_INTEGER): number => {
  const value = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isSafeInteger(value) || value <= 0) return fallback;
  return Math.min(max, value);
};

const listOf = (value: unknown): unknown[] => {
  if (value !== null && value !== undefined && !Array.isArray(value))
    throw new QqApiError('invalid-response');
  return Array.isArray(value) ? value : [];
};

const decodeDictionary = (data: unknown): Dictionary => {
  if (!isDictionary(data)) throw new QqApiError('invalid-response');
  return data;
};

const anonymous = (options: SessionMusicuOptions) => createSessionMusicuClient(null, options);

// ---- 歌单分类 ----

const CATEGORIES: MusicuDescriptor<Dictionary> = {
  module: 'music.web_category_svr',
  method: 'get_hot_category',
  param: { qq: '' },
  readOnly: true,
  operation: 'recommend.categories',
  decode: decodeDictionary,
};

const toCategory = (entry: unknown): Dictionary | null => {
  const item = dictionaryOf(entry);
  const id = positiveIdOf(item.item_id);
  return id === undefined ? null : { id, name: stringOf(item.item_name) };
};

/** 没有可用分类的组跳过；上游给空清单回 422，给了组却一个分类都读不出来回 502。 */
export const playlistCategoriesResult = async (
  options: SessionMusicuOptions = {},
): Promise<NewRouteResult> => {
  try {
    const groups = listOf((await anonymous(options).execute(CATEGORIES)).category);
    if (!groups.length) throw new QqApiError('not-found');
    const readable = groups
      .map((entry) => {
        const group = dictionaryOf(entry);
        const categories = Array.isArray(group.items)
          ? group.items.map(toCategory).filter(Boolean)
          : [];
        const id = positiveIdOf(group.group_id);
        return categories.length && id !== undefined
          ? { id, name: stringOf(group.group_name), categories }
          : null;
      })
      .filter(Boolean);
    if (!readable.length) throw new QqApiError('invalid-response');
    return okResult({ groups: readable });
  } catch (error) {
    return failureResult('get-playlist-categories', error);
  }
};

// ---- 分类歌单 ----

const categoryPlaylists = (
  id: number,
  page: number,
  size: number,
): MusicuDescriptor<Dictionary> => ({
  module: 'playlist.PlayListPlazaServer',
  method: 'get_playlist_by_category',
  param: { id, curPage: page, size, order: CATEGORY_ORDER, titleid: id },
  readOnly: true,
  operation: 'recommend.category-playlists',
  decode: decodeDictionary,
});

const creatorOf = (creator: Dictionary): Dictionary => {
  const uin =
    typeof creator.uin === 'number' && Number.isSafeInteger(creator.uin)
      ? String(creator.uin)
      : typeof creator.uin === 'string' && /^\d+$/.test(creator.uin)
        ? creator.uin
        : undefined;
  return {
    ...(uin === undefined ? {} : { uin }),
    ...Object.fromEntries(
      ['nick', 'avatar']
        .filter((key) => typeof creator[key] === 'string' && creator[key] !== '')
        .map((key) => [key, creator[key]]),
    ),
  };
};

/** 和 `/recommend/playlists` 同一套字段名；没有可用 tid 的跳过，数字缺失就不给。 */
const toPlaylist = (entry: unknown): Dictionary | null => {
  const item = dictionaryOf(entry);
  const tid = positiveIdOf(item.tid);
  if (tid === undefined) return null;
  const playCount = countOf(item.access_num);
  return {
    tid,
    title: stringOf(item.title),
    desc: stringOf(item.desc),
    picurl:
      [item.cover_url_big, item.cover_url_medium, item.cover_url_small]
        .map(stringOf)
        .find((url) => url !== '') ?? '',
    ...(playCount === undefined ? {} : { play_cnt: playCount }),
    creator: creatorOf(dictionaryOf(item.creator_info)),
  };
};

/**
 * `page` 从 1 开始。`more` 用上游的 `total` 算（这一页之后还有没有），`total` 缺失时当作没有下一页。
 * 空页回 422；给了条目却一张都读不出来回 502。
 */
export const categoryPlaylistsResult = async (
  raw: { id?: unknown; page?: unknown; limit?: unknown },
  options: SessionMusicuOptions = {},
): Promise<NewRouteResult> => {
  try {
    const id = requiredIdOf(raw.id);
    const page = pagingOf(raw.page, 1);
    const size = pagingOf(raw.limit, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const data = await anonymous(options).execute(categoryPlaylists(id, page, size));
    const entries = listOf(data.v_playlist);
    if (!entries.length) throw new QqApiError('not-found');
    const playlists = entries.map(toPlaylist).filter(Boolean);
    if (!playlists.length) throw new QqApiError('invalid-response');
    const total = countOf(data.total);
    return okResult({
      playlists,
      ...(total === undefined ? {} : { total }),
      more: total !== undefined && page * size < total,
    });
  } catch (error) {
    return failureResult('get-category-playlists', error);
  }
};

// ---- 新歌速递 ----

const newSongs = (area: number): MusicuDescriptor<Dictionary> => ({
  module: 'newsong.NewSongServer',
  method: 'get_new_song_info',
  param: { type: area },
  readOnly: true,
  operation: 'recommend.new-songs',
  decode: decodeDictionary,
});

const toArea = (entry: unknown): Dictionary | null => {
  const item = dictionaryOf(entry);
  const id = positiveIdOf(item.type);
  return id === undefined ? null : { id, name: stringOf(item.name) };
};

/** `area` 不给就是「最新」；给了就要是正整数。歌曲条目原样交出去；没有歌回 422。 */
export const newSongsResult = async (
  rawArea: unknown,
  options: SessionMusicuOptions = {},
): Promise<NewRouteResult> => {
  try {
    const area =
      rawArea === undefined || rawArea === null || rawArea === ''
        ? DEFAULT_NEW_SONG_AREA
        : requiredIdOf(rawArea);
    const data = await anonymous(options).execute(newSongs(area));
    const songs = listOf(data.songlist);
    if (!songs.length) throw new QqApiError('not-found');
    const areas = Array.isArray(data.lanlist) ? data.lanlist.map(toArea).filter(Boolean) : [];
    return okResult({ area: positiveIdOf(data.type) ?? area, songs, areas });
  } catch (error) {
    return failureResult('get-new-songs', error);
  }
};
