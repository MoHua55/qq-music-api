import type { Context } from 'koa';
import { mvDetailResult, mvListResult, mvUrlResult, songMvsResult } from '../services/mv/catalog';
import type { NewRouteResult } from '../services/recommend/newRouteResult';
import { getTypedQuery } from '../types/core/request';

// src/controllers/getMvCatalog.ts
// 公开内容，匿名读：不解析会话。

const send = (ctx: Context, result: NewRouteResult): void => {
  ctx.status = result.status;
  ctx.set(result.headers);
  ctx.body = result.body;
};

export const getMvList = async (ctx: Context): Promise<void> => {
  const { area, version, offset, limit } = getTypedQuery<{
    area?: string;
    version?: string;
    offset?: string;
    limit?: string;
  }>(ctx);
  send(ctx, await mvListResult({ area, version, offset, limit }));
};

export const getMvDetail = async (ctx: Context): Promise<void> =>
  send(ctx, await mvDetailResult(getTypedQuery<{ vid?: string }>(ctx).vid));

export const getMvUrl = async (ctx: Context): Promise<void> =>
  send(ctx, await mvUrlResult(getTypedQuery<{ vid?: string }>(ctx).vid));

export const getSongMvs = async (ctx: Context): Promise<void> =>
  send(ctx, await songMvsResult(getTypedQuery<{ id?: string }>(ctx).id));
