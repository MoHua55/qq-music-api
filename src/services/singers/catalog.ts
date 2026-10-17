import { QqApiError } from '../../protocol/errors';
import type { MusicuDescriptor } from '../../protocol/musicu';
import { type Dictionary, dictionaryOf, isDictionary, stringOf } from '../auth/values';
import { failureResult, type NewRouteResult, okResult } from '../recommend/newRouteResult';
import { createSessionMusicuClient, type SessionMusicuOptions } from '../recommend/sessionMusicu';

// src/services/singers/catalog.ts
//
// `/singer/list`、`/singer/detail`、`/singer/homepage`、`/singer/similar`、`/singer/songs`、`/singer/mvs`：
// 公开内容，一律匿名读，带了会话也不用。Node 与 serverless 共用。
// 实测（2026-10，匿名网页 comm）：
// - 歌手清单 `SingerList.GetSingerListIndex { area, sex, genre, index, sin, cur_page }`，一页固定 80 位，
//   `tags` 里是四种筛选（`{ id, name }`，-100 是「全部」）。
// - 资料 `SingerInfoInter.GetSingerDetail` → `singer_list[].basic_info`／`ex_info`／`wiki`／`pic`。
// - 主页 `UnifiedHomepageSrv.GetHomepageHeader { SingerMid }` 成功时单项码是 10000，粉丝数、关注数在
//   `Info.FansNum.Num`、`Info.FollowNum.Num`。
// - 相似歌手 `SimilarSingerSvr.GetSimilarSingerList` → `singerlist[]`，有的歌手是 null。
// - 歌曲 `song_list_server.GetSingerSongList` → `songList[].songInfo`（和 `track_info` 同形），
//   `number` 不照给（要 10、20 都回 30），所以这里按 limit 截断。
// - MV `MvInfoProServer.GetSingerMvList { singermid, order, count, start }` → `list[]`、`total`。

const SINGER_PAGE_SIZE = 80;
const SONG_PAGE_SIZE = 30;
const MV_PAGE_SIZE = 20;
/** 实测一次要 10 支照给；更大的没有验证过，先和其他列表一样最多 40。 */
const MAX_MV_PAGE_SIZE = 40;
/** 「全部」。 */
const ALL = -100;
const MID_PATTERN = /^[0-9A-Za-z]{1,32}$/;
const FILTER_PATTERN = /^-?\d{1,4}$/;

const positiveIdOf = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;

const countOf = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

const textOf = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const listOf = (value: unknown): unknown[] => {
  if (value !== null && value !== undefined && !Array.isArray(value))
    throw new QqApiError('invalid-response');
  return Array.isArray(value) ? value : [];
};

const decodeDictionary = (data: unknown): Dictionary => {
  if (!isDictionary(data)) throw new QqApiError('invalid-response');
  return data;
};

const optionalFields = (entries: Array<[string, unknown]>): Dictionary =>
  Object.fromEntries(entries.filter(([, value]) => value !== undefined));

/** 必填的歌手 mid：只认字母和数字。 */
const midOf = (raw: unknown): string => {
  const mid = typeof raw === 'string' ? raw : '';
  if (!MID_PATTERN.test(mid)) throw new QqApiError('input');
  return mid;
};

/** 筛选值：不给就是「全部」，给了就要是整数。 */
const filterOf = (raw: unknown): number => {
  if (raw === undefined || raw === null || raw === '') return ALL;
  const text = String(raw);
  if (!FILTER_PATTERN.test(text)) throw new QqApiError('input');
  return Number(text);
};

const offsetOf = (raw: unknown): number => {
  const value = Number.parseInt(String(raw ?? ''), 10);
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
};

/** 分页参数和其他路由一样宽松：不是正整数就用默认值，超过上限就压到上限。 */
const limitOf = (raw: unknown, fallback: number, max: number): number => {
  const value = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isSafeInteger(value) || value <= 0) return fallback;
  return Math.min(max, value);
};

const anonymous = (options: SessionMusicuOptions) => createSessionMusicuClient(null, options);

const descriptor = (
  module: string,
  method: string,
  param: Record<string, unknown>,
  operation: MusicuDescriptor['operation'],
  allowedCodes?: readonly number[],
): MusicuDescriptor<Dictionary> => ({
  module,
  method,
  param,
  readOnly: true,
  operation,
  ...(allowedCodes ? { allowedCodes } : {}),
  decode: decodeDictionary,
});

/**
 * 先按 offset、limit 截出这一页的条目再读：`more` 按截出来的条目数算，读不出来的条目跳过。
 * 截出来是空的回 422；截出来有条目却一个都读不出来回 502。
 */
const pageOf = <T>(
  entries: unknown[],
  start: number,
  limit: number,
  read: (entry: unknown) => T | null,
): { items: T[]; consumed: number } => {
  const slice = entries.slice(start, start + limit);
  if (!slice.length) throw new QqApiError('not-found');
  const items = slice.map(read).filter((item): item is T => item !== null);
  if (!items.length) throw new QqApiError('invalid-response');
  return { items, consumed: slice.length };
};

