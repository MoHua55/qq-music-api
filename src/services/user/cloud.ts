import { QqApiError } from '../../protocol/errors';
import type { MusicuDescriptor } from '../../protocol/musicu';
import { credentialMusicId } from '../auth/androidDevice';
import type { AuthSession } from '../auth/qrLogin';
import { type Dictionary, isDictionary } from '../auth/values';
import { failureResult, type NewRouteResult, okResult } from '../recommend/newRouteResult';
import { createSessionMusicuClient, type SessionMusicuOptions } from '../recommend/sessionMusicu';

// src/services/user/cloud.ts
//
// `/user/cloud`：音乐云盘里的歌，要登录。Node 与 serverless 共用。
// 上游是 `GetMatchAudio`，一页 2000 首、从第 1 页读（2026-10 实测两个账号都回 200，一个空、一个有歌）。
// 外面要的分页在本地切，所以一般一次请求只打一次上游。
// 对得上曲库的歌带一般的曲目格式，照常用 `/getMusicPlay` 播；没对上的自己上传的文件只给资料。

/** 实测用的页长。别的页长没验过，不改。 */
export const CLOUD_PAGE_SIZE = 2000;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;
/** 最多接着读几页（2 万首）；再往后当成读不到，只回已读到的部分。 */
const MAX_PAGES = 10;
/** 这个值表示按原文件处理、不是曲库里的歌；能不能照一般路由播放没有证据，先标成不能播。 */
const MATCHED_ORIGINAL_FILE = 2;

export interface CloudPageInput {
  limit?: string;
  offset?: string;
}

/** 和收藏专辑一样宽松：读不出数字、0 或负数都回默认值，太大就截到上限。 */
export const cloudPageOf = ({ limit, offset }: CloudPageInput) => ({
  offset: Math.max(0, Number.parseInt(String(offset ?? '0'), 10) || 0),
  limit: Math.min(
    MAX_LIMIT,
    Math.max(1, Number.parseInt(String(limit ?? ''), 10) || DEFAULT_LIMIT),
  ),
});

interface CloudPage {
  entries: unknown[];
  hasMore: boolean;
  total?: number;
}

const decode = (data: unknown): CloudPage => {
  if (!isDictionary(data)) throw new QqApiError('invalid-response');
  const list = data.info_list;
  if (list !== null && list !== undefined && !Array.isArray(list))
    throw new QqApiError('invalid-response');
  const { total } = data;
  return {
    entries: Array.isArray(list) ? list : [],
    // has_more 是 1 才表示还有下一页。
    hasMore: data.has_more === 1,
    ...(typeof total === 'number' && Number.isSafeInteger(total) && total >= 0 ? { total } : {}),
  };
};

const cloudPage = (session: AuthSession, pageNo: number): MusicuDescriptor<CloudPage> => ({
  module: 'music.WeiyunMusic.WeiyunMusicRead',
  method: 'GetMatchAudio',
  param: {
    uin: credentialMusicId(session.credential),
    file_id: '',
    page_no: pageNo,
    page_size: CLOUD_PAGE_SIZE,
  },
  readOnly: true,
  operation: 'cloud.list',
  decode,
});

const BASE64 =
  /^(?:[A-Za-z0-9+/]{4})+(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$|^[A-Za-z0-9+/]{2}==$|^[A-Za-z0-9+/]{3}=$/;

/**
 * 文件名是 base64 编码的 UTF-8。看起来不是 base64、或解出来不是正常文字时照原样给，不猜别的编码。
 */
export const cloudFileNameOf = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  if (!BASE64.test(value)) return value;
  try {
    const bytes = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    // biome-ignore lint/suspicious/noControlCharactersInRegex: 文件名里不该有控制字符
    return text && !/[\u0000-\u001f\u007f]/.test(text) ? text : value;
  } catch {
    return value;
  }
};

/** 单位没有文档：小于 1e11 当成秒，换成毫秒；其他照原样当毫秒。 */
const addTimeOf = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return null;
  return value < 1e11 ? value * 1000 : value;
};

/** 只交出歌曲、文件名、加入时间和能不能播；文件 id、本地路径、上传用的字段都不带出去。 */
const toCloudSong = (entry: Dictionary) => {
  const song = isDictionary(entry.song_info) ? entry.song_info : null;
  const mid = song && typeof song.mid === 'string' ? song.mid.trim() : '';
  return {
    song,
    fileName: cloudFileNameOf(entry.filename),
    addTime: addTimeOf(entry.timestamp),
    playable: mid !== '' && entry.matched !== MATCHED_ORIGINAL_FILE,
  };
};

/**
 * 没有会话回 401。从第 1 页起读到盖住要的范围为止（上游说没有下一页就停），再切出那一段。
 * 云盘是空的回 200 加空清单。`count` 用上游的 `total`，没给就用读到的条数。
 */
export const cloudSongsResult = async (
  session: AuthSession | null,
  input: CloudPageInput,
  options: SessionMusicuOptions = {},
): Promise<NewRouteResult> => {
  try {
    if (!session) throw new QqApiError('auth-missing');
    const { offset, limit } = cloudPageOf(input);
    const client = createSessionMusicuClient(session, options);
    const entries: unknown[] = [];
    let total: number | undefined;
    let upstreamHasMore = true;
    for (let pageNo = 1; pageNo <= MAX_PAGES && upstreamHasMore; pageNo += 1) {
      const page = await client.execute(cloudPage(session, pageNo));
      total ??= page.total;
      entries.push(...page.entries);
      upstreamHasMore = page.hasMore && page.entries.length > 0;
      if (entries.length >= offset + limit) break;
    }
    const count = Math.max(total ?? 0, entries.length);
    const data = entries
      .slice(offset, offset + limit)
      .filter(isDictionary)
      .map(toCloudSong);
    const end = Math.min(offset + limit, entries.length);
    return okResult({
      data,
      count,
      hasMore: end < count || (upstreamHasMore && end >= entries.length),
    });
  } catch (error) {
    return failureResult('get-user-cloud', error);
  }
};
