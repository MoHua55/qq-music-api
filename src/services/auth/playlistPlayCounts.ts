import { logger } from '../../util/logger';
import type { UpstreamPhase } from '../../util/safeError';
import { credentialMusicId } from './androidDevice';
import type { AuthHttpClient } from './httpClient';
import { credentialCookieHeader } from './musicuProtocol';
import type { AuthSession } from './qrTypes';
import { dictionaryOf, isDictionary, numberOf } from './values';

// src/services/auth/playlistPlayCounts.ts
//
// `/user/playlist?playCount=1` 的播放数。Android 自建列表的 `play_cnt` 实测全是 0、收藏列表没有这个字段，
// 旧接口才有：自建 `fcg_user_created_diss` 的 `listen_num`、收藏 `fcg_get_profile_order_asset`（reqtype 3）的
// `listennum`。官方网页每页 10 张（自建请求 11、收藏闭区间 sin..sin+10），按歌单 id 对回原列表。
// 只补数字，不替换列表来源；任何一步读不到都不影响列表本身。
// 同一账号 10 分钟内再要播放数就用上次读到的结果：播放数只用来显示，旧一点无害，省下的是每次整份重扫。

const CREATED_URL = 'https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss';
const FAVORITE_URL = 'https://c.y.qq.com/fav/fcgi-bin/fcg_get_profile_order_asset.fcg';
const PAGE_STEP = 10;
/** 每份清单最多读这么多页（100 张）；更多的就标成没补完。 */
export const PLAY_COUNT_PAGE_LIMIT = 10;
/** 同一账号多久内不重读。 */
export const PLAY_COUNT_CACHE_TTL_MS = 10 * 60 * 1000;
/** 最多记住这么多份清单，超过就丢最久没用的，免得公开部署的内存一直涨。 */
const PLAY_COUNT_CACHE_LIMIT = 500;

const idOf = (value: unknown): string | undefined => {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value)) return value;
  return undefined;
};

const countOf = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

/** 这一页之后：还有下一页、确定读到尾，或上游没给能判断的信号（只好停下，也不说读完了）。 */
type PageNext = 'more' | 'end' | 'unknown';

interface PageResult {
  entries: Array<{ id?: string; count?: number }>;
  next: PageNext;
}

interface Source {
  phase: UpstreamPhase;
  url: string;
  params: (sin: number, auth: AuthSession) => Record<string, unknown>;
  read: (data: Record<string, unknown>, sin: number) => PageResult | undefined;
}

const SOURCES: Record<'created' | 'favorite', Source> = {
  created: {
    phase: 'get-created-playlist-play-counts',
    url: CREATED_URL,
    params: (sin, auth) => ({
      hostuin: credentialMusicId(auth.credential),
      sin,
      size: PAGE_STEP + 1,
      format: 'json',
    }),
    read: (data, sin) => {
      if (!Array.isArray(data.disslist)) return undefined;
      const total = numberOf(data.totoal);
      return {
        entries: data.disslist.map((item) => {
          const entry = dictionaryOf(item);
          return { id: idOf(entry.tid), count: countOf(entry.listen_num) };
        }),
        next:
          data.disslist.length === 0
            ? 'end'
            : total === undefined
              ? 'unknown'
              : sin + PAGE_STEP >= total
                ? 'end'
                : 'more',
      };
    },
  },
  favorite: {
    phase: 'get-favorite-playlist-play-counts',
    url: FAVORITE_URL,
    params: (sin, auth) => ({
      ct: 20,
      cid: 205360956,
      userid: credentialMusicId(auth.credential),
      reqtype: 3,
      sin,
      ein: sin + PAGE_STEP,
      format: 'json',
    }),
    read: (data) => {
      if (!Array.isArray(data.cdlist)) return undefined;
      return {
        entries: data.cdlist.map((item) => {
          const entry = dictionaryOf(item);
          return { id: idOf(entry.dissid), count: countOf(entry.listennum) };
        }),
        next:
          data.cdlist.length === 0
            ? 'end'
            : data.has_more === 1
              ? 'more'
              : data.has_more === 0
                ? 'end'
                : 'unknown',
      };
    },
  },
};

