import type { Context } from 'koa';
import {
  categoryPlaylistsResult,
  newAlbumsResult,
  newSongsResult,
  playlistCategoriesResult,
  toplistSongsResult,
  toplistsResult,
} from '../services/recommend/catalog';
import type { NewRouteResult } from '../services/recommend/newRouteResult';
import { getTypedQuery } from '../types/core/request';

// src/controllers/getRecommendCatalog.ts
// 公开内容，匿名读：不解析会话。

const send = (ctx: Context, result: NewRouteResult): void => {
  ctx.status = result.status;
  ctx.set(result.headers);
  ctx.body = result.body;
};

export const getPlaylistCategories = async (ctx: Context): Promise<void> =>
  send(ctx, await playlistCategoriesResult());

export const getCategoryPlaylists = async (ctx: Context): Promise<void> => {
  const { id, page, limit } = getTypedQuery<{ id?: string; page?: string; limit?: string }>(ctx);
  send(ctx, await categoryPlaylistsResult({ id, page, limit }));
};

export const getNewSongs = async (ctx: Context): Promise<void> => {
  const { area } = getTypedQuery<{ area?: string }>(ctx);
  send(ctx, await newSongsResult(area));
};

export const getNewAlbums = async (ctx: Context): Promise<void> => {
  const { area, offset, limit } = getTypedQuery<{
    area?: string;
    offset?: string;
    limit?: string;
  }>(ctx);
  send(ctx, await newAlbumsResult({ area, offset, limit }));
};

export const getRecommendToplists = async (ctx: Context): Promise<void> =>
  send(ctx, await toplistsResult());

export const getRecommendToplistSongs = async (ctx: Context): Promise<void> => {
  const { id, period, offset, limit } = getTypedQuery<{
    id?: string;
    period?: string;
    offset?: string;
    limit?: string;
  }>(ctx);
  send(ctx, await toplistSongsResult({ id, period, offset, limit }));
};
