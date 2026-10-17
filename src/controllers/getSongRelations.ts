import type { Context } from 'koa';
import services from '../services';
import type { NewRouteResult } from '../services/recommend/newRouteResult';
import { getTypedQuery } from '../types/core/request';
import { getAuthToken } from './login';

// src/controllers/getSongRelations.ts
// 相似歌曲、包含这首歌的歌单：都要登录。

const send = (ctx: Context, result: NewRouteResult): void => {
  ctx.status = result.status;
  ctx.set(result.headers);
  ctx.body = result.body;
};

export const getSimilarSongs = async (ctx: Context): Promise<void> => {
  const { id } = getTypedQuery<{ id?: string }>(ctx);
  send(ctx, await services.getSimilarSongs({ token: getAuthToken(ctx), id }));
};

export const getRelatedPlaylists = async (ctx: Context): Promise<void> => {
  const { id } = getTypedQuery<{ id?: string }>(ctx);
  send(ctx, await services.getRelatedPlaylists({ token: getAuthToken(ctx), id }));
};
