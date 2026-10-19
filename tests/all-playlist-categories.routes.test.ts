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

const PATH = '/recommend/categories/all';
const BODY = undefined;
const REPLY = {
  code: 0,
  subcode: 0,
  default: 0,
  data: {
    categories: [
      {
        categoryGroupName: '测试分类',
        usable: 1,
        items: [
          {
            categoryId: 90001,
            categoryName: '测试类别',
            usable: 1,
            allsorts: [{ sortId: 5, sortName: '测试排序' }],
          },
        ],
      },
    ],
  },
};
const EXPECTED = {
  code: 200,
  groups: [
    {
      name: '测试分类',
      usable: 1,
      categories: [
        { id: 90001, name: '测试类别', usable: 1, sorts: [{ id: 5, name: '测试排序' }] },
      ],
    },
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
  it('GET 接口拒绝 POST 且不请求上游', async () => {
    expect((await call(PATH, {})).status).toBe(405);
    expect(seen).toHaveLength(0);
  });

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

  it('只选完整 CGI 字典，不暗中改用热门分类', async () => {
    await call();
    expect(seen[0].url.pathname).toBe('/splcloud/fcgi-bin/fcg_get_diss_tag_conf.fcg');
  });
  it.each([
    [{ code: 0, data: { categories: [] } }, 422, 'not-found'],
    [{ code: 0, data: { categories: {} } }, 502, 'invalid-response'],
    [
      { code: 0, data: { categories: [{ items: [{ categoryId: 'invalid' }] }] } },
      502,
      'invalid-response',
    ],
    [{ code: 104401 }, 502, 'upstream-business'],
  ])('分类空数据与错误不清会话', async (body, status, kind) => {
    fixture.body = body;
    const res = await call();
    expect(res.status).toBe(status);
    expect(res.body.kind).toBe(kind);
  });
  it('不虚构分组编号或排序', async () => {
    fixture.body.data.categories[0] = {
      categoryGroupName: '测试分类',
      items: [{ categoryId: 90001, categoryName: '测试类别' }],
    };
    expect((await call()).body.groups).toEqual([
      { name: '测试分类', categories: [{ id: 90001, name: '测试类别' }] },
    ]);
  });
});
