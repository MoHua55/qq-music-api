import './helpers/sessionRoutes';
import { userDetail as legacyUserDetail } from '../src/controllers/login';
import { userDetail } from '../src/routes/operations/userDetail';
import { legacyRoutes } from '../src/serverless/legacyRoutes';
import { CATALOG_RUNTIMES } from './helpers/catalogRoutes';
import { CONTRACT_PROFILE } from './helpers/contractUpstream';
import { createParityRunner } from './helpers/operationParity';
import { useSessionUpstream } from './helpers/sessionRoutes';

// 用户资料搬迁只换路由实现；缺会话与凭证拒绝的 401、其他失败的 500 都照旧。
const parity = createParityRunner(
  { name: 'userDetail', node: '/user/detail', serverless: '/user/detail' },
  {
    legacyNode: legacyUserDetail,
    legacyServerless: legacyRoutes['/user/detail'],
    operation: userDetail,
  },
);

describe.each(CATALOG_RUNTIMES)('/user/detail 新旧实现比对（%s）', (runtime) => {
  const upstream = useSessionUpstream(runtime);
  it.each(['valid', 'missing', 'invalid', 'expired'] as const)('会话状态 %s', async (mode) => {
    const legs = await parity(
      runtime,
      '/user/detail',
      upstream.calls,
      await upstream.options(mode),
    );
    expect(legs.legacy.status).toBe(mode === 'valid' ? 200 : 401);
    expect(legs.legacy.body).toEqual(
      mode === 'valid'
        ? { code: 200, profile: CONTRACT_PROFILE }
        : { code: 401, message: 'Login required' },
    );
    expect(legs.legacy.calls.flatMap((call) => call.rpc.map((rpc) => rpc.method))).toEqual(
      mode === 'valid' ? ['GetLoginUserInfo'] : [],
    );
    expect(legs.operation).toEqual(legs.legacy);
    expect(legs.host).toEqual(legs.legacy);
  });

  it.each([
    { label: '凭证拒绝', businessCode: 1000, status: 401 },
    { label: '未知业务码', businessCode: 777777, status: 500 },
    { label: '2001 不扩大为限流', businessCode: 2001, status: 500 },
    { label: '只有网关失败', globalCode: 500003, status: 500 },
    {
      label: '网关与凭证码冲突暂时保留原语义',
      globalCode: 500003,
      businessCode: 1000,
      status: 401,
    },
  ])('$label', async ({ status, ...state }) => {
    Object.assign(upstream.state, state);
    const legs = await parity(
      runtime,
      '/user/detail?unused=',
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
    const legs = await parity(runtime, '/user/detail', upstream.calls, await upstream.options());
    expect(legs.legacy.status).toBe(500);
    expect(legs.legacy.calls).toHaveLength(1);
    expect(legs.operation).toEqual(legs.legacy);
    expect(legs.host).toEqual(legs.legacy);
  });

  it('空的资料字段照旧转交', async () => {
    upstream.state.data = {};
    const legs = await parity(
      runtime,
      '/user/detail?unused=a&unused=b',
      upstream.calls,
      await upstream.options(),
    );
    expect(legs.legacy.status).toBe(200);
    expect(legs.legacy.calls).toHaveLength(1);
    expect(legs.operation).toEqual(legs.legacy);
    expect(legs.host).toEqual(legs.legacy);
  });
});
