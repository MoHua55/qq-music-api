import request from 'supertest';
import app from '../src/app';
import { handleRequest } from '../src/serverless';
import { logger } from '../src/util/logger';

// 新碟上架：地区清单和某个地区的新专辑，匿名读。Node 与 serverless 跑同一份案例，只替换对外的 fetch。
// 结构按 2026-10 实测整理（官方网页：`get_new_album_area` 无参数、`get_new_album_info { area, sin, num, start }`），
// 名称与 id 都是假数据。

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

const album = (id: unknown, overrides: Record<string, unknown> = {}) => ({
  id,
  mid: `fixture-album-${String(id)}`,
  name: `Fixture album ${String(id)}`,
  other_name: '',
  album_ori_name: '',
  area: 1,
  genre: 0,
  language: 0,
  release_time: '2026-10-16',
  singers: [{ id: 501, mid: 'fixture-singer-a', name: 'Fixture singer A' }],
  company: { id: 7, name: 'Fixture records', ex: {} },
  companyshow: { id: 7, name: 'Fixture records', ex: {} },
  ex: { track_nums: 12, playable_track_nums: 12, desc: 'Fixture desc', recommend_reason: '' },
  pay: { payment_album_type: 0 },
  photo: { has_photo: 0, pic_mid: 'fixture-pic' },
  ...overrides,
});

const flattened = (id: number) => ({
  id,
  mid: `fixture-album-${id}`,
  name: `Fixture album ${id}`,
  singers: [{ mid: 'fixture-singer-a', name: 'Fixture singer A' }],
  publishDate: '2026-10-16',
  company: 'Fixture records',
  trackCount: 12,
});

const AREAS = {
  area: [
    { id: 1, name: 'Fixture mainland', tjreport: '' },
    { id: 3, name: 'Fixture west', tjreport: '' },
  ],
};
const ALBUMS = { albums: [album(601), album(602)], total: 45, ret_msg: '' };

