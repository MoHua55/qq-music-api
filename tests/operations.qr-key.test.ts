import './helpers/qrRoutes';
import { qrKey } from '../src/routes/operations/qrKey';
import { CATALOG_RUNTIMES } from './helpers/catalogRoutes';
import { createParityRunner } from './helpers/operationParity';
import { useQrUpstream } from './helpers/qrRoutes';

const parity = createParityRunner(
  { name: 'qrKey', node: '/login/qr/key', serverless: '/login/qr/key' },
  { operation: qrKey },
);

describe.each(CATALOG_RUNTIMES)('/login/qr/key 共用处理与真实宿主契约（%s）', (runtime) => {
  const upstream = useQrUpstream(runtime);
  it.each([
    '',
    '?channel=qq',
    '?channel=wechat',
    '?channel=mobile',
    '?channel=invalid',
    '?channel=',
    '?channel=qq&channel=wechat',
    '?channel=&channel=qq',
    '?unused=&unused=a',
  ])('通道与默认值 %s', async (query) => {
    const legs = await parity(
      runtime,
      '/login/qr/key' + query,
      upstream.calls,
      await upstream.options('key'),
    );
    const invalid =
      query.includes('invalid') ||
      query === '?channel=' ||
      query.startsWith('?channel=&') ||
      (runtime === 'node' && query.includes('&channel='));
    expect(legs.operation.status).toBe(invalid ? 400 : 200);
    expect(legs.host).toEqual(legs.operation);
  });
  it.each([
    '',
    '?channel=qq',
    '?channel=mobile',
    '?channel=wechat',
  ])('没有 relay 又关掉纯 HTTP 扫码时 %s 保留两边支持的通道', async (query) => {
    const options = await upstream.options('key', { relay: false });
    options.env = { ...options.env, QQ_PTLOGIN_HTTP_ENABLED: '0' };
    const legs = await parity(runtime, '/login/qr/key' + query, upstream.calls, options);
    expect(legs.operation.status).toBe(
      runtime === 'serverless' && ['?channel=qq', '?channel=mobile'].includes(query) ? 400 : 200,
    );
    expect(legs.host).toEqual(legs.operation);
  });
  it.each([
    { failPhase: 'bootstrap' as const, httpStatus: 503 },
    { failPhase: 'bootstrap' as const, network: true },
    { failPhase: 'session' as const, businessCode: 20279 },
    { failPhase: 'session' as const, globalCode: 500003, businessCode: 0 },
    { failPhase: 'session' as const, network: true },
    { failPhase: 'qr' as const, businessCode: 20261 },
  ])('失败阶段与安全诊断 %j', async (state) => {
    Object.assign(upstream.state, state);
    const legs = await parity(
      runtime,
      '/login/qr/key?channel=qq',
      upstream.calls,
      await upstream.options('key'),
    );
    expect(legs.operation.status).toBe(runtime === 'node' && state.failPhase === 'qr' ? 200 : 502);
    expect(JSON.stringify(legs.operation.body)).not.toContain('fixture-private');
    expect(legs.host).toEqual(legs.operation);
  });
  if (runtime === 'node')
    it.each([
      { busy: true, status: 409 },
      { backoff: true, status: 429 },
    ])('保留忙碌和本地回退 $status', async ({ status, ...setup }) => {
      const legs = await parity(
        runtime,
        '/login/qr/key',
        upstream.calls,
        await upstream.options('key', setup),
      );
      expect(legs.operation.status).toBe(status);
      expect(legs.host).toEqual(legs.operation);
    });
});
