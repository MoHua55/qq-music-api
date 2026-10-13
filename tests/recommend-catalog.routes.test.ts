import request from 'supertest';
import app from '../src/app';
import { handleRequest } from '../src/serverless';
import { logger } from '../src/util/logger';

// 歌单分类、分类歌单与新歌速递：都匿名读，Node 与 serverless 跑同一份案例，只替换对外的 fetch。
// 结构按 2026-10 匿名实测整理（键名、类型、层级），名称与 id 都是假数据。

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

const category = (id: unknown, name = `Fixture category ${String(id)}`) => ({
  item_id: id,
  item_name: name,
  item_desc: '',
  item_new: 0,
  item_hot: 0,
  show_type: 0,
  is_parent: 0,
  reimgurl: '',
  item_share_pic: '',
  show_detail: 0,
  group_id: 1,
});

const CATEGORIES = {
  category: [{ group_id: 1, group_name: 'Fixture hot', items: [category(8), category(9)] }],
};

const playlist = (tid: unknown, overrides: Record<string, unknown> = {}) => ({
  access_num: 4321,
  album_pic_mid: '',
  cover_url_big: 'https://y.gtimg.cn/fixture-big.jpg',
  cover_url_medium: 'https://y.gtimg.cn/fixture-medium.jpg',
  cover_url_small: 'https://y.gtimg.cn/fixture-small.jpg',
  creator_info: {
    avatar: 'https://y.gtimg.cn/fixture-avatar.jpg',
    is_dj: 0,
    nick: 'Fixture creator',
    uin: 30001,
    vip_type: 0,
  },
  creator_uin: 30001,
  desc: 'Fixture description',
  dirid: 3,
  fav_num: 12,
  song_ids: [1, 2],
  tid,
  title: `Fixture playlist ${String(tid)}`,
  ...overrides,
});

const flattened = (tid: number) => ({
  tid,
  title: `Fixture playlist ${tid}`,
  desc: 'Fixture description',
  picurl: 'https://y.gtimg.cn/fixture-big.jpg',
  play_cnt: 4321,
  creator: {
    uin: '30001',
    nick: 'Fixture creator',
    avatar: 'https://y.gtimg.cn/fixture-avatar.jpg',
  },
});

const SONGS = [
  { id: 201, mid: 'fixture-new-a', name: 'Fixture new song A' },
  { id: 202, mid: 'fixture-new-b', name: 'Fixture new song B' },
];
const NEW_SONGS = {
  lanlist: [
    { name: 'Fixture latest', lan: 'latest', type: 5, tjreport: '' },
    { name: 'Fixture mainland', lan: 'mainland', type: 1, tjreport: '' },
  ],
  lan: 'latest',
  songlist: SONGS,
  ret_msg: '',
  type: 5,
};

