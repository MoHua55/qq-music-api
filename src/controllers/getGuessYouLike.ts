import type { Context } from 'koa';
import services from '../services';
import { getAuthToken } from './login';

// src/controllers/getGuessYouLike.ts

export default async (ctx: Context): Promise<void> => {
  const result = await services.getGuessYouLike({ token: getAuthToken(ctx) });
  ctx.status = result.status;
  ctx.set(result.headers);
  ctx.body = result.body;
};
