import './helpers/sessionRoutes';
import { CATALOG_RUNTIMES, callRoute } from './helpers/catalogRoutes';
import { CONTRACT_NOW, CONTRACT_PROFILE, CONTRACT_SECRET } from './helpers/contractUpstream';
import { useSessionUpstream } from './helpers/sessionRoutes';

// POST /login/refresh：客户端主动要求续期。sealed（Serverless）在最后 6 小时内续期并交出新 token；
// stored（Node、Electron、Docker）照常静默续期，token 不变。旧 token 都照原到期时间可用。

const HOUR = 60 * 60 * 1000;

describe.each(CATALOG_RUNTIMES)('POST /login/refresh（%s）', (runtime) => {
  const upstream = useSessionUpstream(runtime);
  const call = async (
    mode: 'valid' | 'missing' | 'invalid' | 'expired' = 'valid',
    method: 'GET' | 'POST' = 'POST',
  ) => {
    const options = await upstream.options(mode);
    await options.beforeEachLeg?.();
    const result = await callRoute(runtime, '/login/refresh', {
      method,
      headers: options.token ? { 'X-QQ-Session': options.token } : {},
      env: options.env,
    });
    return { ...result, token: options.token };
  };
  const refreshCalls = () =>
    upstream.calls
      .flatMap((entry) => entry.rpc)
      .filter((rpc) => rpc.method === 'Login' && rpc.param.loginMode === 2);

  beforeEach(() => {
    // 契约会话一小时后到期，已经在最后 6 小时里。
    upstream.state.credentialOverrides = { refresh_key: 'fixture-private-refresh-key' };
    upstream.state.rpcReplies = {
      Login: {
        data: {
          musicid: '10000',
          str_musicid: '10000',
          musickey: 'fixture-private-new-key',
          loginType: 2,
        },
      },
    };
  });

  it('有效会话：回 token、rotated 和到期时间', async () => {
    const result = await call();
    expect(result.status).toBe(200);
    if (runtime === 'serverless') {
      expect(result.body).toEqual({
        code: 200,
        data: { token: expect.any(String), rotated: true, expiresAt: CONTRACT_NOW + 24 * HOUR },
      });
      const rotatedToken = (result.body as { data: { token: string } }).data.token;
      expect(rotatedToken).not.toBe(result.token);
      expect(refreshCalls()).toHaveLength(1);
      expect(refreshCalls()[0].param).toMatchObject({
        refresh_key: 'fixture-private-refresh-key',
      });
      // 新 token 马上能用。
      const status = await callRoute(runtime, '/login/status', {
        headers: { 'X-QQ-Session': rotatedToken },
        env: { QQ_SESSION_SECRET: CONTRACT_SECRET },
      });
      expect(status.body).toEqual({ code: 200, data: { profile: CONTRACT_PROFILE } });
    } else {
      expect(result.body).toEqual({
        code: 200,
        data: { token: result.token, rotated: false, expiresAt: CONTRACT_NOW + HOUR },
      });
    }
  });

  it('上游续期失败：照用原来的 token，回 200', async () => {
    upstream.state.rpcReplies = { Login: { code: 1000 } };
    const result = await call();
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      code: 200,
      data: { token: result.token, rotated: false, expiresAt: CONTRACT_NOW + HOUR },
    });
  });

  it.each(['missing', 'invalid', 'expired'] as const)('会话 %s：回 401，不打上游', async (mode) => {
    const result = await call(mode);
    expect(result.status).toBe(401);
    expect(result.body).toEqual({ code: 401, message: 'Login required' });
    expect(refreshCalls()).toHaveLength(0);
  });

  it('只收 POST', async () => {
    const result = await call('valid', 'GET');
    // Node 由路由层直接回 405，和其他只收 POST 的路由一样；serverless 由共用处理回。
    expect(result.status).toBe(405);
    if (runtime === 'serverless')
      expect(result.body).toEqual({ code: 405, message: 'POST required' });
    expect(refreshCalls()).toHaveLength(0);
  });
});

describe('POST /login/refresh 在没设密钥的 Serverless', () => {
  it('和其他登录路由一样回 501', async () => {
    const result = await callRoute('serverless', '/login/refresh', { method: 'POST', env: {} });
    expect(result.status).toBe(501);
  });
});
