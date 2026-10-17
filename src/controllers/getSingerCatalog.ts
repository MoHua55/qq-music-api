import type { Context } from 'koa';
import type { NewRouteResult } from '../services/recommend/newRouteResult';
import {
  similarSingersResult,
  singerDetailResult,
  singerHomepageResult,
  singerListResult,
  singerMvsResult,
  singerSongsResult,
} from '../services/singers/catalog';
import { getTypedQuery } from '../types/core/request';

// src/controllers/getSingerCatalog.ts
// 公开内容，匿名读：不解析会话。

const send = (ctx: Context, result: NewRouteResult): void => {
  ctx.status = result.status;
  ctx.set(result.headers);
  ctx.body = result.body;
};

type PageQuery = { mid?: string; offset?: string; limit?: string };

export const listSingers = async (ctx: Context): Promise<void> => {
  const { area, sex, genre, index, offset, limit } = getTypedQuery<{
    area?: string;
    sex?: string;
    genre?: string;
    index?: string;
    offset?: string;
    limit?: string;
  }>(ctx);
  send(ctx, await singerListResult({ area, sex, genre, index, offset, limit }));
};

export const getSingerDetail = async (ctx: Context): Promise<void> =>
  send(ctx, await singerDetailResult(getTypedQuery<{ mid?: string }>(ctx).mid));

export const getSingerHomepage = async (ctx: Context): Promise<void> =>
  send(ctx, await singerHomepageResult(getTypedQuery<{ mid?: string }>(ctx).mid));

export const getSimilarSingers = async (ctx: Context): Promise<void> =>
  send(ctx, await similarSingersResult(getTypedQuery<{ mid?: string }>(ctx).mid));

export const getSingerSongs = async (ctx: Context): Promise<void> => {
  const { mid, offset, limit } = getTypedQuery<PageQuery>(ctx);
  send(ctx, await singerSongsResult({ mid, offset, limit }));
};

export const getSingerMvs = async (ctx: Context): Promise<void> => {
  const { mid, offset, limit } = getTypedQuery<PageQuery>(ctx);
  send(ctx, await singerMvsResult({ mid, offset, limit }));
};
