import './helpers/sessionRoutes';
import { getUserPlaylist } from '../src/routes/operations/getUserPlaylist';
import { CATALOG_RUNTIMES } from './helpers/catalogRoutes';
import { CONTRACT_PLAYLISTS } from './helpers/contractUpstream';
import { createParityRunner } from './helpers/operationParity';
import { useSessionUpstream } from './helpers/sessionRoutes';

// 用户歌单搬迁只换路由实现；缺会话与凭证拒绝的 401、其他失败的 500 都照旧。
const parity = createParityRunner(
  { name: 'getUserPlaylist', node: '/user/playlist', serverless: '/user/playlist' },
  {
    operation: getUserPlaylist,
  },
);

describe.each(CATALOG_RUNTIMES)('/user/playlist 共用处理与真实宿主契约（%s）', (runtime) => {
  const upstream = useSessionUpstream(runtime);
  it.each(['valid', 'missing', 'invalid', 'expired'] as const)('会话状态 %s', async (mode) => {
    const legs = await parity(
      runtime,
      '/user/playlist',
      upstream.calls,
      await upstream.options(mode),
    );
    expect(legs.operation.status).toBe(mode === 'valid' ? 200 : 401);
    expect(legs.operation.body).toEqual(
      mode === 'valid'
        ? { code: 200, playlist: CONTRACT_PLAYLISTS, total: 1, more: false }
        : { code: 401, message: 'Login required' },
    );
    expect(legs.operation.calls.flatMap((call) => call.rpc.map((rpc) => rpc.method))).toEqual(
      mode === 'valid' ? ['GetPlaylistByUin', 'CgiGetPlaylistFavInfo'] : [],
    );
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
      '/user/playlist?unused=',
      upstream.calls,
      await upstream.options(),
    );
    expect(legs.operation.status).toBe(status);
    expect(legs.operation.calls).toHaveLength(1);
    expect(legs.operation.calls[0].rpc[0].method).toBe('GetPlaylistByUin');
    expect(legs.host).toEqual(legs.operation);
  });

  it.each(['network', 'http'] as const)('上游 %s 失败', async (kind) => {
    if (kind === 'network')
      upstream.state.networkError = Object.assign(new Error('fixture-private-message'), {
        code: 'ECONNRESET',
      });
    else upstream.state.httpStatus = 503;
    const legs = await parity(runtime, '/user/playlist', upstream.calls, await upstream.options());
    expect(legs.operation.status).toBe(500);
    expect(legs.operation.calls).toHaveLength(1);
    expect(legs.host).toEqual(legs.operation);
  });

  it('空的资料字段照旧转交', async () => {
    upstream.state.data = {};
    const legs = await parity(
      runtime,
      '/user/playlist?unused=a&unused=b',
      upstream.calls,
      await upstream.options(),
    );
    expect(legs.operation.status).toBe(200);
    expect(legs.operation.calls).toHaveLength(2);
    expect(legs.host).toEqual(legs.operation);
  });

  it.each([
    { query: '?uid=10000', node: 200, serverless: 200, offset: 0 },
    { query: '?uid=', node: 200, serverless: 200, offset: 0 },
    { query: '?uid=fixture-other', node: 400, serverless: 400, offset: 0 },
    { query: '?uid=10000&uid=10000', node: 500, serverless: 200, offset: 0 },
    { query: '?uid=&uid=10000', node: 500, serverless: 200, offset: 0 },
    { query: '?favoriteOffset=10', node: 200, serverless: 200, offset: 10 },
    { query: '?favoriteOffset=0', node: 200, serverless: 200, offset: 0 },
    { query: '?favoriteOffset=-1', node: 200, serverless: 200, offset: 0 },
    { query: '?favoriteOffset=invalid', node: 200, serverless: 200, offset: 0 },
    { query: '?favoriteOffset=', node: 200, serverless: 200, offset: 0 },
    { query: '?favoriteOffset=2&favoriteOffset=3', node: 200, serverless: 200, offset: 2 },
    { query: '?favoriteOffset=&favoriteOffset=3', node: 200, serverless: 200, offset: 0 },
  ])('参数边界 $query', async (fixture) => {
    const legs = await parity(
      runtime,
      '/user/playlist' + fixture.query,
      upstream.calls,
      await upstream.options(),
    );
    expect(legs.operation.status).toBe(fixture[runtime]);
    const rpc = legs.operation.calls.flatMap((call) => call.rpc);
    if (fixture[runtime] === 200) {
      expect(rpc.map((call) => call.method)).toEqual(['GetPlaylistByUin', 'CgiGetPlaylistFavInfo']);
      expect(rpc[0].param.uin).toBe('10000');
      expect(rpc[1].param.offset).toBe(fixture.offset);
    } else expect(rpc).toEqual([]);
    expect(legs.host).toEqual(legs.operation);
  });
});
