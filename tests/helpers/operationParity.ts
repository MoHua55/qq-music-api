import Koa from 'koa';
import Router from 'koa-router';
import request from 'supertest';
import { operationController } from '../../src/controllers/operation';
import type { OperationHandler } from '../../src/routes/operations/types';
import { createFetchLegacyTransport } from '../../src/serverless/fetchLegacyTransport';
import { type OperationRouteContext, operationRoute } from '../../src/serverless/operationRoute';
import { failureResponse } from '../../src/serverless/response';
import { createRouter } from '../../src/serverless/router';
import type { QrLoginService } from '../../src/services/auth/qrLogin';
import { setLegacyHttpTransport } from '../../src/services/httpTransport';
import { withControllerLogging } from '../../src/util/observability';
import {
  type CatalogRuntimeName,
  callRoute,
  type RouteResult,
  type UpstreamCall,
} from './catalogRoutes';

/**
 * 新旧实现比对：同一个请求跑三次，旧实现、新的共用 handler、真正的宿主，比状态码、内容和送到上游的
 * 请求。
 *
 * - 旧实现和新 handler 放在同一个最小宿主上跑，差别只剩路由实现本身。Node 是只挂这一条路由的 Koa，
 *   两边都包上真正的 app 用的同一层 `withControllerLogging`；serverless 是只认这一条路由的 router，
 *   加上入口同样的传输登记与异常兜底（`failureResponse`）。
 * - 真正的宿主是 `app.callback()` 与 `handleRequest`。切换之前它跑旧实现，切换之后跑新 handler，
 *   所以它和旧实现一致，就说明切换没有改到对外行为。
 *
 * 上游用 `useCatalogUpstream` 替换，每一轮开始前清空它记下的请求。
 */

type KoaController = (ctx: Koa.Context) => Promise<unknown> | unknown;
type FetchRoute = (context: OperationRouteContext) => Promise<Response>;
type Leg = (path: string) => Promise<RouteResult>;

export interface ParityRoute {
  /** 包日志用的 controller 名字，和 `src/controllers/index.ts` 一致。 */
  name: string;
  /** Koa 路由表里的写法，例如 `/getAlbumInfo/:albummid?`。 */
  node: string;
  /** serverless 路由表里的写法，例如 `/getAlbumInfo`。 */
  serverless: string;
}

export interface ParityImplementations {
  /** `src/controllers/` 里的旧 controller。 */
  legacyNode: KoaController;
  /** `src/serverless/legacyRoutes.ts` 里的旧实现。 */
  legacyServerless: FetchRoute;
  operation: OperationHandler;
}

export interface ParityLeg extends RouteResult {
  /** 这一轮送到上游的请求。 */
  calls: UpstreamCall[];
}

export interface ParityResult {
  legacy: ParityLeg;
  operation: ParityLeg;
  host: ParityLeg;
}

const koaHost = (route: ParityRoute, controller: KoaController): Leg => {
  const host = new Koa();
  const router = new Router();
  router.get(route.node, withControllerLogging(route.name, controller));
  host.use(router.routes());
  const callback = host.callback();
  return async (path) => {
    const response = await request(callback).get(path);
    return { status: response.status, body: response.body };
  };
};

const noService = (): Promise<QrLoginService> =>
  Promise.reject(new Error('This parity case does not provide a login service'));

const fetchHost = (route: ParityRoute, handler: FetchRoute): Leg => {
  const match = createRouter({ [route.serverless]: handler });
  return async (path) => {
    const url = new URL(`https://parity.invalid${path}`);
    const matched = match(url.pathname);
    if (!matched) throw new Error(`${path} does not match ${route.serverless}`);
    setLegacyHttpTransport(createFetchLegacyTransport());
    let response: Response;
    try {
      response = await matched.handler({
        url,
        params: matched.params,
        token: undefined,
        service: noService,
      });
    } catch (error) {
      response = failureResponse(error);
    }
    return { status: response.status, body: await response.json() };
  };
};

export const createParityRunner = (route: ParityRoute, implementations: ParityImplementations) => {
  const legs: Record<CatalogRuntimeName, { legacy: Leg; operation: Leg }> = {
    node: {
      legacy: koaHost(route, implementations.legacyNode),
      operation: koaHost(route, operationController(implementations.operation)),
    },
    serverless: {
      legacy: fetchHost(route, implementations.legacyServerless),
      operation: fetchHost(route, operationRoute(implementations.operation)),
    },
  };

  const run = async (leg: Leg, path: string, calls: UpstreamCall[]): Promise<ParityLeg> => {
    calls.length = 0;
    const result = await leg(path);
    return { ...result, calls: calls.slice() };
  };

  return async (
    runtime: CatalogRuntimeName,
    path: string,
    calls: UpstreamCall[],
  ): Promise<ParityResult> => ({
    legacy: await run(legs[runtime].legacy, path, calls),
    operation: await run(legs[runtime].operation, path, calls),
    host: await run((target) => callRoute(runtime, target), path, calls),
  });
};
