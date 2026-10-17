import type { Context } from 'koa';
import services from '../services';
import { getTypedQuery } from '../types/core/request';
import { getAuthToken } from './login';

// src/controllers/getRecommendRadar.ts

interface RadarQuery {
  page?: string;
}

export default async (ctx: Context): Promise<void> => {
  const { page } = getTypedQuery<RadarQuery>(ctx);
  const result = await services.getRadar({ token: getAuthToken(ctx), page });
  ctx.status = result.status;
  ctx.set(result.headers);
  ctx.body = result.body;
};
