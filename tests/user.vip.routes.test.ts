import './helpers/sessionRoutes';
import { apiExplorerMetadata } from '../src/config/apiExplorer';
import { CATALOG_RUNTIMES, callRoute } from './helpers/catalogRoutes';
import { CONTRACT_CREDENTIAL } from './helpers/contractUpstream';
import { useSessionUpstream } from './helpers/sessionRoutes';

const uin = String(CONTRACT_CREDENTIAL.str_musicid || CONTRACT_CREDENTIAL.musicid);
describe.each(CATALOG_RUNTIMES)('/user/vip（%s）', (runtime) => {
  const upstream = useSessionUpstream(runtime);
  const call = async (
    mode: 'valid' | 'missing' | 'invalid' | 'expired' = 'valid',
    env?: Record<string, string>,
  ) => {
    const options = await upstream.options(mode);
    await options.beforeEachLeg?.();
    return callRoute(runtime, '/user/vip', {
      headers: options.token ? { 'X-QQ-Session': options.token } : {},
      env: env ?? options.env,
    });
  };
  it.each([0, 1, 2])('只按 iVipFlag %s 是否等于 1 判断，原样保留已知旗标', async (flag) => {
    upstream.state.data = {
      infoMap: {
        [uin]: {
          iVipFlag: flag,
          iSuperVip: 1,
          iNewSuperVip: 1,
          HugeVip: 0,
          UnionFreeEndTs: 123,
          unknownField: 'fixture-private',
          uin: 'fixture-private',
        },
        '99999': { iVipFlag: 1 },
      },
    };
    const result = await call();
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      code: 200,
      isVip: flag === 1,
      upstream: { iVipFlag: flag, iSuperVip: 1, iNewSuperVip: 1, HugeVip: 0, UnionFreeEndTs: 123 },
    });
    const rpc = upstream.calls.flatMap((c) => c.rpc);
    expect(rpc).toEqual([
      { module: 'userInfo.VipQueryServer', method: 'SRFVipQuery_V2', param: { uin_list: [uin] } },
    ]);
    expect(JSON.stringify(result.body)).not.toContain('fixture-private');
    expect(result.body).not.toHaveProperty('isSvip');
  });
  it.each([
    'missing',
    'invalid',
    'expired',
  ] as const)('会话 %s 先回 401，不请求上游', async (mode) => {
    expect((await call(mode)).status).toBe(401);
    expect(upstream.calls).toHaveLength(0);
  });
  it.each([
    {},
    { infoMap: {} },
    { infoMap: { '99999': { iVipFlag: 1 } } },
    { infoMap: { [uin]: {} } },
    { infoMap: { [uin]: { iVipFlag: '1' } } },
  ])('缺少当前账号可靠旗标不伪装成免费账号', async (data) => {
    upstream.state.data = data;
    const result = await call();
    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({ errorKey: 'upstream.invalid-response' });
    expect(result.body).not.toHaveProperty('isVip');
  });
  it.each([
    1000, 104400, 104401, 999999,
  ])('未验证业务码 %s 不扩展 401 或清会话语义', async (code) => {
    upstream.state.businessCode = code;
    const result = await call();
    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({ errorKey: 'upstream.unknown', upstreamCode: code });
  });
  it('上游网关和网络错误保持新路由错误语义', async () => {
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
it('能力和 Explorer 宣告会员状态查询', async () => {
  const result = await callRoute('node', '/login/channels');
  expect(result.body).toMatchObject({ data: { features: { user: { getVip: true } } } });
  expect(apiExplorerMetadata.endpoints.some((endpoint) => endpoint.routePath === '/user/vip')).toBe(
    true,
  );
});
