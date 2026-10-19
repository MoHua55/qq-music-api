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

const PATH = '/recommend/category-playlists/sorted?id=90001&offset=60&limit=60&sortId=4';
const BODY = undefined;
const entry = {
  dissid: '70001',
  dissname: '测试歌单',
  imgurl: 'https://fixture.invalid/cover',
  introduction: '测试简介',
  listennum: 12,
  creator: {
    name: '测试作者',
    avatarUrl: 'https://fixture.invalid/avatar',
    encrypt_uin: 'fixture-encrypted',
  },
};
const REPLY = { code: 0, subcode: 0, data: { list: [entry], sum: 120 } };
const EXPECTED = {
  code: 200,
  playlists: [
    {
      tid: 70001,
      title: '测试歌单',
      desc: '测试简介',
      picurl: 'https://fixture.invalid/cover',
      play_cnt: 12,
      creator: {
        nick: '测试作者',
        avatar: 'https://fixture.invalid/avatar',
        encrypt_uin: 'fixture-encrypted',
      },
    },
  ],
  total: 120,
  more: true,
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

  it('把 offset 和数量转换成闭区间并保留排序', async () => {
    await call();
    expect(Object.fromEntries(seen[0].url.searchParams)).toMatchObject({
      categoryId: '90001',
      sin: '60',
      ein: '119',
      sortId: '4',
    });
  });
  it('省略参数沿用旧默认分类、排序和页长', async () => {
    await call('/recommend/category-playlists/sorted');
    expect(Object.fromEntries(seen[0].url.searchParams)).toMatchObject({
      categoryId: '10000000',
      sin: '0',
      ein: '19',
      sortId: '5',
    });
  });
  it.each([
    'id=0',
    'offset=-1',
    'offset=1.5',
    'limit=0',
    'limit=61',
    'sortId=abc',
    'offset=9007199254740991',
  ])('无效参数先拒绝 %s', async (query) => {
    expect((await call('/recommend/category-playlists/sorted?' + query)).status).toBe(400);
    expect(seen).toHaveLength(0);
  });
  it('重复参数取首值', async () => {
    expect((await call(PATH + '&limit=1')).status).toBe(200);
    expect(seen[0].url.searchParams.get('ein')).toBe('119');
  });
  it.each([
    [{ code: 0, data: { list: [] } }, 422, 'not-found'],
    [{ code: 0, data: { list: {} } }, 502, 'invalid-response'],
    [{ code: 0, data: { list: [{ dissid: 'bad' }] } }, 502, 'invalid-response'],
    [{ code: 1000 }, 502, 'upstream-business'],
  ])('列表空结果与拒绝各有类型', async (body, status, kind) => {
    fixture.body = body;
    const res = await call();
    expect(res.status).toBe(status);
    expect(res.body.kind).toBe(kind);
  });
  it('总数缺失时不给假数字', async () => {
    delete fixture.body.data.sum;
    const res = await call();
    expect(res.body.total).toBeUndefined();
    expect(res.body.more).toBe(false);
  });
});
