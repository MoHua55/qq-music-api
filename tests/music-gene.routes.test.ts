import './helpers/sessionRoutes';
import { CATALOG_RUNTIMES, callRoute } from './helpers/catalogRoutes';
import { useSessionUpstream } from './helpers/sessionRoutes';

const PROFILE = {
  UserInfoCard: { NickName: 'fixture-user-a', Preferences: {} },
  ListeningReport: { Report: [{ fixture: 'retained' }] },
  IsVisitAccount: 1,
  SortArray: [1, 2],
  unknown: { preserved: true },
};
describe.each(CATALOG_RUNTIMES)('/user/music-gene（%s）', (runtime) => {
  const upstream = useSessionUpstream(runtime);
  const reply = (data: unknown) => {
    upstream.state.rpcReplies = { GetProfileReport: { data } };
  };
  const call = async (
    mode: 'valid' | 'missing' | 'invalid' | 'expired' = 'valid',
    env?: Record<string, string>,
    query = '',
  ) => {
    const options = await upstream.options(mode);
    await options.beforeEachLeg?.();
    return callRoute(runtime, `/user/music-gene${query}`, {
      headers: options.token ? { 'X-QQ-Session': options.token } : {},
      env: env ?? options.env,
    });
  };
  it('只读本人，原样交出对象并保留数字 IsVisitAccount', async () => {
    reply(PROFILE);
    expect(await call()).toEqual({ status: 200, body: { code: 200, profile: PROFILE } });
    expect(upstream.calls).toHaveLength(1);
    expect(upstream.calls[0].rpc).toEqual([
      { module: 'music.recommend.UserProfileSettingSvr', method: 'GetProfileReport', param: {} },
    ]);
  });
  it('输入目标参数不能改变查询对象，也不会送 VisitAccount', async () => {
    reply(PROFILE);
    expect(
      (await call('valid', undefined, '?VisitAccount=fixture-other&euin=fixture-other&uid=90002'))
        .status,
    ).toBe(200);
    expect(upstream.calls[0].rpc[0].param).toEqual({});
  });
  it('成功的空对象和空报告仍原样返回，不假设有额外业务字段', async () => {
    reply({});
    expect((await call()).body).toEqual({ code: 200, profile: {} });
  });
  it.each([
    'missing',
    'invalid',
    'expired',
  ] as const)('会话 %s 回 401，不请求上游', async (mode) => {
    expect((await call(mode)).status).toBe(401);
    expect(upstream.calls).toHaveLength(0);
  });
  it.each(['bad', [], 7])('非对象回包 %j 回 502', async (data) => {
    reply(data);
    const result = await call();
    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({ kind: 'invalid-response' });
  });
  it.each([
    1000, 10001, 104400, 104401, 20279, 999999,
  ])('上游非零码 %s 回 502 并保留数字，不解释为未登录', async (code) => {
    upstream.state.rpcReplies = { GetProfileReport: { code } };
    const result = await call();
    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({ kind: 'upstream-business', upstreamCode: code });
  });
  it('内层显式业务拒绝也保留原码，不冒充成功', async () => {
    reply({ code: 10001, Msg: 'fixture-private' });
    const result = await call();
    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({ kind: 'upstream-business', upstreamCode: 10001 });
    expect(JSON.stringify(result.body)).not.toContain('fixture-private');
  });
  it('内层成功码仍按原格式保留', async () => {
    reply({ ...PROFILE, code: 0 });
    expect((await call()).body).toEqual({ code: 200, profile: { ...PROFILE, code: 0 } });
  });
  it('内层业务码格式异常回 502，不猜测数字字符串', async () => {
    reply({ code: '10001' });
    const result = await call();
    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({ kind: 'invalid-response' });
  });
  it('网关、HTTP 和网络异常不泄露原始内容', async () => {
    reply(PROFILE);
    upstream.state.globalCode = 500003;
    expect((await call()).body).toMatchObject({ kind: 'upstream-gateway' });
    delete upstream.state.globalCode;
    upstream.state.httpStatus = 503;
    expect((await call()).body).toMatchObject({ kind: 'upstream-http' });
    delete upstream.state.httpStatus;
    upstream.state.networkError = new Error('fixture-private');
    const result = await call();
    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({ kind: 'network' });
    expect(JSON.stringify(result.body)).not.toContain('fixture-private');
  });
  if (runtime === 'serverless')
    it('未设置会话密钥回 501，不请求上游', async () => {
      expect((await call('missing', {})).status).toBe(501);
      expect(upstream.calls).toHaveLength(0);
    });
});
