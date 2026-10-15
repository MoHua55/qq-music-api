import type { OperationHandler, OperationRequest } from '../routes/operations/types';
import type { QrLoginService } from '../services/auth/qrLogin';
import type { ServerlessEnv, ServerlessOptions } from './index';
import { createServerlessQrOperations } from './qrOperations';
import { capabilitiesFor } from './qrRuntime';
import { json } from './response';

// src/serverless/operationRoute.ts
//
// serverless 这边的转接：把入口整理好的路由上下文交给共用 handler，再把结果写成 JSON 回应。
// 异常不在这里接，照旧由入口的 `failureResponse` 处理。

/** 入口路由上下文里转接用得到的部分。 */
export interface OperationRouteContext {
  request?: Request;
  env?: ServerlessEnv;
  options?: ServerlessOptions;
  url: URL;
  params: Record<string, string>;
  token: string | undefined;
  service: () => Promise<QrLoginService>;
}

export const operationRequestOf = ({
  url,
  params,
  token,
  service,
  env,
  options,
  request,
}: OperationRouteContext): OperationRequest => ({
  runtime: 'serverless',
  unverifiedWritesEnabled: env?.QQ_UNVERIFIED_WRITES_ENABLED === '1',
  method: request?.method ?? 'GET',
  body: async () => request?.json(),
  query: (name) => url.searchParams.get(name) ?? undefined,
  // serverless 原来就只读第一个值，两个取法在这边是同一个。
  queryRaw: (name) => url.searchParams.get(name) ?? undefined,
  params,
  token,
  sessionConfigured: Boolean(env?.QQ_SESSION_SECRET),
  service,
  qr: createServerlessQrOperations({ env: env ?? {}, options: options ?? {}, service }),
  capabilities: capabilitiesFor(options ?? {}),
});

export const operationRoute =
  (handler: OperationHandler) =>
  async (context: OperationRouteContext): Promise<Response> => {
    const result = await handler(operationRequestOf(context));
    return json(result.body, result.status, result.headers);
  };
