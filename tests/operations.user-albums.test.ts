import './helpers/sessionRoutes';
import { getUserAlbums } from '../src/routes/operations/getUserAlbums';
import { CATALOG_RUNTIMES } from './helpers/catalogRoutes';
import { CONTRACT_ALBUMS } from './helpers/contractUpstream';
import { createParityRunner } from './helpers/operationParity';
import { useSessionUpstream } from './helpers/sessionRoutes';

// 收藏专辑搬迁只换路由实现；缺会话与凭证拒绝的 401、其他失败的 500 都照旧。
const parity = createParityRunner(
  { name: 'getUserAlbums', node: '/user/albums', serverless: '/user/albums' },
  {
    operation: getUserAlbums,
  },
);

describe.each(CATALOG_RUNTIMES)('/user/albums 共用处理与真实宿主契约（%s）', (runtime) => {
  const upstream = useSessionUpstream(runtime);
  it.each(['valid', 'missing', 'invalid', 'expired'] as const)('会话状态 %s', async (mode) => {
    const legs = await parity(
      runtime,
      '/user/albums',
      upstream.calls,
      await upstream.options(mode),
    );
    expect(legs.operation.status).toBe(mode === 'valid' ? 200 : 401);
    expect(legs.operation.body).toEqual(
      mode === 'valid'
        ? { code: 200, albums: CONTRACT_ALBUMS, total: 1, more: false }
        : { code: 401, message: 'Login required' },
    );
    expect(legs.operation.calls).toHaveLength(mode === 'valid' ? 1 : 0);
    expect(legs.host).toEqual(legs.operation);
  });

  it.each([
    { label: '凭证拒绝', businessCode: 1000, status: 401 },
    { label: '未知业务码', businessCode: 777777, status: 500 },
    { label: '2001 不扩大为限流', businessCode: 2001, status: 500 },
    { label: 'CGI 返回非零码', globalCode: 500003, status: 500 },
  ])('$label', async ({ status, ...state }) => {
    Object.assign(upstream.state, state);
    const legs = await parity(
      runtime,
      '/user/albums?unused=',
      upstream.calls,
      await upstream.options(),
    );
    expect(legs.operation.status).toBe(status);
    expect(legs.operation.calls).toHaveLength(1);
    expect(legs.operation.calls[0].endpoint).toBe('/fav/fcgi-bin/fcg_get_profile_order_asset.fcg');
    expect(legs.host).toEqual(legs.operation);
  });

  it.each(['network', 'http'] as const)('上游 %s 失败', async (kind) => {
    if (kind === 'network')
      upstream.state.networkError = Object.assign(new Error('fixture-private-message'), {
        code: 'ECONNRESET',
      });
    else upstream.state.httpStatus = 503;
    const legs = await parity(runtime, '/user/albums', upstream.calls, await upstream.options());
    expect(legs.operation.status).toBe(500);
    expect(legs.operation.calls).toHaveLength(1);
    expect(legs.host).toEqual(legs.operation);
  });

  it('空的资料字段照旧转交', async () => {
    upstream.state.data = {};
    const legs = await parity(
      runtime,
      '/user/albums?unused=a&unused=b',
      upstream.calls,
      await upstream.options(),
    );
    expect(legs.operation.status).toBe(200);
    expect(legs.operation.calls).toHaveLength(1);
    expect(legs.host).toEqual(legs.operation);
  });

  it.each([
    { query: '', offset: 0, limit: 20 },
    { query: '?offset=1&limit=1', offset: 1, limit: 1 },
    { query: '?offset=-1&limit=-1', offset: 0, limit: 1 },
    { query: '?offset=0&limit=0', offset: 0, limit: 20 },
    { query: '?offset=invalid&limit=invalid', offset: 0, limit: 20 },
    { query: '?offset=&limit=', offset: 0, limit: 20 },
    { query: '?offset=1.9&limit=2.9', offset: 1, limit: 2 },
    { query: '?offset=2&offset=3&limit=1&limit=2', offset: 2, limit: 1 },
    { query: '?offset=&offset=3&limit=&limit=2', offset: 0, limit: 20 },
    { query: '?offset=0&limit=101', offset: 0, limit: 100 },
    { query: '?unused=', offset: 0, limit: 20 },
  ])('分页边界 $query', async (fixture) => {
    const legs = await parity(
      runtime,
      '/user/albums' + fixture.query,
      upstream.calls,
      await upstream.options(),
    );
    expect(legs.operation.status).toBe(200);
    expect(legs.operation.calls).toHaveLength(1);
    expect(legs.operation.calls[0].params).toMatchObject({
      sin: String(fixture.offset),
      ein: String(fixture.offset + fixture.limit - 1),
    });
    expect(legs.host).toEqual(legs.operation);
  });
});