const totalFields = (total: number | undefined, end: number): Dictionary => ({
  ...(total === undefined ? {} : { total }),
  more: total !== undefined && end < total,
});

// ---- 歌手清单 ----

const TAG_KEYS = ['area', 'sex', 'genre', 'index'] as const;

const toTag = (entry: unknown): Dictionary | null => {
  const item = dictionaryOf(entry);
  return typeof item.id === 'number' && Number.isSafeInteger(item.id)
    ? { id: item.id, name: stringOf(item.name) }
    : null;
};

const toListSinger = (entry: unknown): Dictionary | null => {
  const item = dictionaryOf(entry);
  const mid = textOf(item.singer_mid);
  if (mid === undefined) return null;
  return {
    mid,
    name: stringOf(item.singer_name),
    ...optionalFields([
      ['id', positiveIdOf(item.singer_id)],
      ['pic', textOf(item.singer_pic)],
      ['country', textOf(item.country)],
      ['otherName', textOf(item.other_name)],
    ]),
  };
};

/** 筛选不给就是「全部」；offset 换算成上游的第几页（每页 80 位），一次最多给一页。 */
export const singerListResult = async (
  query: {
    area?: unknown;
    sex?: unknown;
    genre?: unknown;
    index?: unknown;
    offset?: unknown;
    limit?: unknown;
  },
  options: SessionMusicuOptions = {},
): Promise<NewRouteResult> => {
  try {
    const filters = {
      area: filterOf(query.area),
      sex: filterOf(query.sex),
      genre: filterOf(query.genre),
      index: filterOf(query.index),
    };
    const offset = offsetOf(query.offset);
    const limit = limitOf(query.limit, SINGER_PAGE_SIZE, SINGER_PAGE_SIZE);
    const page = Math.floor(offset / SINGER_PAGE_SIZE) + 1;
    const sin = (page - 1) * SINGER_PAGE_SIZE;
    const data = await anonymous(options).execute(
      descriptor(
        'music.musichallSinger.SingerList',
        'GetSingerListIndex',
        { ...filters, sin, cur_page: page },
        'singer.list',
      ),
    );
    const entries = listOf(data.singerlist);
    if (!entries.length) throw new QqApiError('not-found');
    const { items, consumed } = pageOf(entries, offset - sin, limit, toListSinger);
    const tags = dictionaryOf(data.tags);
    return okResult({
      singers: items,
      tags: Object.fromEntries(
        TAG_KEYS.map((key) => [
          key,
          Array.isArray(tags[key]) ? tags[key].map(toTag).filter(Boolean) : [],
        ]),
      ),
      ...totalFields(countOf(data.total), offset + consumed),
    });
  } catch (error) {
    return failureResult('get-singer-list', error);
  }
};

// ---- 歌手资料 ----

export const singerDetailResult = async (
  rawMid: unknown,
  options: SessionMusicuOptions = {},
): Promise<NewRouteResult> => {
  try {
    const mid = midOf(rawMid);
    const data = await anonymous(options).execute(
      descriptor(
        'music.musichallSinger.SingerInfoInter',
        'GetSingerDetail',
        { singer_mids: [mid], pic: 1, group_singer: 1, wiki_singer: 1, ex_singer: 1 },
        'singer.detail',
      ),
    );
    const entries = listOf(data.singer_list);
    if (!entries.length) throw new QqApiError('not-found');
    const entry = dictionaryOf(entries[0]);
    const basic = dictionaryOf(entry.basic_info);
    const extra = dictionaryOf(entry.ex_info);
    const pic = dictionaryOf(entry.pic);
    const singerMid = textOf(basic.singer_mid);
    if (singerMid === undefined) throw new QqApiError('invalid-response');
    return okResult({
      singer: {
        mid: singerMid,
        name: stringOf(basic.name),
        ...optionalFields([
          ['id', positiveIdOf(basic.singer_id)],
          ['pic', textOf(pic.pic) ?? textOf(pic.big_black) ?? textOf(pic.big_white)],
          ['desc', textOf(extra.desc)],
          ['wiki', textOf(entry.wiki)],
          ['foreignName', textOf(extra.foreign_name)],
          ['birthday', textOf(extra.birthday)],
        ]),
      },
    });
  } catch (error) {
    return failureResult('get-singer-detail', error);
  }
};

// ---- 歌手主页 ----

/** 实测这个服务成功时单项码是 10000（资料完整），也接受 0。 */
const HOMEPAGE_OK_CODES = [10000] as const;

/** 主页的数字是 `{ HasEntry, Num, Add, jumpURL }`，`Num` 可能是数字或纯数字的字符串。 */
const counterOf = (value: unknown): number | undefined => {
  const num = dictionaryOf(value).Num;
  if (typeof num === 'string' && /^\d{1,15}$/.test(num)) return Number(num);
  return countOf(num);
};

