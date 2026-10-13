import './helpers/qrRoutes';
import Koa from 'koa';
import Router from 'koa-router';
import request from 'supertest';
import { qrCheck as legacyQrCheck } from '../src/controllers/login';
import qrCheckOperationController from '../src/controllers/qrCheckOperation';
import { qrCheck } from '../src/routes/operations/qrCheck';
import { legacyRoutes } from '../src/serverless/legacyRoutes';
import { CATALOG_RUNTIMES } from './helpers/catalogRoutes';
import { createParityRunner } from './helpers/operationParity';
import { useQrUpstream } from './helpers/qrRoutes';

const parity = createParityRunner(
  { name: 'qrCheck', node: '/login/qr/check', serverless: '/login/qr/check' },
  {
    legacyNode: legacyQrCheck,
    legacyServerless: legacyRoutes['/login/qr/check'],
    operation: qrCheck,
    operationNode: qrCheckOperationController,
  },
);
const authorized = { type: 'authorized' as const, payload: { code: 'fixture-auth-code' } };

describe.each(CATALOG_RUNTIMES)('/login/qr/check 新旧实现比对（%s）', (runtime) => {
  const upstream = useQrUpstream(runtime);
  it.each(['valid', 'invalid', 'expired'] as const)('key %s 保留自然过期与等待', async (mode) => {
    const options = await upstream.options('check', { mode });
    const legs = await parity(
      runtime,
      '/login/qr/check?key=' + encodeURIComponent(options.key),
      upstream.calls,
      options,
    );
    expect(legs.legacy.status).toBe(200);
    expect(legs.legacy.body).toEqual(
      mode === 'valid'
        ? { code: 801, message: 'Waiting for QR scan' }
        : { code: 800, message: 'QR code expired' },
    );
    expect(legs.operation).toEqual(legs.legacy);
    expect(legs.host).toEqual(legs.legacy);
  });
  it.each([
    { event: { type: 'scanned' as const, payload: null }, code: 802 },
    { event: { type: 'timeout' as const, payload: null }, code: 800 },
    { event: { type: 'canceled' as const, payload: null }, code: 800 },
    { event: { type: 'loginFailed' as const, payload: null }, code: 800 },
    { event: authorized, code: 803 },
  ])('真实事件 $event.type → $code', async ({ event, code }) => {
    upstream.state.events = [event];
    const options = await upstream.options('check');
    const legs = await parity(
      runtime,
      '/login/qr/check?key=' + encodeURIComponent(options.key),
      upstream.calls,
      options,
    );
    expect(legs.legacy.status).toBe(200);
    expect(legs.legacy.body).toMatchObject({ code });
    expect(legs.legacy.headers!['set-cookie']).toHaveLength(code === 803 ? 1 : 0);
    expect(legs.operation).toEqual(legs.legacy);
    expect(legs.host).toEqual(legs.legacy);
  });
  it.each([
    { failPhase: 'exchange' as const, businessCode: 20279 },
    { failPhase: 'exchange' as const, globalCode: 500003, businessCode: 1000 },
    { failPhase: 'exchange' as const, network: true },
    { failPhase: 'exchange' as const, httpStatus: 503 },
  ])('授权后的失败阶段与诊断 %j', async (state) => {
    Object.assign(upstream.state, state, { events: [authorized] });
    const options = await upstream.options('check');
    const legs = await parity(
      runtime,
      '/login/qr/check?key=' + encodeURIComponent(options.key),
      upstream.calls,
      options,
    );
    expect(legs.legacy.status).toBe(200);
    expect(legs.legacy.body).toMatchObject({ code: 800, failureStage: 'credential-exchange' });
    expect(legs.legacy.headers!['set-cookie']).toEqual([]);
    expect(JSON.stringify(legs.legacy.body)).not.toContain('fixture-private');
    expect(legs.operation).toEqual(legs.legacy);
    expect(legs.host).toEqual(legs.legacy);
  });
  it.each([
    '',
    '?key=',
    '?unused=',
    '?key=fixture-invalid',
    '?key=fixture-invalid&key=other',
    '?key=&key=other',
  ])('缺省、空值和无效 key %s', async (query) => {
    const legs = await parity(
      runtime,
      '/login/qr/check' + query,
      upstream.calls,
      await upstream.options('check'),
    );
    expect(legs.legacy.status).toBe(
      query.includes('fixture-invalid') || (runtime === 'node' && query === '?key=&key=other')
        ? 200
        : 400,
    );
    expect(legs.operation).toEqual(legs.legacy);
    expect(legs.host).toEqual(legs.legacy);
  });
  it.each(['second', 'empty-first', 'unused'] as const)('重复 key %s 保留原取法', async (kind) => {
    const options = await upstream.options('check');
    const key = encodeURIComponent(options.key);
    const query =
      kind === 'second'
        ? '?key=' + key + '&key=other'
        : kind === 'empty-first'
          ? '?key=&key=' + key
          : '?key=' + key + '&unused=&unused=b';
    const legs = await parity(runtime, '/login/qr/check' + query, upstream.calls, options);
    expect(legs.legacy.status).toBe(runtime === 'serverless' && kind === 'empty-first' ? 400 : 200);
    expect(legs.operation).toEqual(legs.legacy);
    expect(legs.host).toEqual(legs.legacy);
  });
  it.each([408, 404, 403, 402, 405])('微信真实轮询码 %s', async (wechatCode) => {
    upstream.state.wechatCode = wechatCode;
    const options = await upstream.options('check', { channel: 'wechat' });
    const legs = await parity(
      runtime,
      '/login/qr/check?key=' + encodeURIComponent(options.key),
      upstream.calls,
      options,
    );
    expect(legs.legacy.status).toBe(200);
    expect(legs.operation).toEqual(legs.legacy);
    expect(legs.host).toEqual(legs.legacy);
  });
  if (runtime === 'serverless')
    it('前一把密钥封存的 key 仍能轮询', async () => {
      const options = await upstream.options('check', { previous: true });
      const legs = await parity(
        runtime,
        '/login/qr/check?key=' + encodeURIComponent(options.key),
        upstream.calls,
        options,
      );
      expect(legs.legacy.status).toBe(200);
      expect(legs.operation).toEqual(legs.legacy);
      expect(legs.host).toEqual(legs.legacy);
    });
  if (runtime === 'node')
    it.each([
      { secure: false, signed: false },
      { secure: true, signed: false },
      { secure: false, signed: true },
      { secure: true, signed: true },
    ])('803 Cookie 安全与签名 $secure/$signed', async (fixture) => {
      upstream.state.events = [authorized];
      const options = await upstream.options('check');
      const call = async (controller: (ctx: Koa.Context) => Promise<void>) => {
        await options.beforeEachLeg!();
        const host = new Koa();
        host.proxy = fixture.secure;
        if (fixture.signed) host.keys = ['fixture-cookie-signing-key'];
        const router = new Router();
        router.get('/login/qr/check', controller);
        host.use(router.routes());
        const response = await request(host.callback())
          .get('/login/qr/check?key=' + options.key)
          .set('X-Forwarded-Proto', fixture.secure ? 'https' : 'http');
        const cookies = response.headers['set-cookie'];
        return {
          status: response.status,
          body: response.body,
          cookies: Array.isArray(cookies) ? cookies : cookies ? [cookies] : [],
        };
      };
      const legacy = await call(legacyQrCheck),
        operation = await call(qrCheckOperationController);
      expect(legacy.body.code).toBe(803);
      expect(legacy.cookies).toHaveLength(fixture.signed ? 2 : 1);
      expect(legacy.cookies.every((cookie: string) => cookie.includes('; secure'))).toBe(
        fixture.secure,
      );
      expect(operation).toEqual(legacy);
    });
});