describe.each(['node', 'serverless'] as const)('recommend catalog routes: %s', (runtime) => {
  let recorded: Recorded[];
  let replies: Record<string, Reply>;

  const upstream = async (input: string | URL | Request, init?: RequestInit) => {
    const fetched = new Request(input, init);
    const url = new URL(fetched.url);
    if (url.hostname !== 'u.y.qq.com' || url.pathname !== '/cgi-bin/musicu.fcg')
      throw new Error(`Unstubbed request: ${url.origin}${url.pathname}`);
    const payload = JSON.parse(await fetched.text());
    const rpcs: Rpc[] = Object.entries(payload)
      .filter(([key]) => key.startsWith('req_'))
      .map(([, value]) => value as Rpc);
    recorded.push({ comm: payload.comm, cookie: fetched.headers.get('cookie'), rpcs });
    const reply = replies[rpcs[0]?.method] ?? {};
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
    // 没设会话密钥也要能读：这几条不需要登录。
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
      get_hot_category: { data: CATEGORIES },
      get_playlist_by_category: {
        data: { total: 45, v_playlist: [playlist(80001), playlist(80002)] },
      },
      get_new_song_info: { data: NEW_SONGS },
    };
  });

  afterEach(() => jest.restoreAllMocks());

  it.each([
    '/recommend/categories',
    '/recommend/category-playlists?id=8',
    '/recommend/new-songs',
  ])('%s reads anonymously with the web comm even when a session is sent', async (path) => {
    const result = await call(path, { 'X-QQ-Session': 'b'.repeat(64) });

    expect(result.status).toBe(200);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].comm).toEqual({ ct: 24, cv: 0 });
    expect(recorded[0].cookie).toBeNull();
  });

  describe('/recommend/categories', () => {
    it('flattens the groups and their categories', async () => {
      const result = await call('/recommend/categories');

      expect(result.body).toEqual({
        code: 200,
        groups: [
          {
            id: 1,
            name: 'Fixture hot',
            categories: [
              { id: 8, name: 'Fixture category 8' },
              { id: 9, name: 'Fixture category 9' },
            ],
          },
        ],
      });
      expect(recorded[0].rpcs).toEqual([
        { module: 'music.web_category_svr', method: 'get_hot_category', param: { qq: '' } },
      ]);
    });

    it('skips categories without a usable id', async () => {
      replies.get_hot_category = {
        data: {
          category: [
            {
              group_id: 1,
              group_name: 'Fixture hot',
              items: [category(0), category('9'), category(10)],
            },
          ],
        },
      };

      const result = await call('/recommend/categories');

      expect(result.body.groups).toEqual([
        { id: 1, name: 'Fixture hot', categories: [{ id: 10, name: 'Fixture category 10' }] },
      ]);
    });

    it.each([
      ['an empty list', { category: [] }, 422, 'resource.not-found'],
      [
        'no group with categories',
        { category: [{ group_id: 1, items: [category(0)] }] },
        502,
        'upstream.invalid-response',
      ],
      ['a non-list', { category: 'x' }, 502, 'upstream.invalid-response'],
    ])('answers for %s', async (_label, data, status, errorKey) => {
      replies.get_hot_category = { data };

      const result = await call('/recommend/categories');

      expect(result.status).toBe(status);
      expect(result.body.errorKey).toBe(errorKey);
    });
  });

  describe('/recommend/category-playlists', () => {
    it('flattens playlists like the recommended playlists and reports more pages', async () => {
      const result = await call('/recommend/category-playlists?id=8');

      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        code: 200,
        playlists: [flattened(80001), flattened(80002)],
        total: 45,
        more: true,
      });
      expect(recorded[0].rpcs).toEqual([
        {
          module: 'playlist.PlayListPlazaServer',
          method: 'get_playlist_by_category',
          param: { id: 8, curPage: 1, size: 20, order: 5, titleid: 8 },
        },
      ]);
    });

    it.each([
      ['?id=8&page=5&limit=10', 5, 10, false],
      ['?id=8&page=2&limit=40', 2, 40, false],
      ['?id=8&page=1&limit=1000', 1, 40, true],
      ['?id=8&page=0&limit=0', 1, 20, true],
      ['?id=8&page=abc&limit=-3', 1, 20, true],
    ])('reads %s as page %d and size %d', async (query, page, size, more) => {
      const result = await call(`/recommend/category-playlists${query}`);

      expect(recorded[0].rpcs[0].param).toEqual({
        id: 8,
        curPage: page,
        size,
        order: 5,
        titleid: 8,
      });
      expect(result.body.more).toBe(more);
    });

    it.each([
      '',
      '?id=',
      '?id=abc',
      '?id=0',
      '?id=1.5',
    ])('answers 400 for a missing or malformed id %s without reaching the upstream', async (query) => {
      const result = await call(`/recommend/category-playlists${query}`);

      expect(result.status).toBe(400);
      expect(result.body.errorKey).toBe('input.invalid');
      expect(recorded).toEqual([]);
    });

    it('skips playlists without a usable tid and leaves missing numbers out', async () => {
      replies.get_playlist_by_category = {
        data: {
          total: 2,
          v_playlist: [
            playlist(0),
            playlist(80003, {
              access_num: 'many',
              cover_url_big: '',
              creator_info: { nick: 'Fixture creator', uin: 'x' },
            }),
          ],
        },
      };

      const result = await call('/recommend/category-playlists?id=8');

      expect(result.body.playlists).toEqual([
        {
          tid: 80003,
          title: 'Fixture playlist 80003',
          desc: 'Fixture description',
          picurl: 'https://y.gtimg.cn/fixture-medium.jpg',
          creator: { nick: 'Fixture creator' },
        },
      ]);
    });

    it.each([
      ['an empty page', { total: 0, v_playlist: [] }, 422, 'resource.not-found'],
      [
        'only unusable entries',
        { total: 1, v_playlist: [playlist(0)] },
        502,
        'upstream.invalid-response',
      ],
      ['a non-list', { v_playlist: {} }, 502, 'upstream.invalid-response'],
    ])('answers for %s', async (_label, data, status, errorKey) => {
      replies.get_playlist_by_category = { data };

      const result = await call('/recommend/category-playlists?id=8');

      expect(result.status).toBe(status);
      expect(result.body.errorKey).toBe(errorKey);
    });
  });

  describe('/recommend/new-songs', () => {
    it('returns the songs unchanged with the area list, latest by default', async () => {
      const result = await call('/recommend/new-songs');

      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        code: 200,
        area: 5,
        songs: SONGS,
        areas: [
          { id: 5, name: 'Fixture latest' },
          { id: 1, name: 'Fixture mainland' },
        ],
      });
      expect(recorded[0].rpcs).toEqual([
        { module: 'newsong.NewSongServer', method: 'get_new_song_info', param: { type: 5 } },
      ]);
    });

    it('passes a chosen area through', async () => {
      replies.get_new_song_info = { data: { ...NEW_SONGS, type: 1 } };

      const result = await call('/recommend/new-songs?area=1');

      expect(recorded[0].rpcs[0].param).toEqual({ type: 1 });
      expect(result.body.area).toBe(1);
    });

    it.each([
      '?area=abc',
      '?area=0',
      '?area=-1',
    ])('answers 400 for a malformed area %s', async (query) => {
      const result = await call(`/recommend/new-songs${query}`);

      expect(result.status).toBe(400);
      expect(recorded).toEqual([]);
    });

    it.each([
      ['no songs', { ...NEW_SONGS, songlist: [] }, 422, 'resource.not-found'],
      ['a non-list', { ...NEW_SONGS, songlist: {} }, 502, 'upstream.invalid-response'],
    ])('answers for %s', async (_label, data, status, errorKey) => {
      replies.get_new_song_info = { data };

      const result = await call('/recommend/new-songs');

      expect(result.status).toBe(status);
      expect(result.body.errorKey).toBe(errorKey);
    });
  });

  it.each([
    ['get_hot_category', '/recommend/categories'],
    ['get_playlist_by_category', '/recommend/category-playlists?id=8'],
    ['get_new_song_info', '/recommend/new-songs'],
  ])('%s: an upstream business code becomes 502 and keeps the number', async (method, path) => {
    replies[method] = { code: 1000 };

    const result = await call(path);

    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({ errorKey: 'upstream.unknown', upstreamCode: 1000 });
  });

  it('answers 502 without the error page when the upstream HTTP request fails', async () => {
    replies.get_new_song_info = { httpStatus: 503 };

    const result = await call('/recommend/new-songs');

    expect(result.status).toBe(502);
    expect(JSON.stringify(result.body)).not.toContain('fixture-private-error-page');
  });
});
