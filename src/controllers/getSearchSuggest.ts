import type { Context } from 'koa';
import type { NewRouteResult } from '../services/recommend/newRouteResult';
import { hotSearchesResult, searchSuggestionsResult } from '../services/search/suggest';
import { getTypedQuery } from '../types/core/request';

// src/controllers/getSearchSuggest.ts
// 公开内容，匿名读：不解析会话。

const send = (ctx: Context, result: NewRouteResult): void => {
  ctx.status = result.status;
  ctx.set(result.headers);
  ctx.body = result.body;
};

export const getHotSearches = async (ctx: Context): Promise<void> =>
  send(ctx, await hotSearchesResult());

export const getSearchSuggestions = async (ctx: Context): Promise<void> => {
  const { keyword } = getTypedQuery<{ keyword?: string }>(ctx);
  send(ctx, await searchSuggestionsResult(keyword));
};
