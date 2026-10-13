import Koa from 'koa';
import Router from 'koa-router';
import request from 'supertest';
import { operationController } from '../src/controllers/operation';
import type { OperationRequest, OperationResult } from '../src/routes/operations/types';
import { operationRoute } from '../src/serverless/operationRoute';
import type { QrLoginService } from '../src/services/auth/qrLogin';
import qrLoginService from '../src/services/auth/qrLogin.node';

// 两边的转接把请求整理成同一个形状；后面每条路由搬过来都靠这里的语义，所以单独固定。

interface Seen {
  runtime: OperationRequest['runtime'];
  query: Record<string, string | undefined>;
  queryRaw: Record<string, string | string[] | undefined>;
  params: OperationRequest['params'];
  token: string | undefined;
  service: QrLoginService;
}

const RESULT: OperationResult = {
  status: 201,
  headers: { 'x-operation': 'fixture' },
  body: { code: 201, data: { ok: true } },
};

const NAMES = ['x', 'empty', 'missing'];

const recordingHandler = () => {
  const seen: Seen[] = [];
  const handler = async (operation: OperationRequest): Promise<OperationResult> => {
    seen.push({
      runtime: operation.runtime,
      query: Object.fromEntries(NAMES.map((name) => [name, operation.query(name)])),
      queryRaw: Object.fromEntries(NAMES.map((name) => [name, operation.queryRaw(name)])),
      params: operation.params,
      token: operation.token,
      service: await operation.service(),
    });
    return RESULT;
  };
  return { seen, handler };
};

describe('Koa 转接', () => {
  const call = (path: string, headers: Record<string, string> = {}) => {
    const { seen, handler } = recordingHandler();
    const host = new Koa();
    const router = new Router();
    router.get('/probe/:id?', operationController(handler));
    host.use(router.routes());
    return { seen, response: request(host.callback()).get(path).set(headers) };
  };

  it('整理出共用请求，并把结果写回回应', async () => {
    const { seen, response } = call('/probe/fixture-id?x=a&x=b&empty=', {
      'X-QQ-Session': 'fixture-header-token',
    });
    const result = await response;

    expect(seen).toEqual([
      {
        runtime: 'node',
        query: { x: 'a', empty: '', missing: undefined },
        queryRaw: { x: ['a', 'b'], empty: '', missing: undefined },
        params: { id: 'fixture-id' },
        token: 'fixture-header-token',
        service: qrLoginService,
      },
    ]);
    expect(result.status).toBe(201);
    expect(result.headers['x-operation']).toBe('fixture');
    expect(result.body).toEqual(RESULT.body);
  });

  it('没有 header 时从 query 的 cookie 取 token，可选路径参数缺席就没有这个键', async () => {
    const { seen, response } = call('/probe?cookie=qqmusic_session%3Dfixture-query-token');
    await response;

    expect(seen[0].token).toBe('fixture-query-token');
    expect(seen[0].params).toEqual({});
  });
});

describe('serverless 转接', () => {
  it('整理出共用请求，两种 query 取法都只给第一个值，结果写成 JSON 回应', async () => {
    const { seen, handler } = recordingHandler();
    const service = { fixture: 'service' } as unknown as QrLoginService;

    const response = await operationRoute(handler)({
      url: new URL('https://worker.invalid/probe/fixture-id?x=a&x=b&empty='),
      params: { id: 'fixture-id' },
      token: 'fixture-token',
      service: async () => service,
    });

    expect(seen).toEqual([
      {
        runtime: 'serverless',
        query: { x: 'a', empty: '', missing: undefined },
        queryRaw: { x: 'a', empty: '', missing: undefined },
        params: { id: 'fixture-id' },
        token: 'fixture-token',
        service,
      },
    ]);
    expect(response.status).toBe(201);
    expect(response.headers.get('x-operation')).toBe('fixture');
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await response.json()).toEqual(RESULT.body);
  });

  it('handler 用不到登录服务时不去建它', async () => {
    const service = jest.fn<Promise<QrLoginService>, []>();

    const response = await operationRoute(async () => RESULT)({
      url: new URL('https://worker.invalid/probe'),
      params: {},
      token: undefined,
      service,
    });

    expect(response.status).toBe(201);
    expect(service).not.toHaveBeenCalled();
  });
});
