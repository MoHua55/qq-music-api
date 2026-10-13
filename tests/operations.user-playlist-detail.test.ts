import './helpers/sessionRoutes';
import { getOwnedPlaylistSongs } from '../src/routes/operations/getOwnedPlaylistSongs';
import { CATALOG_RUNTIMES } from './helpers/catalogRoutes';
import { CONTRACT_SONGS } from './helpers/contractUpstream';
import { createParityRunner } from './helpers/operationParity';
import { useSessionUpstream } from './helpers/sessionRoutes';

// 登录态歌单详情搬迁只换路由实现；缺会话与凭证拒绝的 401、其他失败的 500 都照旧。
const parity = createParityRunner(
  {
    name: 'getOwnedPlaylistSongs',
    node: '/user/playlist-detail',
    serverless: '/user/playlist-detail',
  },
  {
    operation: getOwnedPlaylistSongs,
  },
);

describe.each(CATALOG_RUNTIMES)('/user/playlist-detail 共用处理与真实宿主契约（%s）', (runtime) => {
  const upstream = useSessionUpstream(runtime);
  it.each(['valid', 'missing', 'invalid', 'expired'] as const)('会话状态 %s', async (mode) => {
    const legs = await parity(
      runtime,
      '/user/playlist-detail?dirid=10',
      upstream.calls,
      await upstream.options(mode),
    );
    expect(legs.operation.status).toBe(mode === 'valid' ? 200 : 401);
    expect(legs.operation.body).toEqual(
      mode === 'valid'
        ? { code: 200, songs: CONTRACT_SONGS, total: 3, more: false }
        : { code: 401, message: 'Login required' },
    );
    expect(legs.operation.calls).toHaveLength(mode === 'valid' ? 1 : 0);
    expect(legs.host).toEqual(legs.operation);
  });

  it.each([
    { label: '凭证拒绝', businessCode: 1000, status: 401 },
    { label: '未知业务码', businessCode: 777777, status: 500 },
    { label: '2001 不扩大为限流', businessCode: 2001, status: 500 },
    { label: '只有网关失败', globalCode: 500003, status: 500 },
    {
      label: '网关与凭证码同时出现时网关优先',
      globalCode: 500003,
      businessCode: 1000,
      status: 502,
    },
  ])('$label', async ({ status, ...state }) => {
    Object.assign(upstream.state, state);
    const legs = await parity(
      runtime,
      '/user/playlist-detail?dirid=10&unused=',
      upstream.calls,
      await upstream.options(),
    );
    expect(legs.operation.status).toBe(status);
    expect(legs.operation.calls).toHaveLength(1);
    expect(legs.operation.calls[0].rpc[0].method).toBe('CgiGetDiss');
    expect(legs.host).toEqual(legs.operation);
  });

  it.each(['network', 'http'] as const)('上游 %s 失败', async (kind) => {
    if (kind === 'network')
      upstream.state.networkError = Object.assign(new Error('fixture-private-message'), {
        code: 'ECONNRESET',
      });
    else upstream.state.httpStatus = 503;
    const legs = await parity(
      runtime,
      '/user/playlist-detail?dirid=10',
      upstream.calls,
      await upstream.options(),
    );
    expect(legs.operation.status).toBe(500);
    expect(legs.operation.calls).toHaveLength(1);
    expect(legs.host).toEqual(legs.operation);
  });

  it('空的资料字段照旧转交', async () => {
    upstream.state.data = {};
    const legs = await parity(
      runtime,
      '/user/playlist-detail?dirid=10&unused=a&unused=b',
      upstream.calls,
      await upstream.options(),
    );
    expect(legs.operation.status).toBe(200);
    expect(legs.operation.body).toEqual({ code: 200, songs: [], total: 0, more: false });
    expect(legs.operation.calls).toHaveLength(1);
    expect(legs.host).toEqual(legs.operation);
  });

  it.each([
    { data: { songlist: [], hasmore: true }, total: 0, more: true },
    { data: { songlist: [], hasmore: '1' }, total: 0, more: true },
    { data: { songlist: [], total_song_num: 3, hasmore: false }, total: 3, more: true },
    { data: { songlist: null, total_song_num: '3', hasmore: false }, total: 0, more: false },
  ])('保留 total 与 more 的判断 $more', async (fixture) => {
    upstream.state.data = fixture.data;
    const legs = await parity(
      runtime,
      '/user/playlist-detail?dirid=10',
      upstream.calls,
      await upstream.options(),
    );
    expect(legs.operation.status).toBe(200);
    expect(legs.operation.body).toEqual({
      code: 200,
      songs: [],
      total: fixture.total,
      more: fixture.more,
    });
    expect(legs.host).toEqual(legs.operation);
  });

  it.each([
    { query: '', offset: 0, limit: 100 },
    { query: '?offset=1&limit=1', offset: 1, limit: 1 },
    { query: '?offset=-1&limit=-1', offset: 0, limit: 1 },
    { query: '?offset=0&limit=0', offset: 0, limit: 100 },
    { query: '?offset=invalid&limit=invalid', offset: 0, limit: 100 },
    { query: '?offset=&limit=', offset: 0, limit: 100 },
    { query: '?offset=1.9&limit=2.9', offset: 1, limit: 2 },
    { query: '?offset=2&offset=3&limit=1&limit=2', offset: 2, limit: 1 },
    { query: '?offset=&offset=3&limit=&limit=2', offset: 0, limit: 100 },
    { query: '?offset=0&limit=101', offset: 0, limit: 100 },
    { query: '?unused=', offset: 0, limit: 100 },
  ])('分页边界 $query', async (fixture) => {
    const legs = await parity(
      runtime,
      '/user/playlist-detail?dirid=10' + fixture.query.replace('?', '&'),
      upstream.calls,
      await upstream.options(),
    );
    expect(legs.operation.status).toBe(200);
    expect(legs.operation.calls).toHaveLength(1);
    expect(legs.operation.calls[0].rpc[0].param).toMatchObject({
      dirid: 10,
      song_begin: fixture.offset,
      song_num: fixture.limit,
    });
    expect(legs.host).toEqual(legs.operation);
  });

  it.each([
    { query: '', node: 400, serverless: 400, disstid: 0, dirid: 0 },
    { query: '?tid=', node: 400, serverless: 400, disstid: 0, dirid: 0 },
    { query: '?tid=invalid', node: 400, serverless: 400, disstid: 0, dirid: 0 },
    { query: '?tid=-1', node: 400, serverless: 400, disstid: 0, dirid: 0 },
    { query: '?tid=70001', node: 200, serverless: 200, disstid: 70001, dirid: 0 },
    { query: '?dirid=10', node: 200, serverless: 200, disstid: 0, dirid: 10 },
    { query: '?tid=70001&dirid=10', node: 200, serverless: 200, disstid: 70001, dirid: 10 },
    { query: '?tid=70001&tid=70002', node: 400, serverless: 200, disstid: 70001, dirid: 0 },
    { query: '?tid=&tid=70001', node: 400, serverless: 400, disstid: 0, dirid: 0 },
    { query: '?dirid=10&dirid=11', node: 400, serverless: 200, disstid: 0, dirid: 10 },
  ])('标识边界 $query', async (fixture) => {
    const legs = await parity(
      runtime,
      '/user/playlist-detail' + fixture.query,
      upstream.calls,
      await upstream.options(),
    );
    expect(legs.operation.status).toBe(fixture[runtime]);
    if (fixture[runtime] === 400) {
      expect(legs.operation.body).toEqual({ code: 400, message: 'tid or dirid is required' });
      expect(legs.operation.calls).toEqual([]);
    } else {
      expect(legs.operation.calls[0].rpc[0].param).toMatchObject({
        disstid: fixture.disstid,
        dirid: fixture.dirid,
      });
    }
    expect(legs.host).toEqual(legs.operation);
  });
});
