import './helpers/sessionRoutes';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { apiExplorerMetadata } from '../src/config/apiExplorer';
import { CATALOG_RUNTIMES, callRoute } from './helpers/catalogRoutes';
import { useSessionUpstream } from './helpers/sessionRoutes';

// /user/daily-songs：每日 30 首。带凭证按账号自己的系统目录 202 读（实测收藏与否都回同样 30 首），
// 歌曲条目原样交出去。歌名、id 都是假数据。
const SONGS = [
  { id: 101, mid: 'fixture-daily-a', name: 'Fixture daily A', trace: 'fixture-trace' },
  { id: 102, mid: 'fixture-daily-b', name: 'Fixture daily B', trace: 'fixture-trace' },
];
const dissinfo = (songlist: unknown, extra: Record<string, unknown> = {}) => ({
  data: {
    code: 0,
    subcode: 0,
    dirinfo: { id: 0, title: 'fixture-private-title', dirid: 202 },
    songlist,
    total_song_num: Array.isArray(songlist) ? songlist.length : 0,
    filter_song_num: 0,
    ...extra,
  },
});

it('文档、Explorer 与能力声明都说明每日 30 首', async () => {
  const readme = readFileSync(resolve(__dirname, '../docs/README.md'), 'utf8');
  expect(readme).toContain('/user/daily-songs');
  expect(
    apiExplorerMetadata.endpoints.some((endpoint) => endpoint.routePath === '/user/daily-songs'),
  ).toBe(true);
  const channels = await callRoute('node', '/login/channels');
  expect(channels.body).toMatchObject({
    data: { features: { recommendations: { getDailySongs: true } } },
  });
});

describe.each(CATALOG_RUNTIMES)('/user/daily-songs（%s）', (runtime) => {
  const upstream = useSessionUpstream(runtime);
  const call = async (
    mode: 'valid' | 'missing' | 'invalid' | 'expired' = 'valid',
    env?: Record<string, string>,
  ) => {
    const options = await upstream.options(mode);
    await options.beforeEachLeg?.();
    return callRoute(runtime, '/user/daily-songs', {
      headers: options.token ? { 'X-QQ-Session': options.token } : {},
      env: env ?? options.env,
    });
  };

  it('按目录 202 读一次，歌曲原样回传，不带歌单名之类的其他字段', async () => {
    upstream.state.rpcReplies = { uniform_get_Dissinfo: dissinfo(SONGS) };
    const result = await call();
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ code: 200, songs: SONGS });
    expect(upstream.calls.flatMap((c) => c.rpc)).toEqual([
      {
        module: 'music.srfDissInfo.aiDissInfo',
        method: 'uniform_get_Dissinfo',
        param: { dirid: 202, optype: 3, tag: 1, userinfo: 0, pic_dpi: 300 },
      },
    ]);
    expect(JSON.stringify(result.body)).not.toContain('fixture-private');
  });

  it.each([
    'missing',
    'invalid',
    'expired',
  ] as const)('会话 %s 先回 401，不请求上游', async (mode) => {
    expect((await call(mode)).status).toBe(401);
    expect(upstream.calls).toHaveLength(0);
  });

  it.each([[[]], [null], [undefined]])('上游成功但没有歌（%j）回 422', async (songlist) => {
    upstream.state.rpcReplies = { uniform_get_Dissinfo: dissinfo(songlist) };
    const result = await call();
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ errorKey: 'resource.not-found' });
    expect(result.body).not.toHaveProperty('songs');
  });

  it.each([
    { data: 'not-an-object' },
    { data: { code: 0, songlist: {} } },
    { data: { code: 1, songlist: SONGS } },
  ])('回应格式不对或内层码非 0 回 502，不冒充成功', async (reply) => {
    upstream.state.rpcReplies = { uniform_get_Dissinfo: reply };
    const result = await call();
    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({ errorKey: 'upstream.invalid-response' });
  });

  it.each([1000, 104400, 104401])('上游不认凭证 %s 回 401，让前端重新登录', async (code) => {
    upstream.state.rpcReplies = { uniform_get_Dissinfo: { code } };
    const result = await call();
    expect(result.status).toBe(401);
    expect(result.body).toMatchObject({ errorKey: 'auth.credential-invalid' });
  });

  it('没登记的业务码保持未知、回 502', async () => {
    upstream.state.rpcReplies = { uniform_get_Dissinfo: { code: 999999 } };
    const result = await call();
    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({ errorKey: 'upstream.unknown', upstreamCode: 999999 });
  });

  it('网关和网络错误回 502，不带出原始内容', async () => {
    upstream.state.globalCode = 500003;
    expect((await call()).status).toBe(502);
    delete upstream.state.globalCode;
    upstream.state.networkError = new Error('fixture-private');
    const result = await call();
    expect(result.status).toBe(502);
    expect(JSON.stringify(result.body)).not.toContain('fixture-private');
  });

  if (runtime === 'serverless')
    it('没配置密钥回 501', async () => {
      expect((await call('missing', {})).status).toBe(501);
    });
});
