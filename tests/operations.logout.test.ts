import './helpers/sessionRoutes';
import type { Context } from 'koa';
import Koa from 'koa';
import Router from 'koa-router';
import request from 'supertest';
import { logout as legacyLogout } from '../src/controllers/login';
import logoutOperationController from '../src/controllers/logoutOperation';
import { logout } from '../src/routes/operations/logout';
import { legacyRoutes } from '../src/serverless/legacyRoutes';
import { CATALOG_RUNTIMES } from './helpers/catalogRoutes';
import { createParityRunner } from './helpers/operationParity';
import { useSessionUpstream } from './helpers/sessionRoutes';

// 登出仍调用真实会话服务；Node 的 Cookie 由 Koa 写，serverless 保留 Max-Age=0。
const parity = createParityRunner(
  { name: 'logout', node: '/logout', serverless: '/logout' },
  {
    legacyNode: legacyLogout,
    legacyServerless: legacyRoutes['/logout'],
    operation: logout,
    operationNode: logoutOperationController,
  },
);

describe.each(CATALOG_RUNTIMES)('/logout 新旧实现比对（%s）', (runtime) => {
  const upstream = useSessionUpstream(runtime);
  it.each([
    'valid',
    'missing',
    'invalid',
    'expired',
  ] as const)('会话状态 %s 都能退出', async (mode) => {
    const options = await upstream.options(mode);
    const legs = await parity(runtime, '/logout', upstream.calls, {
      ...options,
      responseHeaders: ['set-cookie'],
    });
    expect(legs.legacy.status).toBe(200);
    expect(legs.legacy.body).toEqual({ code: 200 });
    expect(legs.legacy.calls).toEqual([]);
    expect(legs.legacy.headers?.['set-cookie']).toEqual(
      runtime === 'node'
        ? ['qqmusic_session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; httponly']
        : ['qqmusic_session=; Max-Age=0; Path=/'],
    );
    expect(legs.operation).toEqual(legs.legacy);
    expect(legs.host).toEqual(legs.legacy);
  });

  it('退出后 stored 会话撤销，sealed 会话仍由客户端丢弃', async () => {
    const options = await upstream.options();
    const legs = await parity(runtime, '/logout?unused=&unused=b', upstream.calls, options);
    expect(legs.host.status).toBe(200);
    const session = await (await options.service!()).resolveSession(options.token);
    expect(session === null).toBe(runtime === 'node');
  });
});

describe('登出 Node Cookie 的宿主行为', () => {
  const upstream = useSessionUpstream('node');
  it.each([
    { secure: false, signed: false },
    { secure: true, signed: false },
    { secure: false, signed: true },
    { secure: true, signed: true },
  ])('secure=$secure signed=$signed', async (fixture) => {
    const options = await upstream.options();
    const call = async (controller: (ctx: Context) => Promise<void>) => {
      await options.beforeEachLeg?.();
      const host = new Koa();
      host.proxy = fixture.secure;
      if (fixture.signed) host.keys = ['fixture-cookie-signing-key'];
      const router = new Router();
      router.get('/logout', controller);
      host.use(router.routes());
      const response = await request(host.callback())
        .get('/logout')
        .set({
          'X-QQ-Session': options.token!,
          'X-Forwarded-Proto': fixture.secure ? 'https' : 'http',
        });
      const cookies = response.headers['set-cookie'];
      return {
        status: response.status,
        body: response.body,
        cookies: Array.isArray(cookies) ? cookies : cookies ? [cookies] : [],
      };
    };
    const legacy = await call(legacyLogout);
    const operation = await call(logoutOperationController);
    expect(legacy.status).toBe(200);
    expect(legacy.cookies).toHaveLength(fixture.signed ? 2 : 1);
    expect(legacy.cookies.every((value) => value.includes('; secure'))).toBe(fixture.secure);
    expect(operation).toEqual(legacy);
  });
});