describe.each(['node', 'serverless'] as const)('new album route: %s', (runtime) => {
  let recorded: Recorded[];
  let replies: Record<string, Reply>;

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
    const failing = rpcs.map((rpc) => replies[rpc.method] ?? {}).find((r) => r.httpStatus);
    if (failing?.httpStatus)
      return new Response('fixture-private-error-page', { status: failing.httpStatus });
    const body: Record<string, unknown> = {
      code: rpcs.map((rpc) => replies[rpc.method]?.globalCode ?? 0).find((c) => c !== 0) ?? 0,
    };
    rpcs.forEach((rpc, index) => {
      const reply = replies[rpc.method] ?? {};
      body[`req_${index}`] = { code: reply.code ?? 0, data: reply.data ?? {} };
    });
    return Response.json(body);
  };

  const call = async (path: string, headers: Record<string, string> = {}): Promise<HttpResult> => {
    if (runtime === 'node') {
      const result = await request(app.callback()).get(path).set(headers);
      return { status: result.status, body: result.body };
    }
    const result = await handleRequest(
      new Request(`https://catalog.invalid${path}`, { headers }),
      {},
    );
    return { status: result.status, body: (await result.json()) as HttpResult['body'] };
  };

  beforeEach(() => {
    for (const level of ['debug', 'warn', 'error'] as const)
      jest.spyOn(logger, level).mockImplementation(() => undefined);
    jest.spyOn(global, 'fetch').mockImplementation(upstream);
    app.silent = true;
    recorded = [];
    replies = {
      get_new_album_area: { data: AREAS },
      get_new_album_info: { data: ALBUMS },
    };
  });

  afterEach(() => jest.restoreAllMocks());

  it('reads the area list and one page of albums anonymously in one request', async () => {
    const result = await call('/recommend/new-albums', { 'X-QQ-Session': 'b'.repeat(64) });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      code: 200,
      area: 1,
      albums: [flattened(601), flattened(602)],
      areas: [
        { id: 1, name: 'Fixture mainland' },
        { id: 3, name: 'Fixture west' },
      ],
      total: 45,
      more: true,
    });
    expect(recorded).toHaveLength(1);
    expect(recorded[0].comm).toEqual({ ct: 24, cv: 0 });
    expect(recorded[0].cookie).toBeNull();
    expect(recorded[0].rpcs).toEqual([
      { module: 'newalbum.NewAlbumServer', method: 'get_new_album_area', param: {} },
      {
        module: 'newalbum.NewAlbumServer',
        method: 'get_new_album_info',
        param: { area: 1, sin: 0, start: 0, num: 20 },
      },
    ]);
  });

  it.each([
    ['?area=3&offset=20&limit=10', 3, 20, 10],
    ['?area=5&limit=1000', 5, 0, 40],
    ['?offset=-1&limit=abc', 1, 0, 20],
  ])('reads %s as area %d, start %d and size %d', async (query, area, start, num) => {
    const result = await call(`/recommend/new-albums${query}`);

    expect(recorded[0].rpcs[1].param).toEqual({ area, sin: 0, start, num });
    expect(result.body.area).toBe(area);
  });

  it('reports no more albums on the last page', async () => {
    const result = await call('/recommend/new-albums?offset=43');

    expect(result.body.total).toBe(45);
    expect(result.body.more).toBe(false);
  });

  it('skips albums without a mid and leaves bad fields out', async () => {
    replies.get_new_album_info = {
      data: {
        total: 'many',
        albums: [
          album(603, { mid: '' }),
          album(604, {
            id: 'x',
            singers: [{ mid: '', name: 'No mid' }, null, { mid: 'fixture-singer-b', name: 7 }],
            release_time: 20261016,
            company: 'Fixture plain',
            ex: { track_nums: -1 },
          }),
        ],
      },
    };

    const result = await call('/recommend/new-albums');

    expect(result.status).toBe(200);
    expect(result.body.albums).toEqual([
      {
        mid: 'fixture-album-604',
        name: 'Fixture album 604',
        singers: [{ mid: 'fixture-singer-b', name: '' }],
      },
    ]);
    expect(result.body).not.toHaveProperty('total');
    expect(result.body.more).toBe(false);
  });

  it('still answers the albums when the area list cannot be read', async () => {
    replies.get_new_album_area = { code: 1000 };

    const result = await call('/recommend/new-albums');

    expect(result.status).toBe(200);
    expect(result.body.areas).toEqual([]);
    expect(result.body.albums).toHaveLength(2);
  });

  it.each([
    '?area=abc',
    '?area=0',
    '?area=-1',
  ])('answers 400 for a malformed area %s without reaching the upstream', async (query) => {
    const result = await call(`/recommend/new-albums${query}`);

    expect(result.status).toBe(400);
    expect(result.body.errorKey).toBe('input.invalid');
    expect(recorded).toEqual([]);
  });

  it.each([
    ['no albums', { ...ALBUMS, albums: [] }, 422, 'resource.not-found'],
    ['a non-list', { ...ALBUMS, albums: {} }, 502, 'upstream.invalid-response'],
    [
      'no readable album',
      { ...ALBUMS, albums: [album(605, { mid: 3 })] },
      502,
      'upstream.invalid-response',
    ],
  ])('answers for %s', async (_label, data, status, errorKey) => {
    replies.get_new_album_info = { data };

    const result = await call('/recommend/new-albums');

    expect(result.status).toBe(status);
    expect(result.body.errorKey).toBe(errorKey);
  });

  it('an upstream business code on the albums becomes 502 and keeps the number', async () => {
    replies.get_new_album_info = { code: 1000 };

    const result = await call('/recommend/new-albums');

    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({ errorKey: 'upstream.unknown', upstreamCode: 1000 });
  });

  it('answers 502 without the error page when the upstream HTTP request fails', async () => {
    replies.get_new_album_info = { httpStatus: 503 };

    const result = await call('/recommend/new-albums');

    expect(result.status).toBe(502);
    expect(JSON.stringify(result.body)).not.toContain('fixture-private-error-page');
  });
});
