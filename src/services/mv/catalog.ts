import { QqApiError } from '../../protocol/errors';
import type { MusicuDescriptor } from '../../protocol/musicu';
import { type Dictionary, dictionaryOf, isDictionary, stringOf } from '../auth/values';
import { failureResult, type NewRouteResult, okResult } from '../recommend/newRouteResult';
import { createSessionMusicuClient, type SessionMusicuOptions } from '../recommend/sessionMusicu';

// src/services/mv/catalog.ts
//
// `/mv/list`、`/mv/detail`、`/mv/url`、`/song/mvs`：公开内容，一律匿名读，带了会话也不用。Node 与 serverless 共用。
// 实测（2026-10，匿名网页 comm）：
// - 清单 `MvInfoProServer.GetAllocMvInfo { area, version, order, start, size }`（`list[]`、`total`），
//   筛选值 `GetAllocTag {}`（`area[]`、`version[]`，`{ id, name }`），两支放在同一次请求里。
// - 详情 `VideoDataServer.get_video_info_batch { vidlist, required }`，回包以 vid 为键。
// - 播放链接 `MvUrlProxy.GetMvUrls { vids, request_type: 10003, guid }`，以 vid 为键，`mp4[]`／`hls[]` 每档
//   有 `filetype`、`code`、`url[]`、`freeflow_url[]`、`fileSize`；匿名时只有 mp4 的几档 `code 0` 有链接，
//   更高的几档是 1000、hls 全是 2050，这里只交出有链接的 mp4。
// - 歌曲相关 MV `MvInfoProServer.GetSongRelatedMv { songid（字符串）, songtype: 1, lastmvid: 0 }`
//   → `list[]`、`hasmore`（数字）。

const DEFAULT_AREA = 15;
const DEFAULT_VERSION = 7;
const PAGE_SIZE = 20;
/** 实测一次要 10 支照给；更大的没有验证过，先和其他列表一样最多 40。 */
const MAX_PAGE_SIZE = 40;
const FILTER_PATTERN = /^\d{1,4}$/;
const VID_PATTERN = /^[0-9A-Za-z]{1,32}$/;
const SONG_ID_PATTERN = /^\d{1,15}$/;
const DETAIL_FIELDS = [
  'vid',
  'name',
  'desc',
  'cover_pic',
  'duration',
  'playcnt',
  'pubdate',
  'singers',
] as const;
const URL_REQUEST_TYPE = 10003;

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

/** 筛选值：不给就用默认，给了就要是正整数。 */
const filterOf = (raw: unknown, fallback: number): number => {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const text = String(raw);
  if (!FILTER_PATTERN.test(text) || Number(text) <= 0) throw new QqApiError('input');
  return Number(text);
};

const vidOf = (raw: unknown): string => {
  const vid = typeof raw === 'string' ? raw : '';
  if (!VID_PATTERN.test(vid)) throw new QqApiError('input');
  return vid;
};

/** 必填的数字歌曲 id，和 `/song/similar` 一样只认正整数。 */
const songIdOf = (raw: unknown): string => {
  const text = String(raw ?? '');
  if (!SONG_ID_PATTERN.test(text) || Number(text) <= 0) throw new QqApiError('input');
  return String(Number(text));
};

const offsetOf = (raw: unknown): number => {
  const value = Number.parseInt(String(raw ?? ''), 10);
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
};

/** 分页参数和其他路由一样宽松：不是正整数就用默认值，超过上限就压到上限。 */
const limitOf = (raw: unknown): number => {
  const value = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isSafeInteger(value) || value <= 0) return PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, value);
};

/** 每次请求带一个随机 guid；不需要密码学强度，也不能依赖 `node:*`。 */
const guidOf = (): string =>
  Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

const anonymous = (options: SessionMusicuOptions) => createSessionMusicuClient(null, options);

const descriptor = (
  module: string,
  method: string,
  param: Record<string, unknown>,
  operation: MusicuDescriptor['operation'],
): MusicuDescriptor<Dictionary> => ({
  module,
  method,
  param,
  readOnly: true,
  operation,
  decode: decodeDictionary,
});

const singersOf = (value: unknown): Dictionary[] =>
  (Array.isArray(value) ? value : [])
    .map((entry): Dictionary | null => {
      const item = dictionaryOf(entry);
      const mid = textOf(item.mid);
      return mid === undefined ? null : { mid, name: stringOf(item.name) };
    })
    .filter((item): item is Dictionary => item !== null);

/** 清单与歌曲相关 MV 的条目：没有 vid 的跳过。 */
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
    singers: singersOf(item.singers),
  };
};

/** 空清单回 422；给了条目却一支都读不出来回 502。 */
const mvsOf = (entries: unknown[]): Dictionary[] => {
  if (!entries.length) throw new QqApiError('not-found');
  const mvs = entries.map(toMv).filter((item): item is Dictionary => item !== null);
  if (!mvs.length) throw new QqApiError('invalid-response');
  return mvs;
};

// ---- MV 清单 ----

