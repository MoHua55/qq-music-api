import type { Context } from 'koa';
import { songLabelsResult } from '../services/recommend/songLabels';
import { getTypedQuery } from '../types/core/request';

// src/controllers/getSongLabels.ts
// 公开内容，匿名读：不解析会话。

export default async (ctx: Context): Promise<void> => {
  const result = await songLabelsResult(getTypedQuery<{ id?: string }>(ctx).id);
  ctx.status = result.status;
  ctx.set(result.headers);
  ctx.body = result.body;
};
