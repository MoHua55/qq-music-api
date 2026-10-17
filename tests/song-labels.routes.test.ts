import request from 'supertest';
import app from '../src/app';
import { handleRequest } from '../src/serverless';
import { logger } from '../src/util/logger';

// 歌曲标签：公开内容，匿名读。Node 与 serverless 跑同一份案例，只替换对外的 fetch。
// 结构按 2026-10 实测整理（`TrackRelationServer.GetSongLabels { songid }` → `labels[]`，
// 每个有 `id`、`species`、`tagType`、`tagTxt`、`tagIcon`、`tagUrl`），文字与 id 都是假数据。

interface Rpc {
  module: string;
  method: string;
  param: Record<string, unknown>;
}
interface Recorded {
  comm: Record<string, unknown>;
  cookie: string | null;
  rpcs: Rpc[];
}
interface Reply {
  httpStatus?: number;
  globalCode?: number;
  code?: number;
  data?: unknown;
}
interface HttpResult {
  status: number;
  body: Record<string, any>;
}

const label = (index: number, overrides: Record<string, unknown> = {}) => ({
  id: 70 + index,
  species: 1,
  tagType: index,
  tagTxt: `Fixture label ${index}`,
  tagIcon: `https://fixture.invalid/label-${index}.png`,
  tagUrl: `https://fixture.invalid/label-${index}`,
  ...overrides,
});
const flat = (index: number) => ({
  text: `Fixture label ${index}`,
  id: 70 + index,
  type: index,
  icon: `https://fixture.invalid/label-${index}.png`,
  url: `https://fixture.invalid/label-${index}`,
});

describe.each(['node', 'serverless'] as const)('song label route: %s', (runtime) => {
  let recorded: Recorded[];
  let reply: Reply;

  const upstream = async (input: string | URL | Request, init?: RequestInit) => {
    const fetched = new Request(input, init);
    const url = new URL(fetched.url);
    if (url.hostname !== 'u.y.qq.com' || url.pathname !== '/cgi-bin/musicu.fcg')
      throw new Error(`Unstubbed request: ${url.origin}${url.pathname}`);
    const payload = JSON.parse(await fetched.text());
    const rpcs: Rpc[] = Object.keys(payload)
      .filter((key) => key.startsWith('req_'))
      .sort()
      .map((key) => payload[key] as Rpc);
    recorded.push({ comm: payload.comm, cookie: fetched.headers.get('cookie'), rpcs });
    if (reply.httpStatus && reply.httpStatus >= 400)
      return new Response('fixture-private-error-page', { status: reply.httpStatus });
    return Response.json({
      code: reply.globalCode ?? 0,
      req_0: { code: reply.code ?? 0, data: reply.data ?? {} },
    });
  };

  const call = async (path: string, headers: Record<string, string> = {}): Promise<HttpResult> => {
    if (runtime === 'node') {
      const result = await request(app.callback()).get(path).set(headers);
      return { status: result.status, body: result.body };
    }
    const result = await handleRequest(new Request(`https://song.invalid${path}`, { headers }), {});
    return { status: result.status, body: (await result.json()) as HttpResult['body'] };
  };

  beforeEach(() => {
    for (const level of ['debug', 'warn', 'error'] as const)
      jest.spyOn(logger, level).mockImplementation(() => undefined);
    jest.spyOn(global, 'fetch').mockImplementation(upstream);
    app.silent = true;
    recorded = [];
    reply = { data: { labels: [label(1), label(2)] } };
  });

  afterEach(() => jest.restoreAllMocks());

  it('reads the labels of one song anonymously, even with a session token', async () => {
    const result = await call('/song/labels?id=4242', { 'X-QQ-Session': 'b'.repeat(64) });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ code: 200, id: 4242, labels: [flat(1), flat(2)] });
    expect(recorded).toHaveLength(1);
    expect(recorded[0].comm).toEqual({ ct: 24, cv: 0 });
    expect(recorded[0].cookie).toBeNull();
    expect(recorded[0].rpcs).toEqual([
      {
        module: 'music.recommend.TrackRelationServer',
        method: 'GetSongLabels',
        param: { songid: 4242 },
      },
    ]);
  });

  it('keeps a string id, leaves out empty optional fields and skips labels without text', async () => {
    reply = {
      data: {
        labels: [
          label(3, { tagTxt: '' }),
          null,
          label(4, { id: 'fixture-label-4', tagType: 'x', tagIcon: '', tagUrl: 5 }),
        ],
      },
    };

    const result = await call('/song/labels?id=4242');

    expect(result.status).toBe(200);
    expect(result.body.labels).toEqual([{ text: 'Fixture label 4', id: 'fixture-label-4' }]);
  });

  it.each([
    ['no labels', { labels: [] }, 422, 'resource.not-found'],
    ['a missing list', {}, 422, 'resource.not-found'],
    ['a non-list', { labels: {} }, 502, 'upstream.invalid-response'],
    ['no readable label', { labels: [label(5, { tagTxt: 5 })] }, 502, 'upstream.invalid-response'],
  ])('answers for %s', async (_label, data, status, errorKey) => {
    reply = { data };

    const result = await call('/song/labels?id=4242');

    expect(result.status).toBe(status);
    expect(result.body.errorKey).toBe(errorKey);
  });

  it.each([
    '',
    '?id=',
    '?id=abc',
    '?id=0',
    `?id=${'9'.repeat(16)}`,
  ])('answers 400 without asking the upstream for %s', async (query) => {
    const result = await call(`/song/labels${query}`);

    expect(result.status).toBe(400);
    expect(recorded).toHaveLength(0);
  });

  it('an unknown business code becomes 502 and keeps the number', async () => {
    reply = { code: 1101 };

    const result = await call('/song/labels?id=4242');

    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({ errorKey: 'upstream.unknown', upstreamCode: 1101 });
  });

  it('answers 502 without the error page when the upstream HTTP request fails', async () => {
    reply = { httpStatus: 503 };

    const result = await call('/song/labels?id=4242');

    expect(result.status).toBe(502);
    expect(JSON.stringify(result.body)).not.toContain('fixture-private-error-page');
  });
});
