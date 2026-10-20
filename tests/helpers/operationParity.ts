import Koa from 'koa';
import Router from 'koa-router';
import request from 'supertest';
import { operationController } from '../../src/controllers/operation';
import type { OperationHandler } from '../../src/routes/operations/types';
import { type OperationRouteContext, operationRoute } from '../../src/serverless/operationRoute';
import { failureResponse } from '../../src/serverless/response';
import { createRouter } from '../../src/serverless/router';
import type { QrLoginService } from '../../src/services/auth/qrLogin';
import { setLegacyHttpTransport } from '../../src/services/httpTransport';
import { createFetchLegacyTransport } from '../../src/transport/fetchLegacyTransport';
import { withControllerLogging } from '../../src/util/observability';
import {
  type CatalogRuntimeName,
  callRoute,
  type RouteCallOptions,
  type RouteResult,
  selectedHeaders,
  type UpstreamCall,
} from './catalogRoutes';

/**
 * 共用处理与真实宿主跑相同合成案例，比状态、回包、标头与完整上游请求。
 * Node 最小宿主保留 Koa 和真实日志兜底；serverless 最小宿主保留路由和异常兜底。
 * 旧实现已经退役，历史基准继续通过独立的 npm tarball 和 main 快照做比对。
 */

type KoaController = (ctx: Koa.Context) => Promise<unknown> | unknown;
type FetchRoute = (
  context: OperationRouteContext & {
    env: NonNullable<RouteCallOptions['env']>;
    options: NonNullable<RouteCallOptions['options']>;
  },
) => Promise<Response>;
type Leg = (path: string, options: ParityCallOptions) => Promise<RouteResult>;

export interface ParityCallOptions {
  /** 以 X-QQ-Session 发给最小宿主与真实宿主；不传就是本次请求没有 token。 */
  token?: string;
  env?: RouteCallOptions['env'];
  options?: RouteCallOptions['options'];
  /** 只供最小 serverless 宿主使用；真实入口仍按自己的 env 现建服务。 */
  service?: () => Promise<QrLoginService>;
  responseHeaders?: readonly string[];
  /** 登出等会改变会话；每条腿之前重建测试会话，避免前一条腿影响后一条。 */
  beforeEachLeg?: () => void | Promise<void>;
}

const requestHeaders = (options: ParityCallOptions): Record<string, string> =>
  options.token === undefined ? {} : { 'X-QQ-Session': options.token };

export interface ParityRoute {
  /** 包日志用的 controller 名字，和 `src/controllers/index.ts` 一致。 */
  name: string;
  /** Koa 路由表里的写法，例如 `/getAlbumInfo/:albummid?`。 */
  node: string;
  /** serverless 路由表里的写法，例如 `/getAlbumInfo`。 */
  serverless: string;
}

export interface ParityImplementations {
  operation: OperationHandler;
  /** 需要宿主 Cookie API 的薄转接，例如 logout；仍放在同一个最小 Koa 宿主里比。 */
  operationNode?: KoaController;
}

export interface ParityLeg<Call = UpstreamCall> extends RouteResult {
  /** 这一轮送到上游的请求。 */
  calls: Call[];
}

export interface ParityResult<Call = UpstreamCall> {
  operation: ParityLeg<Call>;
  host: ParityLeg<Call>;
}

const koaHost = (route: ParityRoute, controller: KoaController): Leg => {
  const host = new Koa();
  const router = new Router();
  router.get(route.node, withControllerLogging(route.name, controller));
  host.use(router.routes());
  const callback = host.callback();
  return async (path, options) => {
    const response = await request(callback).get(path).set(requestHeaders(options));
    return {
      status: response.status,
      body: response.body,
      ...selectedHeaders(options.responseHeaders, (name) => response.headers[name.toLowerCase()]),
    };
  };
};

const noService = (): Promise<QrLoginService> =>
  Promise.reject(new Error('This parity case does not provide a login service'));

const fetchHost = (route: ParityRoute, handler: FetchRoute): Leg => {
  const match = createRouter({ [route.serverless]: handler });
  return async (path, options) => {
    const url = new URL(`https://parity.invalid${path}`);
    const matched = match(url.pathname);
    if (!matched) throw new Error(`${path} does not match ${route.serverless}`);
    setLegacyHttpTransport(createFetchLegacyTransport());
    let response: Response;
    try {
      response = await matched.handler({
        url,
        env: options.env ?? {},
        options: options.options ?? {},
        params: matched.params,
        token: options.token,
        service: options.service ?? noService,
      });
    } catch (error) {
      response = failureResponse(error);
    }
    return {
      status: response.status,
      body: await response.json(),
      ...selectedHeaders(options.responseHeaders, (name) =>
        name.toLowerCase() === 'set-cookie'
          ? response.headers.getSetCookie()
          : response.headers.get(name),
      ),
    };
  };
};

export const createParityRunner = (route: ParityRoute, implementations: ParityImplementations) => {
  const legs: Record<CatalogRuntimeName, { operation: Leg }> = {
    node: {
      operation: koaHost(
        route,
        implementations.operationNode ?? operationController(implementations.operation),
      ),
    },
    serverless: {
      operation: fetchHost(route, operationRoute(implementations.operation)),
    },
  };

  const run = async <Call>(
    leg: Leg,
    path: string,
    calls: Call[],
    options: ParityCallOptions,
  ): Promise<ParityLeg<Call>> => {
    await options.beforeEachLeg?.();
    calls.length = 0;
    const result = await leg(path, options);
    return { ...result, calls: calls.slice() };
  };

  return async <Call = UpstreamCall>(
    runtime: CatalogRuntimeName,
    path: string,
    calls: Call[],
    options: ParityCallOptions = {},
  ): Promise<ParityResult<Call>> => ({
    operation: await run(legs[runtime].operation, path, calls, options),
    host: await run(
      (target, context) =>
        callRoute(runtime, target, {
          headers: requestHeaders(context),
          env: context.env,
          options: context.options,
          responseHeaders: context.responseHeaders,
        }),
      path,
      calls,
      options,
    ),
  });
};
