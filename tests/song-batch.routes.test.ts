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

const PATH = '/song/batch';
const BODY = { songs: [{ mid: 'FixtureSongA1', id: 90001 }, { mid: 'FixtureSongB2' }] };
const song = (mid: string, id: number) => ({ mid, id, name: '测试歌曲' });
const a = song('FixtureSongA1', 90001),
  b = song('FixtureSongB2', 90002);
const REPLY = {
  code: 0,
  req_0: { code: 0, data: { track_info: a, info: {} } },
  req_1: { code: 0, data: { track_info: b, info: {} } },
};
const EXPECTED = {
  code: 200,
  results: [
    { index: 0, code: 200, song: a, info: {} },
    { index: 1, code: 200, song: b, info: {} },
  ],
  partial: false,
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

  it('一次 HTTP 发出多个歌曲详情且保留输入顺序', async () => {
    await call(PATH, BODY);
    expect(Object.keys(seen[0].payload!).filter((x) => x.startsWith('req_'))).toEqual([
      'req_0',
      'req_1',
    ]);
    expect(seen[0].payload!.req_0.param).toEqual({
      song_type: 0,
      song_mid: 'FixtureSongA1',
      song_id: '90001',
    });
  });
  it('保留重复歌曲且支持二十个子请求', async () => {
    const songs = Array.from({ length: 20 }, () => BODY.songs[0]);
    fixture.body = {
      code: 0,
      ...Object.fromEntries(songs.map((_, i) => ['req_' + i, REPLY.req_0])),
    };
    const res = await call(PATH, { songs });
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(20);
    expect(seen).toHaveLength(1);
  });
  it.each([
    {},
    { songs: [] },
    { songs: 'invalid' },
    { songs: [{ mid: '' }] },
    { songs: [{ mid: 'FixtureSongA1', id: 1.5 }] },
    { songs: Array.from({ length: 21 }, () => ({ mid: 'FixtureSongA1' })) },
  ])('整批参数先验证', async (body) => {
    expect((await call(PATH, body)).status).toBe(400);
    expect(seen).toHaveLength(0);
  });
  it('部分成功交出逐项新错误', async () => {
    fixture.body.req_1 = { code: 1000, data: {} };
    const res = await call(PATH, BODY);
    expect(res.status).toBe(200);
    expect(res.body.partial).toBe(true);
    expect(res.body.results[1]).toMatchObject({
      index: 1,
      code: 502,
      kind: 'upstream-business',
      upstreamCode: 1000,
    });
  });
  it('全空回 422', async () => {
    fixture.body.req_0.data = { track_info: null };
    fixture.body.req_1.data = { track_info: null };
    const res = await call(PATH, BODY);
    expect(res.status).toBe(422);
    expect(res.body.kind).toBe('not-found');
  });
  it('全失败优先报告非空结果错误', async () => {
    fixture.body.req_0.data = { track_info: null };
    fixture.body.req_1 = { code: 1000, data: {} };
    const res = await call(PATH, BODY);
    expect(res.status).toBe(502);
    expect(res.body.kind).toBe('upstream-business');
  });
  it('缺少子回包和畸形歌曲不伪装成空结果', async () => {
    delete fixture.body.req_1;
    fixture.body.req_0.data.track_info = {};
    const res = await call(PATH, BODY);
    expect(res.status).toBe(502);
    expect(res.body.kind).toBe('invalid-response');
  });
  it('全局网关错误优先', async () => {
    fixture.body.code = 500003;
    const res = await call(PATH, BODY);
    expect(res.status).toBe(502);
    expect(res.body.kind).toBe('upstream-gateway');
  });
  it('错误方法不发送上游请求', async () => {
    expect((await call(PATH)).status).toBe(405);
    expect(seen).toHaveLength(0);
  });
});
