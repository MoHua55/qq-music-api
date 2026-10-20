import { QqApiError } from '../../protocol/errors';
import type { MusicuDescriptor } from '../../protocol/musicu';
import { type Dictionary, dictionaryOf, isDictionary, stringOf } from '../../util/values';
import { failureResult, type NewRouteResult, okResult } from '../recommend/newRouteResult';
import { createSessionMusicuClient, type SessionMusicuOptions } from '../recommend/sessionMusicu';

// src/services/comments/catalog.ts
//
// `/comment/hot`、`/comment/new`、`/comment/count`：歌曲评论，公开内容，一律匿名读，带了会话也不用。
// Node 与 serverless 共用。实测（2026-10，匿名网页 comm）：热评、新评是 `CommentRead.GetHotCommentList`／
// `GetNewCommentList`，评论在 `CommentList.Comments[]`（`CmId`、`Content`、`Nick`、`PraiseNum`、`PubTime`…），
// `HasMore` 是数字；评论数是 `CommentCountSrv.GetCmCount`，成功时单项码是 10000，数字在 `response.count`。
// 翻页用 `PageNum`（从 0 开始）＋`PageSize`；第二页以后没有完整实测过。

/** 歌曲评论。 */
const SONG_BIZ_TYPE = 1;
const PAGE_SIZE = 20;
/** 上游网页一次要 15–25 则；更大的没有验证过。 */
const MAX_PAGE_SIZE = 50;
/** 实测这个服务成功时单项码是 10000（资料完整），也接受 0。 */
const COUNT_OK_CODES = [10000] as const;
const ID_PATTERN = /^\d{1,15}$/;

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

/** 必填的数字歌曲 id，和 `/song/similar` 一样只认正整数。 */
const songIdOf = (raw: unknown): string => {
  const text = String(raw ?? '');
  if (!ID_PATTERN.test(text) || Number(text) <= 0) throw new QqApiError('input');
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

const anonymous = (options: SessionMusicuOptions) => createSessionMusicuClient(null, options);

const toComment = (entry: unknown): Dictionary | null => {
  const item = dictionaryOf(entry);
  const id = textOf(item.CmId);
  if (id === undefined) return null;
  const optional: Array<[string, unknown]> = [
    ['avatar', textOf(item.Avatar)],
    ['praiseCount', countOf(item.PraiseNum)],
    ['time', countOf(item.PubTime)],
    ['replyCount', countOf(item.ReplyCnt)],
    ['location', textOf(item.Location)],
  ];
  return {
    id,
    content: stringOf(item.Content),
    nick: stringOf(item.Nick),
    ...Object.fromEntries(optional.filter(([, value]) => value !== undefined)),
  };
};

type CommentKind = 'hot' | 'new';

const KIND_REQUESTS: Record<
  CommentKind,
  { method: string; extra: Record<string, unknown>; phase: 'get-hot-comments' | 'get-new-comments' }
> = {
  hot: {
    method: 'GetHotCommentList',
    extra: { HotType: 1, WithAirborne: 0, PicEnable: 1 },
    phase: 'get-hot-comments',
  },
  new: {
    method: 'GetNewCommentList',
    // 不要上游把热评混进新评的回包。
    extra: { FromCommentId: '', WithHot: 0, PicEnable: 1 },
    phase: 'get-new-comments',
  },
};

const commentList = (
  kind: CommentKind,
  songId: string,
  page: number,
  size: number,
): MusicuDescriptor<Dictionary> => ({
  module: 'music.globalComment.CommentRead',
  method: KIND_REQUESTS[kind].method,
  param: {
    BizType: SONG_BIZ_TYPE,
    BizId: songId,
    LastCommentSeqNo: '',
    PageSize: size,
    PageNum: page,
    ...KIND_REQUESTS[kind].extra,
  },
  readOnly: true,
  operation: kind === 'hot' ? 'comment.hot' : 'comment.new',
  decode: decodeDictionary,
});

/**
 * offset 换算成上游的第几页（`floor(offset / limit)`，从 0 开始）。只读 `CommentList`，
 * 不读同一个回包里的 `CommentList2`、`CommentList3`。空页回 422；有评论却一则都读不出来回 502。
 */
const commentsResult = async (
  kind: CommentKind,
  query: { id?: unknown; offset?: unknown; limit?: unknown },
  options: SessionMusicuOptions,
): Promise<NewRouteResult> => {
  try {
    const songId = songIdOf(query.id);
    const size = limitOf(query.limit);
    const page = Math.floor(offsetOf(query.offset) / size);
    const data = await anonymous(options).execute(commentList(kind, songId, page, size));
    const list = dictionaryOf(data.CommentList);
    const entries = listOf(list.Comments);
    if (!entries.length) throw new QqApiError('not-found');
    const comments = entries.map(toComment).filter(Boolean);
    if (!comments.length) throw new QqApiError('invalid-response');
    const total = countOf(list.Total);
    return okResult({
      comments,
      ...(total === undefined ? {} : { total }),
      more: list.HasMore === 1 || list.HasMore === true,
    });
  } catch (error) {
    return failureResult(KIND_REQUESTS[kind].phase, error);
  }
};

export const hotCommentsResult = (
  query: { id?: unknown; offset?: unknown; limit?: unknown },
  options: SessionMusicuOptions = {},
): Promise<NewRouteResult> => commentsResult('hot', query, options);

export const newCommentsResult = (
  query: { id?: unknown; offset?: unknown; limit?: unknown },
  options: SessionMusicuOptions = {},
): Promise<NewRouteResult> => commentsResult('new', query, options);

export const commentCountResult = async (
  rawId: unknown,
  options: SessionMusicuOptions = {},
): Promise<NewRouteResult> => {
  try {
    const songId = songIdOf(rawId);
    const data = await anonymous(options).execute({
      module: 'music.globalComment.CommentCountSrv',
      method: 'GetCmCount',
      param: { biz_id: songId, biz_type: SONG_BIZ_TYPE },
      readOnly: true,
      operation: 'comment.count',
      allowedCodes: COUNT_OK_CODES,
      decode: decodeDictionary,
    });
    const count = countOf(dictionaryOf(data.response).count);
    if (count === undefined) throw new QqApiError('invalid-response');
    return okResult({ id: Number(songId), count });
  } catch (error) {
    return failureResult('get-comment-count', error);
  }
};
