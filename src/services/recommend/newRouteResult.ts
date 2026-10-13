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

/** 错误核心已经验证过的数字字段；诊断只取这几个。 */
const SAFE_NUMBER_KEYS = [
  'upstreamCode',
  'upstreamGlobalCode',
  'upstreamSubCode',
  'upstreamHttpStatus',
  'retryAfterMs',
] as const;

/**
 * 开发诊断：debug 级别，平时看不到，LOG_LEVEL=debug 才输出。
 * 只放 phase、状态码、errorKey 和安全整数，不放凭证、账号 id、网址或上游原文。
 */
export const diagnose = (
  phase: UpstreamPhase,
  details: { status: number; errorKey?: string } & Record<string, number | string | undefined>,
): void => {
  logger.debug('recommend.request-diagnostic', { phase, ...details });
};

/**
 * 对外只给一般化的文字。5xx 与 429 写一条 warn；401、422 这类预期中的结果只写 debug 诊断，
 * 同一个失败不重复记。
 */
export const failureResult = (phase: UpstreamPhase, error: unknown): NewRouteResult => {
  const response = toNewRouteErrorResponse(error);
  if (response.status >= 500 || response.status === 429) {
    logger.warn('recommend.request-failed', {
      phase,
      ...(error instanceof QqApiError ? error.toJSON() : summarizeError(error)),
    });
    return response;
  }
  const numbers: Record<string, number> = {};
  for (const key of SAFE_NUMBER_KEYS) {
    const value = response.body[key];
    if (typeof value === 'number' && Number.isSafeInteger(value)) numbers[key] = value;
  }
  diagnose(phase, { status: response.status, errorKey: response.body.errorKey, ...numbers });
  return response;
};
