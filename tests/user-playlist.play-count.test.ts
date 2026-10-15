import './helpers/sessionRoutes';
import { CATALOG_RUNTIMES, callRoute } from './helpers/catalogRoutes';
import { useSessionUpstream } from './helpers/sessionRoutes';

// `/user/playlist?playCount=1`：从旧 CGI 补歌单播放数。Node 与 serverless 跑同一份案例。
// 结构按 2026-10 实测整理（自建 `fcg_user_created_diss` 的 `data.disslist[].listen_num`、
// 收藏 `fcg_get_profile_order_asset` reqtype 3 的 `data.cdlist[].listennum`，步长 10），名称与 id 都是假数据。

const CREATED_PATH = '/rsc/fcgi-bin/fcg_user_created_diss';
const FAVORITE_PATH = '/fav/fcgi-bin/fcg_get_profile_order_asset.fcg';

const created = [
  { tid: 70001, dirId: 10, dissname: 'Fixture created A', play_cnt: 0 },
  { tid: 70002, dirId: 11, dissname: 'Fixture created B', play_cnt: 0 },
];
const favorites = [
  { tid: 80001, dirId: 0, dissname: 'Fixture favorite A' },
  { tid: 80002, dirId: 0, dissname: 'Fixture favorite B' },
];

type CgiPage = { body?: unknown; httpStatus?: number };

