import './helpers/qrRoutes';
import { qrKey as legacyQrKey } from '../src/controllers/login';
import { qrKey } from '../src/routes/operations/qrKey';
import { legacyRoutes } from '../src/serverless/legacyRoutes';
import { CATALOG_RUNTIMES } from './helpers/catalogRoutes';
import { createParityRunner } from './helpers/operationParity';
import { useQrUpstream } from './helpers/qrRoutes';

const parity = createParityRunner(
  { name: 'qrKey', node: '/login/qr/key', serverless: '/login/qr/key' },
  { legacyNode: legacyQrKey, legacyServerless: legacyRoutes['/login/qr/key'], operation: qrKey },
);

describe.each(CATALOG_RUNTIMES)('/login/qr/key 新旧实现比对（%s）', (runtime) => {
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
    expect(legs.legacy.status).toBe(invalid ? 400 : 200);
    expect(legs.operation).toEqual(legs.legacy);
    expect(legs.host).toEqual(legs.legacy);
  });
  it.each([
    '',
    '?channel=qq',
    '?channel=mobile',
    '?channel=wechat',
  ])('没有 relay %s 保留两边支持的通道', async (query) => {
    const legs = await parity(
      runtime,
      '/login/qr/key' + query,
      upstream.calls,
      await upstream.options('key', { relay: false }),
    );
    expect(legs.legacy.status).toBe(
      runtime === 'serverless' && ['?channel=qq', '?channel=mobile'].includes(query) ? 400 : 200,
    );
    expect(legs.operation).toEqual(legs.legacy);
    expect(legs.host).toEqual(legs.legacy);
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
    expect(legs.legacy.status).toBe(runtime === 'node' && state.failPhase === 'qr' ? 200 : 502);
    expect(JSON.stringify(legs.legacy.body)).not.toContain('fixture-private');
    expect(legs.operation).toEqual(legs.legacy);
    expect(legs.host).toEqual(legs.legacy);
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
      expect(legs.legacy.status).toBe(status);
      expect(legs.operation).toEqual(legs.legacy);
      expect(legs.host).toEqual(legs.legacy);
    });
});
