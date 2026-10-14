import './helpers/qrRoutes';
import Koa from 'koa';
import Router from 'koa-router';
import request from 'supertest';
import qrCheckOperationController from '../src/controllers/qrCheckOperation';
import { qrCheck, qrCookieTokenOf } from '../src/routes/operations/qrCheck';
import { CATALOG_RUNTIMES } from './helpers/catalogRoutes';
import { createParityRunner } from './helpers/operationParity';
import { useQrUpstream } from './helpers/qrRoutes';

const parity = createParityRunner(
  { name: 'qrCheck', node: '/login/qr/check', serverless: '/login/qr/check' },
  {
    operation: qrCheck,
    operationNode: qrCheckOperationController,
  },
);
const authorized = {
  type: 'authorized' as const,
  payload: {
    cookies: {
      qqmusic_uin: { value: '10000' },
      qqmusic_key: { value: 'fixture-exchange-token' },
    },
  },
};

describe('Node WeChat checks through the existing HTTP controller', () => {
  const upstream = useQrUpstream('node');
  it('retains 802 after 408 and still returns the existing 803 body and HttpOnly cookie', async () => {
    const options = await upstream.options('check', { channel: 'wechat' });
    await options.beforeEachLeg?.();
    const host = new Koa();
    const router = new Router();
    router.get('/login/qr/check', qrCheckOperationController);
    host.use(router.routes());
    for (const [wechatCode, apiCode] of [
      [404, 802],
      [408, 802],
      [405, 803],
    ]) {
      upstream.state.wechatCode = wechatCode;
      const response = await request(host.callback()).get(`/login/qr/check?key=${options.key}`);
      expect(response.status).toBe(200);
      if (apiCode === 802) {
        expect(response.body).toEqual({ code: 802, message: 'QR code scanned' });
        expect(response.headers['set-cookie']).toBeUndefined();
      } else {
        expect(response.body).toEqual({
          code: 803,
          message: 'Authorization login successful',
          cookie: expect.stringMatching(/^qqmusic_session=/),
        });
        expect(response.headers['set-cookie']).toEqual([expect.stringContaining('; httponly')]);
      }
    }
  });
});

it.each([
  ['', undefined],
  ['other=value', undefined],
  ['qqmusic_session=', undefined],
  ['invalid; qqmusic_session= fixture-token ', 'fixture-token'],
  ['qqmusic_session=fixture=a=b; other=value', 'fixture=a=b'],
  ['other=value; qqmusic_session=first; qqmusic_session=second', 'first'],
] as const)('保留 Cookie token 解析 %s', (cookie, expected) => {
  expect(qrCookieTokenOf(cookie)).toBe(expected);
});

describe.each(CATALOG_RUNTIMES)('/login/qr/check 共用处理与真实宿主契约（%s）', (runtime) => {
  const upstream = useQrUpstream(runtime);
  it.each(['valid', 'invalid', 'expired'] as const)('key %s 保留自然过期与等待', async (mode) => {
    const options = await upstream.options('check', { mode });
    const legs = await parity(
      runtime,
      '/login/qr/check?key=' + encodeURIComponent(options.key),
      upstream.calls,
      options,
    );
    expect(legs.operation.status).toBe(200);
    expect(legs.operation.body).toEqual(
      mode === 'valid'
        ? { code: 801, message: 'Waiting for QR scan' }
        : { code: 800, message: 'QR code expired' },
    );
    expect(legs.host).toEqual(legs.operation);
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
    expect(legs.operation.status).toBe(200);
    expect(legs.operation.body).toMatchObject({ code });
    expect(legs.operation.headers!['set-cookie']).toHaveLength(code === 803 ? 1 : 0);
    expect(legs.host).toEqual(legs.operation);
  });
  it.each([
    { failPhase: 'exchange' as const, businessCode: 20279 },
    { failPhase: 'exchange' as const, globalCode: 500003, businessCode: 1000 },
    { failPhase: 'exchange' as const, network: true },
    { failPhase: 'exchange' as const, httpStatus: 503 },
  ])('授权后的失败阶段与诊断 %j', async (state) => {
    Object.assign(upstream.state, state, { wechatCode: 405 });
    const options = await upstream.options('check', { channel: 'wechat' });
    const legs = await parity(
      runtime,
      '/login/qr/check?key=' + encodeURIComponent(options.key),
      upstream.calls,
      options,
    );
    expect(legs.operation.status).toBe(200);
    expect(legs.operation.body).toMatchObject({ code: 800, failureStage: 'credential-exchange' });
    expect(legs.operation.headers!['set-cookie']).toEqual([]);
    expect(JSON.stringify(legs.operation.body)).not.toContain('fixture-private');
    expect(legs.host).toEqual(legs.operation);
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
    expect(legs.operation.status).toBe(
      query.includes('fixture-invalid') || (runtime === 'node' && query === '?key=&key=other')
        ? 200
        : 400,
    );
    expect(legs.host).toEqual(legs.operation);
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
    expect(legs.operation.status).toBe(
      runtime === 'serverless' && kind === 'empty-first' ? 400 : 200,
    );
    expect(legs.host).toEqual(legs.operation);
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
    expect(legs.operation.status).toBe(200);
    expect(legs.host).toEqual(legs.operation);
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
      expect(legs.operation.status).toBe(200);
      expect(legs.host).toEqual(legs.operation);
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
      const operation = await call(qrCheckOperationController);
      expect(operation.body.code).toBe(803);
      expect(operation.cookies).toHaveLength(fixture.signed ? 2 : 1);
      expect(operation.cookies.every((cookie: string) => cookie.includes('; secure'))).toBe(
        fixture.secure,
      );
    });
});
