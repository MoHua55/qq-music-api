import './helpers/sessionRoutes';
import { loginStatus as legacyLoginStatus } from '../src/controllers/login';
import { loginStatus } from '../src/routes/operations/loginStatus';
import { legacyRoutes } from '../src/serverless/legacyRoutes';
import { CATALOG_RUNTIMES } from './helpers/catalogRoutes';
import { CONTRACT_PROFILE } from './helpers/contractUpstream';
import { createParityRunner } from './helpers/operationParity';
import { useSessionUpstream } from './helpers/sessionRoutes';

// 登录状态搬迁只换路由实现；缺会话与凭证拒绝仍回 200 空状态，其他失败的 500 照旧。
const parity = createParityRunner(
  { name: 'loginStatus', node: '/login/status', serverless: '/login/status' },
  {
    legacyNode: legacyLoginStatus,
    legacyServerless: legacyRoutes['/login/status'],
    operation: loginStatus,
  },
);

describe.each(CATALOG_RUNTIMES)('/login/status 新旧实现比对（%s）', (runtime) => {
  const upstream = useSessionUpstream(runtime);
  it.each(['valid', 'missing', 'invalid', 'expired'] as const)('会话状态 %s', async (mode) => {
    const legs = await parity(
      runtime,
      '/login/status',
      upstream.calls,
      await upstream.options(mode),
    );
    expect(legs.legacy.status).toBe(200);
    expect(legs.legacy.body).toEqual(
      mode === 'valid'
        ? { code: 200, data: { profile: CONTRACT_PROFILE } }
        : { code: 200, data: {} },
    );
    expect(legs.legacy.calls.flatMap((call) => call.rpc.map((rpc) => rpc.method))).toEqual(
      mode === 'valid' ? ['GetLoginUserInfo'] : [],
    );
    expect(legs.operation).toEqual(legs.legacy);
    expect(legs.host).toEqual(legs.legacy);
  });

  it.each([
    { label: '凭证拒绝', businessCode: 1000, status: 200 },
    { label: '未知业务码', businessCode: 777777, status: 500 },
    { label: '2001 不扩大为限流', businessCode: 2001, status: 500 },
    { label: '只有网关失败', globalCode: 500003, status: 500 },
    {
      label: '网关与凭证码同时出现时网关优先',
      globalCode: 500003,
      businessCode: 1000,
      status: 200,
    },
  ])('$label', async ({ status, ...state }) => {
    Object.assign(upstream.state, state);
    const legs = await parity(
      runtime,
      '/login/status?unused=',
      upstream.calls,
      await upstream.options(),
    );
    expect(legs.legacy.status).toBe(status);
    expect(legs.legacy.calls).toHaveLength(1);
    expect(legs.legacy.calls[0].rpc[0].method).toBe('GetLoginUserInfo');
    expect(legs.operation).toEqual(legs.legacy);
    expect(legs.host).toEqual(legs.legacy);
  });

  it.each(['network', 'http'] as const)('上游 %s 失败', async (kind) => {
    if (kind === 'network')
      upstream.state.networkError = Object.assign(new Error('fixture-private-message'), {
        code: 'ECONNRESET',
      });
    else upstream.state.httpStatus = 503;
    const legs = await parity(runtime, '/login/status', upstream.calls, await upstream.options());
    expect(legs.legacy.status).toBe(500);
    expect(legs.legacy.calls).toHaveLength(1);
    expect(legs.operation).toEqual(legs.legacy);
    expect(legs.host).toEqual(legs.legacy);
  });

  it('空的资料字段照旧转交', async () => {
    upstream.state.data = {};
    const legs = await parity(
      runtime,
      '/login/status?unused=a&unused=b',
      upstream.calls,
      await upstream.options(),
    );
    expect(legs.legacy.status).toBe(200);
    expect(legs.legacy.calls).toHaveLength(1);
    expect(legs.operation).toEqual(legs.legacy);
    expect(legs.host).toEqual(legs.legacy);
  });
});