describe.each(CATALOG_RUNTIMES)('/user/playlist 播放数（%s）', (runtime) => {
  const upstream = useSessionUpstream(runtime);
  const cgiCalls: URL[] = [];
  let createdPages: Record<string, CgiPage>;
  let favoritePages: Record<string, CgiPage>;

  const call = async (query = '?playCount=1') => {
    const options = await upstream.options('valid');
    await options.beforeEachLeg?.();
    return callRoute(runtime, `/user/playlist${query}`, {
      headers: { 'X-QQ-Session': options.token as string },
      env: options.env,
    });
  };
  const callsTo = (path: string) =>
    cgiCalls
      .filter((url) => url.pathname === path)
      .map((url) => Object.fromEntries(url.searchParams.entries()));

  beforeEach(() => {
    cgiCalls.length = 0;
    upstream.state.rpcReplies = {
      GetPlaylistByUin: { data: { v_playlist: created, bFinish: true } },
      CgiGetPlaylistFavInfo: { data: { v_list: favorites, hasmore: 0, total: 2 } },
    };
    createdPages = {
      '0': {
        body: {
          code: 0,
          subcode: 0,
          data: { totoal: 2, disslist: [{ tid: 70001, listen_num: 1234, diss_name: 'x' }] },
        },
      },
    };
    favoritePages = {
      '0': {
        body: {
          code: 0,
          subcode: 0,
          data: {
            totaldiss: 2,
            has_more: 0,
            cdlist: [
              { dissid: 80001, listennum: 55 },
              { dissid: 80002, listennum: -3 },
            ],
          },
        },
      },
    };
    upstream.state.cgiReply = (url) => {
      if (url.pathname === CREATED_PATH) {
        cgiCalls.push(url);
        return createdPages[url.searchParams.get('sin') ?? ''] ?? { body: { code: 0, data: {} } };
      }
      if (url.pathname === FAVORITE_PATH && url.searchParams.get('reqtype') === '3') {
        cgiCalls.push(url);
        return favoritePages[url.searchParams.get('sin') ?? ''] ?? { body: { code: 0, data: {} } };
      }
      return undefined;
    };
  });

  it('不带参数完全照旧：不读旧 CGI，自建条目的 play_cnt 原样保留', async () => {
    const result = await call('');
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      code: 200,
      playlist: [...created, ...favorites],
      total: 4,
      more: false,
    });
    expect(cgiCalls).toHaveLength(0);
  });

  it('对得上的条目补 play_cnt，对不上或是负数就不给', async () => {
    const result = await call();
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      code: 200,
      playlist: [
        { ...created[0], play_cnt: 1234 },
        { tid: 70002, dirId: 11, dissname: 'Fixture created B' },
        { ...favorites[0], play_cnt: 55 },
        favorites[1],
      ],
      total: 4,
      more: false,
      playCountComplete: true,
    });
    expect(callsTo(CREATED_PATH)).toEqual([
      expect.objectContaining({ hostuin: '10000', sin: '0', size: '11', format: 'json' }),
    ]);
    expect(callsTo(FAVORITE_PATH)).toEqual([
      expect.objectContaining({
        userid: '10000',
        reqtype: '3',
        sin: '0',
        ein: '10',
        format: 'json',
      }),
    ]);
  });

  it('按官方步长 10 翻页，直到读满总数或上游说没有了', async () => {
    createdPages['0'] = {
      body: { code: 0, data: { totoal: 15, disslist: [{ tid: 70009, listen_num: 1 }] } },
    };
    createdPages['10'] = {
      body: { code: 0, data: { totoal: 15, disslist: [{ tid: 70001, listen_num: 7 }] } },
    };
    favoritePages['0'] = {
      body: {
        code: 0,
        data: { totaldiss: 15, has_more: 1, cdlist: [{ dissid: 80001, listennum: 5 }] },
      },
    };
    favoritePages['10'] = {
      body: { code: 0, data: { totaldiss: 15, has_more: 0, cdlist: [] } },
    };
    const result = await call();
    expect(result.body).toMatchObject({
      playlist: [
        { tid: 70001, play_cnt: 7 },
        { tid: 70002 },
        { tid: 80001, play_cnt: 5 },
        { tid: 80002 },
      ],
      playCountComplete: true,
    });
    expect(callsTo(CREATED_PATH).map((p) => [p.sin, p.size])).toEqual([
      ['0', '11'],
      ['10', '11'],
    ]);
    expect(callsTo(FAVORITE_PATH).map((p) => [p.sin, p.ein])).toEqual([
      ['0', '10'],
      ['10', '20'],
    ]);
  });

  it('每份清单最多读 10 页，没读完就标 playCountComplete false', async () => {
    for (let sin = 0; sin < 200; sin += 10)
      createdPages[String(sin)] = {
        body: { code: 0, data: { totoal: 200, disslist: [{ tid: 90000 + sin, listen_num: 1 }] } },
      };
    const result = await call();
    expect(result.body).toMatchObject({ playCountComplete: false });
    expect(callsTo(CREATED_PATH)).toHaveLength(10);
  });

  it.each([
    { label: '业务码非 0', page: { body: { code: 1000, subcode: 0, data: {} } } },
    { label: 'HTTP 失败', page: { httpStatus: 503 } },
    { label: '格式不对', page: { body: { code: 0, data: { totoal: 2, disslist: 'x' } } } },
  ])('自建播放数读不到（$label）时列表照样 200，只是不补', async ({ page }) => {
    createdPages['0'] = page;
    const result = await call();
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      playlist: [
        { tid: 70001, dirId: 10, dissname: 'Fixture created A' },
        { tid: 70002, dirId: 11, dissname: 'Fixture created B' },
        { tid: 80001, play_cnt: 55 },
        { tid: 80002 },
      ],
      playCountComplete: false,
    });
    expect(
      (result.body as { playlist: Array<Record<string, unknown>> }).playlist[0],
    ).not.toHaveProperty('play_cnt');
    expect(JSON.stringify(result.body)).not.toContain('fixture-private');
    expect(callsTo(CREATED_PATH)).toHaveLength(1);
  });

  it.each(['0', 'true', 'yes', ''])('playCount=%s 不是 1 就当没开', async (value) => {
    const result = await call(`?playCount=${value}`);
    expect(result.body).not.toHaveProperty('playCountComplete');
    expect(cgiCalls).toHaveLength(0);
  });

  it('续读收藏那几轮也能补', async () => {
    const result = await call('?favoriteOffset=1&playCount=1');
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      playlist: [{ tid: 80001, play_cnt: 55 }, { tid: 80002 }],
      playCountComplete: true,
    });
  });
});