export const singerHomepageResult = async (
  rawMid: unknown,
  options: SessionMusicuOptions = {},
): Promise<NewRouteResult> => {
  try {
    const mid = midOf(rawMid);
    const data = await anonymous(options).execute(
      descriptor(
        'music.UnifiedHomepage.UnifiedHomepageSrv',
        'GetHomepageHeader',
        { SingerMid: mid },
        'singer.homepage',
        HOMEPAGE_OK_CODES,
      ),
    );
    if (!isDictionary(data.Info)) throw new QqApiError('invalid-response');
    const counts = optionalFields([
      ['fansNum', counterOf(data.Info.FansNum)],
      ['followNum', counterOf(data.Info.FollowNum)],
    ]);
    if (!Object.keys(counts).length) throw new QqApiError('invalid-response');
    return okResult({ mid, ...counts });
  } catch (error) {
    return failureResult('get-singer-homepage', error);
  }
};

// ---- 相似歌手 ----

const SIMILAR_SINGER_COUNT = 10;

const toSimilarSinger = (entry: unknown): Dictionary | null => {
  const item = dictionaryOf(entry);
  const mid = textOf(item.singerMid);
  if (mid === undefined) return null;
  return {
    mid,
    name: stringOf(item.singerName),
    ...optionalFields([
      ['id', positiveIdOf(item.singerId)],
      ['pic', textOf(item.singerPic)],
    ]),
  };
};

/** 有的歌手上游给 null，和空清单一样回 422。 */
export const similarSingersResult = async (
  rawMid: unknown,
  options: SessionMusicuOptions = {},
): Promise<NewRouteResult> => {
  try {
    const mid = midOf(rawMid);
    const data = await anonymous(options).execute(
      descriptor(
        'music.SimilarSingerSvr',
        'GetSimilarSingerList',
        { singerMid: mid, number: SIMILAR_SINGER_COUNT },
        'singer.similar',
      ),
    );
    const entries = listOf(data.singerlist);
    if (!entries.length) throw new QqApiError('not-found');
    const { items } = pageOf(entries, 0, entries.length, toSimilarSinger);
    return okResult({ singers: items });
  } catch (error) {
    return failureResult('get-similar-singers', error);
  }
};

// ---- 歌手的歌 ----

/** 只交出有 mid 的完整曲目，原样不动。 */
const toSong = (entry: unknown): Dictionary | null => {
  const song = dictionaryOf(entry).songInfo;
  if (!isDictionary(song)) return null;
  return typeof song.mid === 'string' && song.mid.length > 0 ? song : null;
};

export const singerSongsResult = async (
  query: { mid?: unknown; offset?: unknown; limit?: unknown },
  options: SessionMusicuOptions = {},
): Promise<NewRouteResult> => {
  try {
    const mid = midOf(query.mid);
    const offset = offsetOf(query.offset);
    const limit = limitOf(query.limit, SONG_PAGE_SIZE, SONG_PAGE_SIZE);
    const data = await anonymous(options).execute(
      descriptor(
        'musichall.song_list_server',
        'GetSingerSongList',
        { singerMid: mid, order: 1, number: limit, begin: offset },
        'singer.songs',
      ),
    );
    const entries = listOf(data.songList);
    if (!entries.length) throw new QqApiError('not-found');
    const { items, consumed } = pageOf(entries, 0, limit, toSong);
    return okResult({ songs: items, ...totalFields(countOf(data.totalNum), offset + consumed) });
  } catch (error) {
    return failureResult('get-singer-songs', error);
  }
};

// ---- 歌手的 MV ----

const toMv = (entry: unknown): Dictionary | null => {
  const item = dictionaryOf(entry);
  const vid = textOf(item.vid);
  if (vid === undefined) return null;
  return {
    vid,
    title: stringOf(item.title),
    ...optionalFields([
      ['id', positiveIdOf(item.mvid)],
      ['cover', textOf(item.picurl)],
      ['playCount', countOf(item.playcnt)],
      ['duration', countOf(item.duration)],
      ['publishTime', countOf(item.pubdate)],
    ]),
  };
};

export const singerMvsResult = async (
  query: { mid?: unknown; offset?: unknown; limit?: unknown },
  options: SessionMusicuOptions = {},
): Promise<NewRouteResult> => {
  try {
    const mid = midOf(query.mid);
    const offset = offsetOf(query.offset);
    const limit = limitOf(query.limit, MV_PAGE_SIZE, MAX_MV_PAGE_SIZE);
    const data = await anonymous(options).execute(
      descriptor(
        'MvService.MvInfoProServer',
        'GetSingerMvList',
        { singermid: mid, order: 1, count: limit, start: offset },
        'singer.mvs',
      ),
    );
    const entries = listOf(data.list);
    if (!entries.length) throw new QqApiError('not-found');
    const { items, consumed } = pageOf(entries, 0, limit, toMv);
    return okResult({ mvs: items, ...totalFields(countOf(data.total), offset + consumed) });
  } catch (error) {
    return failureResult('get-singer-mvs', error);
  }
};
