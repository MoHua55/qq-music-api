import './helpers/sessionRoutes';
import { CATALOG_RUNTIMES, callRoute } from './helpers/catalogRoutes';
import { useSessionUpstream } from './helpers/sessionRoutes';

// 关键字搜索：Node 与 serverless 跑同一份案例，只替换对外的 fetch。
// 结构按 2026-10 实测整理（精简版搜索方法、十个参数、`body.item_song／item_album／item_songlist／singer`、
// `meta.sum／nextpage`），歌名、id 与关键字都是假数据。

const LITE = 'DoSearchForQQMusicLite';

const song = (mid: string) => ({
  id: 101,
  mid,
  title: 'Fixture song',
  interval: 180,
  singer: [{ id: 201, mid: 'FixtureSingerA1', name: 'Fixture singer' }],
  album: { id: 301, mid: 'FixtureAlbumA1', name: 'Fixture album' },
  file: { media_mid: 'FixtureMediaA1', size_128mp3: 1000 },
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
    item_song: [],
    item_album: [],
    item_songlist: [],
    singer: [],
    item_mv: [],
    [key]: list,
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
  const searches = () => upstream.calls.flatMap((c) => c.rpc).filter((rpc) => rpc.method === LITE);
  /** 实际送出去的 musicu 请求，用来分辨有没有带会话、带了哪些标头。 */
  const lastSearch = async () => {
    const requests = (global.fetch as jest.Mock).mock.calls
      .map(([input, init]) => new Request(input, init))
      .filter((request) => new URL(request.url).pathname === '/cgi-bin/musicu.fcg');
    const request = requests[requests.length - 1];
    return { comm: JSON.parse(await request.clone().text()).comm, headers: request.headers };
  };

  beforeEach(() => {
    upstream.state.rpcReplies = {
      [LITE]: { data: page('item_song', [song('FixtureSongA1'), song('FixtureSongB2')]) },
    };
  });

  it('带会话搜歌曲：送十个参数，条目原样交出', async () => {
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
      [
        'grp',
        'highlight',
        'nqc_flag',
        'num_per_page',
        'page_id',
        'page_num',
        'query',
        'remoteplace',
        'search_id',
        'search_type',
      ].sort(),
    );
    expect(rpc.param).toMatchObject({
      query: 'fixture words',
      search_type: 0,
      page_num: 1,
      num_per_page: 10,
      remoteplace: 'search.android.keyboard',
      highlight: 0,
      nqc_flag: 0,
      page_id: 1,
      grp: 1,
    });
    expect(rpc.param.search_id).toMatch(/^\d{18}$/);
    expect((await lastSearch()).comm).toHaveProperty('authst');
  });

  it.each([
    // 匿名搜歌送 7：上游已经不认 0（匿名时一律 2001），7 匿名也搜得到（2026-10 实测）。
    ['song', 'item_song', 7],
    ['album', 'item_album', 2],
    ['playlist', 'item_songlist', 3],
    ['singer', 'singer', 1],
  ] as const)('%s 不登录也能搜，用精简版的匿名身份', async (type, key, code) => {
    const entry = { docid: 'fixture-doc', mid: 'FixtureMidA1' };
    upstream.state.rpcReplies = {
      [LITE]: { data: page(key, [entry], { sum: 1, curpage: 1, nextpage: -1 }) },
    };
    for (const mode of ['missing', 'invalid'] as const) {
      const result = await call(`?keyword=fixture&type=${type}`, mode);
      expect(result).toMatchObject({
        status: 200,
        body: { code: 200, type, total: 1, more: false, items: [entry] },
      });
      const { comm, headers } = await lastSearch();
      expect(comm).toMatchObject({ ct: 11, tmeAppID: 'qqmusiclight', uid: '0', udid: '0' });
      expect(comm).not.toHaveProperty('authst');
      expect(headers.get('cookie')).toBe('tmeLoginType=-1');
      expect(headers.get('user-agent')).toBe('okhttp/3.14.9');
    }
    expect(searches().map((rpc) => rpc.param.search_type)).toEqual([code, code]);
  });

  it('歌曲第二页只改页码', async () => {
    const result = await call('?keyword=fixture&page=2&limit=20');
    expect(result.body).toMatchObject({ page: 2, limit: 20 });
    expect(searches()[0].param).toMatchObject({
      page_num: 2,
      num_per_page: 20,
      remoteplace: 'search.android.keyboard',
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
      [LITE]: { data: page('item_song', [], { sum: 0, curpage: 1, nextpage: -1 }) },
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

  it.each([
    'valid',
    'missing',
  ] as const)('单项码 2001 回 502 search.rejected，不当成搜不到（%s）', async (mode) => {
    upstream.state.rpcReplies = {
      [LITE]: { code: 2001, data: page('item_song', [], { sum: 0, curpage: 1, nextpage: -1 }) },
    };
    const result = await call('?keyword=fixture', mode);
    expect(result).toMatchObject({
      status: 502,
      body: { errorKey: 'search.rejected', upstreamCode: 2001, retryable: false },
    });
    expect(searches()).toHaveLength(1);
  });

  it.each([1000, 104400])('单项码 %s 回 502，不清会话', async (code) => {
    upstream.state.rpcReplies = {
      [LITE]: { code, data: page('item_song', [], { sum: 0, curpage: 1, nextpage: -1 }) },
    };
    const result = await call('?keyword=fixture');
    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({ upstreamCode: code });
  });

  it.each([
    { body: {}, meta: {} },
    { ...page('item_song', []), body: { item_album: [] } },
    { ...page('item_song', []), body: { item_song: 'fixture' } },
    { ...page('item_song', ['fixture-private']) },
    { ...page('item_song', []), code: 1 },
  ])('回应格式不对回 502', async (data) => {
    upstream.state.rpcReplies = { [LITE]: { data } };
    const result = await call('?keyword=fixture');
    expect(result).toMatchObject({ status: 502, body: { errorKey: 'upstream.invalid-response' } });
    expect(JSON.stringify(result.body)).not.toContain('fixture-private');
  });

  it.each([
    '',
    '?keyword=',
    '?keyword=%20%20',
    `?keyword=${'a'.repeat(61)}`,
    '?keyword=fixture&type=mv',
    '?keyword=fixture&type=SONG',
  ])('参数错误回 400，不请求上游 %s', async (query) => {
    expect((await call(query)).status).toBe(400);
    expect(searches()).toHaveLength(0);
  });
});

describe('Serverless 没设会话密钥', () => {
  const upstream = useSessionUpstream('serverless');
  it('照常匿名搜', async () => {
    upstream.state.rpcReplies = {
      [LITE]: { data: page('item_song', [song('FixtureSongA1')]) },
    };
    const result = await callRoute('serverless', '/search?keyword=fixture');
    expect(result).toMatchObject({
      status: 200,
      body: { type: 'song', items: [song('FixtureSongA1')] },
    });
    expect(upstream.calls.flatMap((c) => c.rpc).filter((r) => r.method === LITE)).toHaveLength(1);
  });
});