interface CountsResult {
  counts: Map<string, number>;
  /** 每一页都读到、而且上游确实说到尾了。 */
  complete: boolean;
  /** 有一页没读到（请求失败、业务码不对、格式不对）；这种结果不缓存，下次重读。 */
  failed: boolean;
}

/** 读一份清单的播放数，最多 `PLAY_COUNT_PAGE_LIMIT` 页。 */
const readCounts = async (
  http: AuthHttpClient,
  auth: AuthSession,
  source: Source,
): Promise<CountsResult> => {
  const counts = new Map<string, number>();
  for (let page = 0; page < PLAY_COUNT_PAGE_LIMIT; page += 1) {
    const sin = page * PAGE_STEP;
    let result: PageResult | undefined;
    try {
      const response = await http.request<unknown>({
        url: source.url,
        method: 'GET',
        params: source.params(sin, auth),
        headers: { Referer: 'https://y.qq.com/', Cookie: credentialCookieHeader(auth.credential) },
      });
      const body = dictionaryOf(response.data);
      const code = numberOf(body.code);
      logger.info('qq-auth.upstream-result', {
        phase: source.phase,
        httpStatus: response.status,
        globalCode: code,
        upstreamCode: numberOf(body.subcode),
      });
      if (code === 0 && isDictionary(body.data)) result = source.read(body.data, sin);
    } catch {
      result = undefined;
    }
    if (!result) return { counts, complete: false, failed: true };
    for (const { id, count } of result.entries)
      if (id !== undefined && count !== undefined && !counts.has(id)) counts.set(id, count);
    if (result.next !== 'more') return { counts, complete: result.next === 'end', failed: false };
  }
  return { counts, complete: false, failed: false };
};

const cache = new Map<string, { result: CountsResult; at: number }>();

/** 测试用：缓存是模块级的，跨用例要清掉。 */
export const clearPlayCountCache = (): void => cache.clear();

/**
 * 带缓存地读一份清单。按「哪份清单＋账号」记；认不出账号（id 空或 0）就不记，免得不同账号互相拿到。
 * 读失败的不记；读到页数上限的照记，因为再读也一样读不完。缓存期内列表多了歌单也不重扫，等过期再补。
 */
const readCountsCached = async (
  http: AuthHttpClient,
  auth: AuthSession,
  name: keyof typeof SOURCES,
): Promise<CountsResult> => {
  const account = credentialMusicId(auth.credential);
  if (!account || account === '0') return readCounts(http, auth, SOURCES[name]);
  const key = `${name}:${account}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < PLAY_COUNT_CACHE_TTL_MS) {
    // 重新放到最后，表示刚用过。
    cache.delete(key);
    cache.set(key, hit);
    return hit.result;
  }
  cache.delete(key);
  const result = await readCounts(http, auth, SOURCES[name]);
  if (!result.failed) {
    cache.set(key, { result, at: now });
    while (cache.size > PLAY_COUNT_CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  }
  return result;
};

/**
 * 给自建与收藏条目补 `play_cnt`。对得上、而且是非负整数才给；其余条目拿掉 `play_cnt`，
 * 不把 Android 给的 0 当成真的播放数。只读需要的那份清单。
 */
export const withPlayCounts = async (
  http: AuthHttpClient,
  auth: AuthSession,
  created: unknown[],
  favorites: unknown[],
  idOfPlaylist: (value: unknown) => string,
): Promise<{ created: unknown[]; favorites: unknown[]; complete: boolean }> => {
  const [createdCounts, favoriteCounts] = await Promise.all([
    created.length ? readCountsCached(http, auth, 'created') : undefined,
    favorites.length ? readCountsCached(http, auth, 'favorite') : undefined,
  ]);
  const apply = (list: unknown[], counts: Map<string, number> | undefined) =>
    list.map((value) => {
      if (!isDictionary(value)) return value;
      const { play_cnt: _ignored, ...rest } = value;
      const count = counts?.get(idOfPlaylist(value));
      return count === undefined ? rest : { ...rest, play_cnt: count };
    });
  return {
    created: apply(created, createdCounts?.counts),
    favorites: apply(favorites, favoriteCounts?.counts),
    complete: (createdCounts?.complete ?? true) && (favoriteCounts?.complete ?? true),
  };
};
