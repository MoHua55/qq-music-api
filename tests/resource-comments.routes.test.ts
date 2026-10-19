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

const PATH = '/comment/list?id=90001';
const BODY = undefined;
const entry = {
  rootcommentid: 'fixture-root',
  commentid: 'fixture-comment',
  rootcommentcontent: '测试评论',
  nick: '测试昵称',
  time: 1700000000,
  middlecommentcontent: [
    { subcommentid: 'fixture-reply', subcommentcontent: '测试回复', replynick: '测试回复者' },
  ],
};
const REPLY = {
  code: 0,
  subcode: 0,
  auth: 'fixture-private',
  comment: { commentlist: [entry], commenttotal: 3 },
  hot_comment: { commentlist: [entry], commenttotal: 1 },
  morecomment: 1,
};
const publicEntry = { ...entry };
const EXPECTED = {
  code: 200,
  data: {
    comment: { commentlist: [publicEntry], commenttotal: 3 },
    hot_comment: { commentlist: [publicEntry], commenttotal: 1 },
    morecomment: 1,
  },
  nextCursor: 'fixture-root',
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

  it('只交出评论公开字段并保留回复', async () => {
    fixture.body.comment.commentlist[0].encrypt_uin = 'fixture-private';
    expect((await call()).body).toEqual(EXPECTED);
  });
  it('续页显式传递游标和数字协议参数', async () => {
    await call(
      '/comment/list?id=90001&page=1&cursor=fixture-cursor&limit=3&biztype=2&cid=90002&cmd=6&reqtype=1',
    );
    expect(Object.fromEntries(seen[0].url.searchParams)).toMatchObject({
      topid: '90001',
      pagenum: '1',
      lasthotcommentid: 'fixture-cursor',
      pagesize: '3',
      biztype: '2',
      cid: '90002',
      cmd: '6',
      reqtype: '1',
    });
  });
  it.each([
    '/comment/list',
    '/comment/list?id=',
    '/comment/list?id=90001&page=1',
    '/comment/list?id=90001&limit=51',
    '/comment/list?id=90001&biztype=x',
    '/comment/list?id=90001&cursor=' + 'x'.repeat(257),
  ])('无效查询不出网 %s', async (path) => {
    expect((await call(path)).status).toBe(400);
    expect(seen).toHaveLength(0);
  });
  it('同名参数取首值', async () => {
    expect((await call(PATH + '&id=0')).status).toBe(200);
  });
  it.each([
    [{ code: 0, comment: { commentlist: [] } }, 422, 'not-found'],
    [{ code: 0, comment: { commentlist: {} } }, 502, 'invalid-response'],
    [
      { code: 0, comment: { commentlist: [{ rootcommentid: 'bad', middlecommentcontent: {} }] } },
      502,
      'invalid-response',
    ],
    [{ code: 104400 }, 502, 'upstream-business'],
  ])('空评论、坏结构与业务拒绝', async (body, status, kind) => {
    fixture.body = body;
    const res = await call();
    expect(res.status).toBe(status);
    expect(res.body.kind).toBe(kind);
  });
  it('有热评而新评为空时仍交出热评', async () => {
    fixture.body.comment.commentlist = [];
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.body.nextCursor).toBeUndefined();
  });
});
