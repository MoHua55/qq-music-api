import type { Context } from 'koa';
import services from '../services';
import { getTypedQuery } from '../types/core/request';
import { getAuthToken } from './login';

// src/controllers/getRecommendPlaylists.ts

interface RecommendPlaylistsQuery {
  limit?: string;
}

export default async (ctx: Context): Promise<void> => {
  const { limit } = getTypedQuery<RecommendPlaylistsQuery>(ctx);
  const result = await services.getRecommendPlaylists({ token: getAuthToken(ctx), limit });
  ctx.status = result.status;
  ctx.set(result.headers);
  ctx.body = result.body;
};
