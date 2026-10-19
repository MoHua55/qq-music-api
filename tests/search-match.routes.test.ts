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

const PATH = '/search/match?keyword=fixture';
const BODY = undefined;
const group = {
  count: 1,
  name: 'Fixture songs',
  order: 0,
  type: 0,
  itemlist: [
    {
      mid: 'FixtureSongA1',
      name: '测试歌曲',
      id: '90001',
      docid: 'fixture-doc',
      singer: '测试歌手',
    },
  ],
};
const REPLY = { code: 0, subcode: 0, data: { song: group } };
const EXPECTED = { code: 200, keyword: 'fixture', data: { song: group } };

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

  it.each([
    '/search/match',
    '/search/match?keyword=',
    '/search/match?keyword=%20',
    '/search/match?keyword=' + 'x'.repeat(61),
  ])('拒绝无效关键字 %s', async (path) => {
    expect((await call(path)).status).toBe(400);
    expect(seen).toHaveLength(0);
  });
  it('同名参数取第一个值', async () => {
    const res = await call(PATH + '&keyword=other');
    expect(res.status).toBe(200);
    expect(seen[0].url.searchParams.get('key')).toBe('fixture');
  });
  it('只交出已确认的命中分组和公开字段', async () => {
    fixture.body.data.song.privateToken = 'fixture-secret';
    fixture.body.data.song.itemlist[0].tracking = 'fixture-trace';
    fixture.body.data.unknown = { secret: 'fixture-secret' };
    const res = await call();
    expect(res.body).toEqual(EXPECTED);
  });
  it.each([
    [{ code: 0, data: { song: { ...group, itemlist: [] } } }, 422, 'not-found'],
    [{ code: 0, data: { song: { ...group, itemlist: {} } } }, 502, 'invalid-response'],
    [{ code: 0, data: {} }, 502, 'invalid-response'],
    [{ code: 1000 }, 502, 'upstream-business'],
    [{ code: '0', data: REPLY.data }, 502, 'invalid-response'],
    [{ code: 0, subcode: 104400, data: REPLY.data }, 502, 'upstream-business'],
  ])('区分空结果与坏数据', async (body, status, kind) => {
    fixture.body = body;
    const res = await call();
    expect(res.status).toBe(status);
    expect(res.body.kind).toBe(kind);
  });
  it('不执行 JSONP 内容', async () => {
    fixture.text = 'MusicJsonCallback(' + JSON.stringify(REPLY) + ');';
    expect((await call()).body).toEqual(EXPECTED);
  });
});
