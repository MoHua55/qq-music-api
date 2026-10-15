import type { Context } from 'koa';
import services from '../services';
import { getTypedQuery } from '../types/core/request';
import { getAuthToken } from './login';

// src/controllers/getSearch.ts

interface SearchQuery {
  keyword?: string;
  type?: string;
  page?: string;
  limit?: string;
}

export default async (ctx: Context): Promise<void> => {
  const { keyword, type, page, limit } = getTypedQuery<SearchQuery>(ctx);
  const result = await services.getSearch({ token: getAuthToken(ctx), keyword, type, page, limit });
  ctx.status = result.status;
  ctx.set(result.headers);
  ctx.body = result.body;
};
