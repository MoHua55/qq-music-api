import './helpers/sessionRoutes';
import { CATALOG_RUNTIMES, callRoute } from './helpers/catalogRoutes';
import { useSessionUpstream } from './helpers/sessionRoutes';

// 关键字搜索：Node 与 serverless 跑同一份案例，只替换对外的 fetch。
// 结构按 2026-10 实测整理（桌面版搜索方法、六个参数、`body.<类型>.list`、`meta.sum／nextpage`），
// 歌名、id 与关键字都是假数据。

const song = (mid: string) => ({
  id: 101,
  mid,
  name: 'Fixture song',
  title: 'Fixture song',
  interval: 180,
  singer: [{ id: 201, mid: 'FixtureSingerA1', name: 'Fixture singer' }],
  album: { id: 301, mid: 'FixtureAlbumA1', name: 'Fixture album' },
  file: { media_mid: 'FixtureMediaA1', size_128mp3: 1000 },
  pay: { pay_play: 0 },
  action: { switch: 1 },
});

const page = (
  key: string,
  list: unknown[],
  meta: Record<string, unknown> = { sum: 36, curpage: 1, nextpage: 2 },
) => ({
  code: 0,
  feedbackURL: '',
  ver: 1,
  meta: { perpage: 10, ret: 0, estimate_sum: 999, ...meta },
  body: {
    song: { list: [] },
    album: { list: [] },
    songlist: { list: [] },
    singer: { list: [] },
    [key]: { list },
  },
});

