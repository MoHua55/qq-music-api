import request from 'supertest';
import app from '../src/app';
import { handleRequest } from '../src/serverless';
import { logger } from '../src/util/logger';

interface Seen {
  url: URL;
  init?: RequestInit;
  payload?: Record<string, any>;
}
interface Fixture {
  body?: any;
  http?: number;
  text?: string;
  fail?: boolean;
}

const PATH = '/radio/categories';
const BODY = undefined;
const REPLY = {
  code: 0,
  req_0: {
    code: 0,
    data: {
      radio_list: [
        {
          id: 1,
          title: '测试分类',
          list: [
            { id: 2, title: '测试电台', pic_url: 'https://fixture.invalid/radio', listenNum: 3 },
          ],
        },
        { id: 3, title: '空分类', list: [] },
      ],
    },
  },
};
const EXPECTED = {
  code: 200,
  groups: [
    {
      id: 1,
      title: '测试分类',
      radios: [{ id: 2, title: '测试电台', picurl: 'https://fixture.invalid/radio', listenNum: 3 }],
    },
    { id: 3, title: '空分类', radios: [] },
  ],
};

describe.each(['node', 'serverless'] as const)('匿名迁移路由 %s', (runtime) => {
  let seen: Seen[];
  let fixture: Fixture;
  const call = async (path = PATH, body?: unknown) => {
    if (runtime === 'node') {
      const req =
        body === undefined
          ? request(app.callback()).get(path)
          : request(app.callback())
              .post(path)
              .send(body as any);
      const res = await req.set('X-QQ-Session', 'fixture-invalid-session');
      return { status: res.status, body: res.body, headers: res.headers };
    }
    const res = await handleRequest(
      new Request('https://fixture.invalid' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'X-QQ-Session': 'fixture-invalid-session',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      {},
    );
    return {
      status: res.status,
      body: (await res.json()) as any,
      headers: Object.fromEntries(res.headers),
    };
  };
  beforeEach(() => {
    app.silent = true;
    seen = [];
    fixture = { body: structuredClone(REPLY) };
    for (const level of ['warn', 'error', 'debug'] as const)
      jest.spyOn(logger, level).mockImplementation(() => undefined);
    jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      const payload = init?.body ? JSON.parse(String(init.body)) : undefined;
      seen.push({ url, init, payload });
      if (fixture.fail) throw new TypeError('fixture-private-network-message');
      return new Response(fixture.text ?? JSON.stringify(fixture.body), {
        status: fixture.http ?? 200,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '2' },
      });
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it('忽略会话且不需要密钥，成功只请求一次', async () => {
    const res = await call(PATH, BODY);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(EXPECTED);
    expect(seen).toHaveLength(1);
    expect(new Headers(seen[0].init?.headers).get('cookie')).toBeNull();
    expect(seen[0].init?.redirect).toBe('manual');
  });
  it('连接失败使用安全的新错误格式且不重试', async () => {
    fixture.fail = true;
    const res = await call(PATH, BODY);
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ code: 502, kind: 'network' });
    expect(JSON.stringify(res.body)).not.toContain('fixture-private');
    expect(seen).toHaveLength(1);
  });
  it.each([429, 503])('上游 HTTP %i 不读取错误正文也不重试', async (http) => {
    fixture.http = http;
    fixture.text = 'fixture-private-upstream-body';
    const res = await call(PATH, BODY);
    expect(res.status).toBe(http === 429 ? 429 : 502);
    expect(res.body.kind).toBe(http === 429 ? 'rate-limited' : 'upstream-http');
    expect(res.body.upstreamHttpStatus).toBe(http);
    expect(JSON.stringify(res.body)).not.toContain('fixture-private');
    expect(seen).toHaveLength(1);
  });
  it('无效 JSON 回 502', async () => {
    fixture.text = '{broken';
    const res = await call(PATH, BODY);
    expect(res.status).toBe(502);
    expect(res.body.kind).toBe('invalid-response');
  });

  it('匿名 uin 为字符串零，不能读取会话最近记录', async () => {
    await call();
    expect(seen[0].payload).toEqual({
      comm: { ct: 24, cv: 0, uin: 0 },
      req_0: { module: 'pf.radiosvr', method: 'GetRadiolist', param: { uin: '0' } },
    });
  });
  it.each([
    [{ code: 0, req_0: { code: 0, data: { radio_list: [] } } }, 422, 'not-found'],
    [{ code: 0, req_0: { code: 0, data: { radio_list: {} } } }, 502, 'invalid-response'],
    [{ code: 0, req_0: { code: 0, data: { radio_list: [{ id: 0 }] } } }, 502, 'invalid-response'],
    [{ code: 0, req_0: { code: 1000, data: {} } }, 502, 'upstream-business'],
    [{ code: 500003 }, 502, 'upstream-gateway'],
  ])('匿名电台错误不推断为登录失效', async (body, status, kind) => {
    fixture.body = body;
    const res = await call();
    expect(res.status).toBe(status);
    expect(res.body.kind).toBe(kind);
  });
});
