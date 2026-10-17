import type { Context } from 'koa';
import {
  commentCountResult,
  hotCommentsResult,
  newCommentsResult,
} from '../services/comments/catalog';
import type { NewRouteResult } from '../services/recommend/newRouteResult';
import { getTypedQuery } from '../types/core/request';

// src/controllers/getCommentCatalog.ts
// 公开内容，匿名读：不解析会话。

const send = (ctx: Context, result: NewRouteResult): void => {
  ctx.status = result.status;
  ctx.set(result.headers);
  ctx.body = result.body;
};

type PageQuery = { id?: string; offset?: string; limit?: string };

export const getHotComments = async (ctx: Context): Promise<void> => {
  const { id, offset, limit } = getTypedQuery<PageQuery>(ctx);
  send(ctx, await hotCommentsResult({ id, offset, limit }));
};

export const getNewComments = async (ctx: Context): Promise<void> => {
  const { id, offset, limit } = getTypedQuery<PageQuery>(ctx);
  send(ctx, await newCommentsResult({ id, offset, limit }));
};

export const getCommentCount = async (ctx: Context): Promise<void> =>
  send(ctx, await commentCountResult(getTypedQuery<{ id?: string }>(ctx).id));