describe.each(CATALOG_RUNTIMES)('关键字搜索（%s）', (runtime) => {
  const upstream = useSessionUpstream(runtime);
  const call = async (query: string, mode: 'valid' | 'missing' | 'invalid' = 'valid') => {
    const options = await upstream.options(mode);
    await options.beforeEachLeg?.();
    return callRoute(runtime, `/search${query}`, {
      headers: options.token ? { 'X-QQ-Session': options.token } : {},
      env: options.env,
    });
  };
  const searches = () =>
    upstream.calls
      .flatMap((c) => c.rpc)
      .filter((rpc) => rpc.method === 'DoSearchForQQMusicDesktop');
  /** 实际送出去的 musicu 请求本文里的 comm，用来分辨有没有带会话。 */
  const searchComms = () =>
    (global.fetch as jest.Mock).mock.calls
      .map(([input, init]) => new Request(input, init))
      .filter((request) => new URL(request.url).pathname === '/cgi-bin/musicu.fcg');
  const lastComm = async () => {
    const requests = searchComms();
    const body = JSON.parse(await requests[requests.length - 1].text());
    return body.comm as Record<string, unknown>;
  };

  beforeEach(() => {
    upstream.state.rpcReplies = {
      DoSearchForQQMusicDesktop: {
        data: page('song', [song('FixtureSongA1'), song('FixtureSongB2')]),
      },
    };
  });

  it('带会话搜歌曲：送六个参数，条目原样交出', async () => {
    const result = await call('?keyword=fixture%20words');
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      code: 200,
      type: 'song',
      page: 1,
      limit: 10,
      total: 36,
      more: true,
      items: [song('FixtureSongA1'), song('FixtureSongB2')],
    });
    expect(searches()).toHaveLength(1);
    const [rpc] = searches();
    expect(rpc.module).toBe('music.search.SearchCgiService');
    expect(Object.keys(rpc.param).sort()).toEqual(
      ['num_per_page', 'page_num', 'query', 'remoteplace', 'search_type', 'searchid'].sort(),
    );
    expect(rpc.param).toMatchObject({
      query: 'fixture words',
      search_type: 0,
      page_num: 1,
      num_per_page: 10,
      remoteplace: 'txt.yqq.center',
    });
    expect(rpc.param.searchid).toMatch(/^\d{18}$/);
    expect(await lastComm()).toHaveProperty('authst');
  });

  it('歌曲没有会话回 401，不请求上游', async () => {
    for (const mode of ['missing', 'invalid'] as const) {
      const result = await call('?keyword=fixture&type=song', mode);
      expect(result.status).toBe(401);
      expect(result.body).toMatchObject({ errorKey: 'auth.required' });
    }
    expect(searches()).toHaveLength(0);
  });

  it.each([
    ['album', 'album', 2, 'txt.yqq.album'],
    ['playlist', 'songlist', 3, 'txt.yqq.playlist'],
    ['singer', 'singer', 1, 'txt.yqq.center'],
  ] as const)('%s 匿名也能搜', async (type, key, code, remoteplace) => {
    const entry = { docid: 'fixture-doc', [`${key}MID`]: 'FixtureMidA1' };
    upstream.state.rpcReplies = {
      DoSearchForQQMusicDesktop: { data: page(key, [entry], { sum: 1, curpage: 1, nextpage: -1 }) },
    };
    const result = await call(`?keyword=fixture&type=${type}`, 'missing');
    expect(result).toMatchObject({
      status: 200,
      body: { code: 200, type, total: 1, more: false, items: [entry] },
    });
    expect(searches()[0].param).toMatchObject({ search_type: code, remoteplace });
    expect(await lastComm()).not.toHaveProperty('authst');
  });

  it('其他类型有会话就带上', async () => {
    upstream.state.rpcReplies = {
      DoSearchForQQMusicDesktop: { data: page('album', [{ albumMID: 'FixtureAlbumA1' }]) },
    };
    expect((await call('?keyword=fixture&type=album')).status).toBe(200);
    expect(await lastComm()).toHaveProperty('authst');
  });

  it('歌曲第二页换成翻页的来源标记', async () => {
    const result = await call('?keyword=fixture&page=2&limit=20');
    expect(result.body).toMatchObject({ page: 2, limit: 20 });
    expect(searches()[0].param).toMatchObject({
      page_num: 2,
      num_per_page: 20,
      remoteplace: 'sizer.yqq.song_next',
    });
  });

  it.each([
    ['', 1, 10],
    ['&page=0&limit=0', 1, 10],
    ['&page=x&limit=x', 1, 10],
    ['&limit=50', 1, 20],
  ])('分页参数宽松处理 %s', async (suffix, expectedPage, expectedLimit) => {
    const result = await call(`?keyword=fixture${suffix}`);
    expect(result.body).toMatchObject({ page: expectedPage, limit: expectedLimit });
    expect(searches()[0].param).toMatchObject({
      page_num: expectedPage,
      num_per_page: expectedLimit,
    });
  });

  it('真正搜不到回 200 加空清单', async () => {
    upstream.state.rpcReplies = {
      DoSearchForQQMusicDesktop: { data: page('song', [], { sum: 0, curpage: 1, nextpage: -1 }) },
    };
    expect((await call('?keyword=fixture')).body).toEqual({
      code: 200,
      type: 'song',
      page: 1,
      limit: 10,
      total: 0,
      more: false,
      items: [],
    });
  });

  it.each([2001, 1000, 104400])('单项码 %s 回 502，不当成搜不到、也不清会话', async (code) => {
    upstream.state.rpcReplies = {
      DoSearchForQQMusicDesktop: {
        code,
        data: page('song', [], { sum: 0, curpage: 1, nextpage: -1 }),
      },
    };
    const result = await call('?keyword=fixture');
    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({ upstreamCode: code });
    expect(searches()).toHaveLength(1);
  });

  it.each([
    { body: {}, meta: {} },
    { ...page('song', []), body: { song: {} } },
    { ...page('song', []), body: { song: { list: 'fixture' } } },
    { ...page('song', ['fixture-private']) },
    { ...page('song', []), code: 1 },
  ])('回应格式不对回 502', async (data) => {
    upstream.state.rpcReplies = { DoSearchForQQMusicDesktop: { data } };
    const result = await call('?keyword=fixture');
    expect(result).toMatchObject({ status: 502, body: { errorKey: 'upstream.invalid-response' } });
    expect(JSON.stringify(result.body)).not.toContain('fixture-private');
  });

  it.each([
    '',
    '?keyword=',
    '?keyword=%20%20',
    `?keyword=${'a'.repeat(101)}`,
    '?keyword=fixture&type=mv',
    '?keyword=fixture&type=SONG',
  ])('参数错误回 400，不请求上游 %s', async (query) => {
    expect((await call(query)).status).toBe(400);
    expect(searches()).toHaveLength(0);
  });
});

describe('Serverless 没设会话密钥', () => {
  const upstream = useSessionUpstream('serverless');
  it('歌曲回 501，其他类型照常匿名搜', async () => {
    upstream.state.rpcReplies = {
      DoSearchForQQMusicDesktop: { data: page('album', [{ albumMID: 'FixtureAlbumA1' }]) },
    };
    expect((await callRoute('serverless', '/search?keyword=fixture')).status).toBe(501);
    const album = await callRoute('serverless', '/search?keyword=fixture&type=album');
    expect(album).toMatchObject({ status: 200, body: { type: 'album' } });
    expect(
      upstream.calls.flatMap((c) => c.rpc).filter((r) => r.method === 'DoSearchForQQMusicDesktop'),
    ).toHaveLength(1);
  });
});