const toTag = (entry: unknown): Dictionary | null => {
  const item = dictionaryOf(entry);
  const id = positiveIdOf(item.id);
  return id === undefined ? null : { id, name: stringOf(item.name) };
};

/** 筛选值读不到时照样回 MV，`tags` 是空的。 */
export const mvListResult = async (
  query: { area?: unknown; version?: unknown; offset?: unknown; limit?: unknown },
  options: SessionMusicuOptions = {},
): Promise<NewRouteResult> => {
  try {
    const area = filterOf(query.area, DEFAULT_AREA);
    const version = filterOf(query.version, DEFAULT_VERSION);
    const start = offsetOf(query.offset);
    const size = limitOf(query.limit);
    const [tagResult, listResult] = await anonymous(options).executeBatch([
      descriptor('MvService.MvInfoProServer', 'GetAllocTag', {}, 'mv.tags'),
      descriptor(
        'MvService.MvInfoProServer',
        'GetAllocMvInfo',
        { area, version, order: 0, start, size },
        'mv.list',
      ),
    ]);
    if (!listResult.ok) throw listResult.error;
    const data = listResult.data as Dictionary;
    const entries = listOf(data.list);
    const mvs = mvsOf(entries);
    const tags = tagResult.ok ? (tagResult.data as Dictionary) : {};
    const total = countOf(data.total);
    return okResult({
      mvs,
      tags: Object.fromEntries(
        (['area', 'version'] as const).map((key) => [
          key,
          Array.isArray(tags[key]) ? tags[key].map(toTag).filter(Boolean) : [],
        ]),
      ),
      ...(total === undefined ? {} : { total }),
      more: total !== undefined && start + entries.length < total,
    });
  } catch (error) {
    return failureResult('get-mv-list', error);
  }
};

// ---- MV 详情 ----

export const mvDetailResult = async (
  rawVid: unknown,
  options: SessionMusicuOptions = {},
): Promise<NewRouteResult> => {
  try {
    const vid = vidOf(rawVid);
    const data = await anonymous(options).execute(
      descriptor(
        'video.VideoDataServer',
        'get_video_info_batch',
        { vidlist: [vid], required: [...DETAIL_FIELDS] },
        'mv.detail',
      ),
    );
    if (data[vid] === undefined || data[vid] === null) throw new QqApiError('not-found');
    const item = dictionaryOf(data[vid]);
    const itemVid = textOf(item.vid);
    if (itemVid === undefined) throw new QqApiError('invalid-response');
    return okResult({
      mv: {
        vid: itemVid,
        title: stringOf(item.name),
        ...optionalFields([
          ['desc', textOf(item.desc)],
          ['cover', textOf(item.cover_pic)],
          ['playCount', countOf(item.playcnt)],
          ['duration', countOf(item.duration)],
          ['publishTime', countOf(item.pubdate)],
        ]),
        singers: singersOf(item.singers),
      },
    });
  } catch (error) {
    return failureResult('get-mv-detail', error);
  }
};

// ---- MV 播放链接 ----

const linksOf = (file: Dictionary): string[] => [
  ...new Set(
    [file.url, file.freeflow_url]
      .flatMap((list) => (Array.isArray(list) ? list : []))
      .filter((url): url is string => typeof url === 'string' && /^https?:\/\//.test(url)),
  ),
];

/** 只交出 `code 0` 而且真的有 http 链接的 mp4；一档都没有回 422。 */
export const mvUrlResult = async (
  rawVid: unknown,
  options: SessionMusicuOptions = {},
): Promise<NewRouteResult> => {
  try {
    const vid = vidOf(rawVid);
    const data = await anonymous(options).execute(
      descriptor(
        'music.stream.MvUrlProxy',
        'GetMvUrls',
        { vids: [vid], request_type: URL_REQUEST_TYPE, guid: guidOf() },
        'mv.url',
      ),
    );
    if (data[vid] === undefined || data[vid] === null) throw new QqApiError('not-found');
    const files = listOf(dictionaryOf(data[vid]).mp4)
      .map((entry) => {
        const file = dictionaryOf(entry);
        const quality = countOf(file.filetype);
        const urls = linksOf(file);
        if (file.code !== 0 || quality === undefined || !urls.length) return null;
        return { quality, ...optionalFields([['size', countOf(file.fileSize)]]), urls };
      })
      .filter(Boolean);
    if (!files.length) throw new QqApiError('not-found');
    return okResult({ vid, files });
  } catch (error) {
    return failureResult('get-mv-url', error);
  }
};

// ---- 歌曲相关 MV ----

export const songMvsResult = async (
  rawId: unknown,
  options: SessionMusicuOptions = {},
): Promise<NewRouteResult> => {
  try {
    const songId = songIdOf(rawId);
    const data = await anonymous(options).execute(
      descriptor(
        'MvService.MvInfoProServer',
        'GetSongRelatedMv',
        { songid: songId, songtype: 1, lastmvid: 0 },
        'song.mvs',
      ),
    );
    return okResult({
      mvs: mvsOf(listOf(data.list)),
      more: data.hasmore === 1 || data.hasmore === true,
    });
  } catch (error) {
    return failureResult('get-song-mvs', error);
  }
};
