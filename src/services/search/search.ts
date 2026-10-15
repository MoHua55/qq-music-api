import { QqApiError } from '../../protocol/errors';
import { createMusicuClient, type MusicuDescriptor } from '../../protocol/musicu';
import { createFetchTransport } from '../../transport/fetch';
import type { AuthSession } from '../auth/qrLogin';
import { type Dictionary, isDictionary } from '../auth/values';
import { failureResult, type NewRouteResult, okResult } from '../recommend/newRouteResult';
import { createSessionMusicuClient, type SessionMusicuOptions } from '../recommend/sessionMusicu';

// src/services/search/search.ts
//
// `/search`：按关键字搜歌曲、专辑、歌单、歌手。Node 与 serverless 共用。
// 实测（2026-10）：精简版搜索方法用不签名的 musicu 就能读。有会话时带会话，四种类型都有结果；
// 没有会话时用精简版的匿名身份，专辑、歌单、歌手有结果，歌曲常被上游以 2001 拒绝。
// 单项码不是 0 时清单也是空的，一律当失败，不当成「没有结果」。

export const SEARCH_TYPES = ['song', 'album', 'playlist', 'singer'] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

const SEARCH_TYPE_CODES: Record<SearchType, number> = { song: 0, singer: 1, album: 2, playlist: 3 };
/** 精简版把各类型的条目直接放在 `body` 下的数组里，歌手那组没有 `item_` 前缀。 */
const LIST_KEYS: Record<SearchType, string> = {
  song: 'item_song',
  singer: 'singer',
  album: 'item_album',
  playlist: 'item_songlist',
};
const REMOTE_PLACE = 'search.android.keyboard';

/**
 * 精简版客户端的匿名身份：只放协议需要的应用与版本常数，不带任何设备指纹。
 * 标头里的 `tmeLoginType=-1` 表示未登录。
 */
const ANONYMOUS_LITE_COMM = {
  ct: 11,
  cv: '1003006',
  v: '1003006',
  tmeAppID: 'qqmusiclight',
  nettype: 'NETWORK_WIFI',
  udid: '0',
  uid: '0',
};
const ANONYMOUS_LITE_HEADERS = { Cookie: 'tmeLoginType=-1', 'User-Agent': 'okhttp/3.14.9' };

const DEFAULT_LIMIT = 10;
/** 实测验证过一页 10 与 20 条；更大的没有验证过。 */
const MAX_LIMIT = 20;
/** 精简版客户端最多送 60 个字。 */
const MAX_KEYWORD_LENGTH = 60;

/** 不给类型就是歌曲；给了不认识的值算参数错误。 */
export const searchTypeOf = (raw: unknown): SearchType => {
  if (raw === undefined || raw === null || raw === '') return 'song';
  const type = SEARCH_TYPES.find((value) => value === raw);
  if (type === undefined) throw new QqApiError('input');
  return type;
};

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

/** 每次搜索带一个随机数字串；不需要密码学强度，也不能依赖 `node:*`。 */
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
    const list = data.body[LIST_KEYS[type]];
    if (!Array.isArray(list)) throw new QqApiError('invalid-response');
    const items = list.filter(isDictionary);
    if (items.length < list.length) throw new QqApiError('invalid-response');
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
  method: 'DoSearchForQQMusicLite',
  param: {
    search_id: searchIdOf(),
    remoteplace: REMOTE_PLACE,
    query: keyword,
    search_type: SEARCH_TYPE_CODES[type],
    num_per_page: limit,
    page_num: page,
    highlight: 0,
    nqc_flag: 0,
    page_id: 1,
    grp: 1,
  },
  readOnly: true,
  operation: 'search',
  decode: decoderFor(type),
});

const clientFor = (session: AuthSession | null, options: SessionMusicuOptions) =>
  session
    ? createSessionMusicuClient(session, options)
    : createMusicuClient({
        http: createFetchTransport(options.fetcher),
        comm: ANONYMOUS_LITE_COMM,
        headers: ANONYMOUS_LITE_HEADERS,
      });

/**
 * 条目原样交出去（保留各种 MID），由调用方自己整理。有会话就带会话，没有就匿名搜。
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
    const data = await clientFor(session, options).execute(
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
