import { QqApiError } from '../../protocol/errors';
import type { MusicuDescriptor } from '../../protocol/musicu';
import type { AuthSession } from '../auth/qrLogin';
import { type Dictionary, isDictionary } from '../auth/values';
import { failureResult, type NewRouteResult, okResult } from '../recommend/newRouteResult';
import { createSessionMusicuClient, type SessionMusicuOptions } from '../recommend/sessionMusicu';

// src/services/search/search.ts
//
// `/search`：按关键字搜歌曲、专辑、歌单、歌手。Node 与 serverless 共用。
// 实测（2026-10）：桌面版搜索方法用不签名的 musicu 就能读，参数只有六个键。匿名时专辑、歌单、歌手有结果，
// 歌曲却回 code 0 加空清单，和真正搜不到长得一样，所以歌曲必须带会话；其他类型有会话就带上。
// 单项码不是 0（例如 2001）时清单也是空的，一律当失败，不当成「没有结果」。

export const SEARCH_TYPES = ['song', 'album', 'playlist', 'singer'] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

const SEARCH_TYPE_CODES: Record<SearchType, number> = { song: 0, singer: 1, album: 2, playlist: 3 };
const LIST_KEYS: Record<SearchType, string> = {
  song: 'song',
  singer: 'singer',
  album: 'album',
  playlist: 'songlist',
};
/** 官方网页各类型的来源标记；歌曲翻页用另一个。专辑、歌单、歌手翻页没有观察过，沿用首页的。 */
const REMOTE_PLACES: Record<SearchType, string> = {
  song: 'txt.yqq.center',
  singer: 'txt.yqq.center',
  album: 'txt.yqq.album',
  playlist: 'txt.yqq.playlist',
};
const SONG_NEXT_PAGE = 'sizer.yqq.song_next';

const DEFAULT_LIMIT = 10;
/** 实测只验证过一页 10 条；先开到 20，更大的没有验证过。 */
const MAX_LIMIT = 20;
const MAX_KEYWORD_LENGTH = 100;

/** 不给类型就是歌曲；给了不认识的值算参数错误。 */
export const searchTypeOf = (raw: unknown): SearchType => {
  if (raw === undefined || raw === null || raw === '') return 'song';
  const type = SEARCH_TYPES.find((value) => value === raw);
  if (type === undefined) throw new QqApiError('input');
  return type;
};

/** 歌曲匿名读不到可靠结果，只有歌曲要登录。 */
export const searchNeedsSession = (type: SearchType): boolean => type === 'song';

const keywordOf = (raw: unknown): string => {
  const keyword = typeof raw === 'string' ? raw.trim() : '';
  if (!keyword || keyword.length > MAX_KEYWORD_LENGTH) throw new QqApiError('input');
  return keyword;
};

/** 分页参数和其他路由一样宽松：不是正整数就用默认值，超过上限就压到上限。 */
const pagingOf = (raw: unknown, fallback: number, max = Number.MAX_SAFE_INTEGER): number => {
  const value = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isSafeInteger(value) || value <= 0) return fallback;
  return Math.min(max, value);
};

const countOf = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

/** 网页每次搜索带一个随机数字串；不需要密码学强度，也不能依赖 `node:*`。 */
const searchIdOf = (): string =>
  `${Math.floor(Math.random() * 9 + 1)}${Array.from({ length: 17 }, () =>
    Math.floor(Math.random() * 10),
  ).join('')}`;

interface SearchData {
  items: Dictionary[];
  total?: number;
  more: boolean;
}

const decoderFor =
  (type: SearchType) =>
  (data: unknown): SearchData => {
    if (!isDictionary(data) || !isDictionary(data.body) || !isDictionary(data.meta))
      throw new QqApiError('invalid-response');
    // 实测成功时内层 code 是 0；非 0 的意思没有分离，不当成功。
    if (data.code !== undefined && data.code !== 0) throw new QqApiError('invalid-response');
    const block = data.body[LIST_KEYS[type]];
    if (!isDictionary(block) || !Array.isArray(block.list))
      throw new QqApiError('invalid-response');
    const items = block.list.filter(isDictionary);
    if (items.length < block.list.length) throw new QqApiError('invalid-response');
    const { nextpage } = data.meta;
    return {
      items,
      total: countOf(data.meta.sum),
      more: typeof nextpage === 'number' && Number.isSafeInteger(nextpage) && nextpage > 0,
    };
  };

const searchRequest = (
  type: SearchType,
  keyword: string,
  page: number,
  limit: number,
): MusicuDescriptor<SearchData> => ({
  module: 'music.search.SearchCgiService',
  method: 'DoSearchForQQMusicDesktop',
  param: {
    remoteplace: type === 'song' && page > 1 ? SONG_NEXT_PAGE : REMOTE_PLACES[type],
    searchid: searchIdOf(),
    search_type: SEARCH_TYPE_CODES[type],
    query: keyword,
    page_num: page,
    num_per_page: limit,
  },
  readOnly: true,
  operation: 'search',
  decode: decoderFor(type),
});

/**
 * 条目原样交出去（歌曲和其他新路由一样是 `track_info` 那套字段，保留各种 MID），由调用方自己整理。
 * 搜不到回 200 加空清单；`total` 取上游 `meta.sum`，`more` 只看上游的下一页标记。
 */
export const searchResult = async (
  raw: { keyword?: unknown; type?: unknown; page?: unknown; limit?: unknown },
  session: AuthSession | null,
  options: SessionMusicuOptions = {},
): Promise<NewRouteResult> => {
  try {
    const type = searchTypeOf(raw.type);
    const keyword = keywordOf(raw.keyword);
    const page = pagingOf(raw.page, 1);
    const limit = pagingOf(raw.limit, DEFAULT_LIMIT, MAX_LIMIT);
    if (searchNeedsSession(type) && !session) throw new QqApiError('auth-missing');
    const data = await createSessionMusicuClient(session, options).execute(
      searchRequest(type, keyword, page, limit),
    );
    return okResult({
      type,
      page,
      limit,
      ...(data.total === undefined ? {} : { total: data.total }),
      more: data.more,
      items: data.items,
    });
  } catch (error) {
    return failureResult('search', error);
  }
};
