import './helpers/qrRoutes';
import { qrCancel as legacyQrCancel } from '../src/controllers/login';
import { qrCancel } from '../src/routes/operations/qrCancel';
import { legacyRoutes } from '../src/serverless/legacyRoutes';
import { CATALOG_RUNTIMES } from './helpers/catalogRoutes';
import { createParityRunner } from './helpers/operationParity';
import { useQrUpstream } from './helpers/qrRoutes';

const parity = createParityRunner(
  { name: 'qrCancel', node: '/login/qr/cancel', serverless: '/login/qr/cancel' },
  {
    legacyNode: legacyQrCancel,
    legacyServerless: legacyRoutes['/login/qr/cancel'],
    operation: qrCancel,
  },
);
describe.each(CATALOG_RUNTIMES)('/login/qr/cancel 新旧实现比对（%s）', (runtime) => {
  const upstream = useQrUpstream(runtime);
  it.each(['qq', 'wechat'] as const)('释放 %s 的宿主资源', async (channel) => {
    const options = await upstream.options('cancel', { channel });
    const legs = await parity(
      runtime,
      '/login/qr/cancel?key=' + encodeURIComponent(options.key),
      upstream.calls,
      options,
    );
    expect(legs.legacy.status).toBe(200);
    expect(legs.legacy.body).toEqual({ code: 200 });
    if (channel === 'qq')
      expect(legs.legacy.calls).toEqual([
        { kind: runtime === 'node' ? 'listener' : 'relay', method: 'close', id: 'fixture-qr-id' },
      ]);
    expect(legs.operation).toEqual(legs.legacy);
    expect(legs.host).toEqual(legs.legacy);
  });
  it.each(['invalid', 'expired'] as const)('未知或过期 key %s 仍是 200', async (mode) => {
    const options = await upstream.options('cancel', { mode });
    const legs = await parity(
      runtime,
      '/login/qr/cancel?key=' + encodeURIComponent(options.key),
      upstream.calls,
      options,
    );
    expect(legs.legacy.status).toBe(200);
    expect(legs.legacy.body).toEqual({ code: 200 });
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
  ])('缺省、空值及无效 key %s', async (query) => {
    const legs = await parity(
      runtime,
      '/login/qr/cancel' + query,
      upstream.calls,
      await upstream.options('cancel'),
    );
    expect(legs.legacy.status).toBe(
      query.includes('fixture-invalid') || (runtime === 'node' && query === '?key=&key=other')
        ? 200
        : 400,
    );
    expect(legs.operation).toEqual(legs.legacy);
    expect(legs.host).toEqual(legs.legacy);
  });
  it.each(['second', 'empty-first', 'unused'] as const)('重复 key 取法 %s', async (kind) => {
    const options = await upstream.options('cancel');
    const key = encodeURIComponent(options.key);
    const query =
      kind === 'second'
        ? '?key=' + key + '&key=other'
        : kind === 'empty-first'
          ? '?key=&key=' + key
          : '?key=' + key + '&unused=&unused=b';
    const legs = await parity(runtime, '/login/qr/cancel' + query, upstream.calls, options);
    expect(legs.legacy.status).toBe(runtime === 'serverless' && kind === 'empty-first' ? 400 : 200);
    expect(legs.operation).toEqual(legs.legacy);
    expect(legs.host).toEqual(legs.legacy);
  });
  if (runtime === 'serverless') {
    it.each([{ relay: false }, { previous: true }])('保留 relay 和密钥配置 %j', async (setup) => {
      const options = await upstream.options('cancel', setup);
      const legs = await parity(
        runtime,
        '/login/qr/cancel?key=' + encodeURIComponent(options.key),
        upstream.calls,
        options,
      );
      expect(legs.legacy.status).toBe(200);
      expect(legs.operation).toEqual(legs.legacy);
      expect(legs.host).toEqual(legs.legacy);
    });
    it.each([false, true])('等待 relay 释放，失败 %s 仍回成功', async (relayCloseError) => {
      Object.assign(upstream.state, { relayCloseError, deferRelayClose: true });
      const options = await upstream.options('cancel');
      const legs = await parity(
        runtime,
        '/login/qr/cancel?key=' + encodeURIComponent(options.key),
        upstream.calls,
        options,
      );
      expect(legs.legacy.status).toBe(200);
      expect(legs.legacy.calls).toEqual([
        { kind: 'relay', method: 'close', id: 'fixture-qr-id' },
        { kind: 'relay', method: 'close-complete', id: 'fixture-qr-id' },
      ]);
      expect(legs.operation).toEqual(legs.legacy);
      expect(legs.host).toEqual(legs.legacy);
    });
  }
});
