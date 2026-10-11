import { QqApiError, toNewRouteErrorResponse } from '../../protocol/errors';
import { logger } from '../../util/logger';
import { summarizeError, type UpstreamPhase } from '../../util/safeError';

// src/services/recommend/newRouteResult.ts
//
// 新路由交给宿主的结果：状态码、header 与 JSON 内容。Koa 和 fetch handler 各自把它写进回应，
// 业务实现只写一份。失败一律走 `toNewRouteErrorResponse`，不套用旧路由的 200＋body 错码规则。

export interface NewRouteResult {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export const okResult = (body: Record<string, unknown>): NewRouteResult => ({
  status: 200,
  headers: {},
  body: { code: 200, ...body },
});

/** 对外只给一般化的文字；日志只记安全的分类与数字，不记凭证、网址或账号 id。 */
export const failureResult = (phase: UpstreamPhase, error: unknown): NewRouteResult => {
  const response = toNewRouteErrorResponse(error);
  if (response.status >= 500 || response.status === 429)
    logger.warn('recommend.request-failed', {
      phase,
      ...(error instanceof QqApiError ? error.toJSON() : summarizeError(error)),
    });
  return response;
};
