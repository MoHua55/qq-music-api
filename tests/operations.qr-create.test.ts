import './helpers/qrRoutes';
import { qrCreate as legacyQrCreate } from '../src/controllers/login';
import { qrCreate } from '../src/routes/operations/qrCreate';
import { legacyRoutes } from '../src/serverless/legacyRoutes';
import { CATALOG_RUNTIMES } from './helpers/catalogRoutes';
import { createParityRunner } from './helpers/operationParity';
import { useQrUpstream } from './helpers/qrRoutes';

const parity = createParityRunner(
  { name: 'qrCreate', node: '/login/qr/create', serverless: '/login/qr/create' },
  {
    legacyNode: legacyQrCreate,
    legacyServerless: legacyRoutes['/login/qr/create'],
    operation: qrCreate,
  },
);
describe.each(CATALOG_RUNTIMES)('/login/qr/create 新旧实现比对（%s）', (runtime) => {
  const upstream = useQrUpstream(runtime);
  it.each(['qq', 'wechat'] as const)('真实 %s 图片与重放时的上游请求', async (channel) => {
    const options = await upstream.options('create', { channel });
    const legs = await parity(
      runtime,
      '/login/qr/create?key=' + encodeURIComponent(options.key),
      upstream.calls,
      options,
    );
    expect(legs.legacy.status).toBe(200);
    expect(legs.legacy.body).toMatchObject({
      code: 200,
      data: { qrimg: expect.stringContaining('data:image/png;base64,') },
    });
    if (runtime === 'serverless' && channel === 'qq')
      expect(legs.legacy.calls).toEqual([{ kind: 'relay', method: 'image', id: 'fixture-qr-id' }]);
    expect(legs.operation).toEqual(legs.legacy);
    expect(legs.host).toEqual(legs.legacy);
  });
  it.each(['invalid', 'expired'] as const)('key %s 仍回 404', async (mode) => {
    const options = await upstream.options('create', { mode });
    const legs = await parity(
      runtime,
      '/login/qr/create?key=' + encodeURIComponent(options.key),
      upstream.calls,
      options,
    );
    expect(legs.legacy.status).toBe(404);
    expect(legs.legacy.calls).toEqual([]);
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
      '/login/qr/create' + query,
      upstream.calls,
      await upstream.options('create'),
    );
    expect(legs.legacy.status).toBe(
      query.includes('fixture-invalid') || (runtime === 'node' && query === '?key=&key=other')
        ? 404
        : 400,
    );
    expect(legs.operation).toEqual(legs.legacy);
    expect(legs.host).toEqual(legs.legacy);
  });
  it.each(['second', 'empty-first', 'unused'] as const)('重复 key 的取法 %s', async (kind) => {
    const options = await upstream.options('create');
    const key = encodeURIComponent(options.key);
    const query =
      kind === 'second'
        ? '?key=' + key + '&key=other'
        : kind === 'empty-first'
          ? '?key=&key=' + key
          : '?key=' + key + '&unused=&unused=b';
    const legs = await parity(runtime, '/login/qr/create' + query, upstream.calls, options);
    expect(legs.legacy.status).toBe(
      kind === 'unused' ? 200 : runtime === 'node' ? 404 : kind === 'empty-first' ? 400 : 200,
    );
    expect(legs.operation).toEqual(legs.legacy);
    expect(legs.host).toEqual(legs.legacy);
  });
  it.each([{ network: true }, { httpStatus: 503 }])('图片上游失败 %j', async (state) => {
    Object.assign(upstream.state, state, { failPhase: 'qr' });
    const options = await upstream.options('create', { channel: 'wechat' });
    const legs = await parity(
      runtime,
      '/login/qr/create?key=' + encodeURIComponent(options.key),
      upstream.calls,
      options,
    );
    expect(legs.legacy.status).toBe(502);
    expect(JSON.stringify(legs.legacy.body)).not.toContain('fixture-private');
    expect(legs.operation).toEqual(legs.legacy);
    expect(legs.host).toEqual(legs.legacy);
  });
  if (runtime === 'node')
    it('保留 QR 创建的上游业务拒绝与诊断', async () => {
      Object.assign(upstream.state, { failPhase: 'qr', businessCode: 20261 });
      const options = await upstream.options('create');
      const legs = await parity(
        runtime,
        '/login/qr/create?key=' + options.key,
        upstream.calls,
        options,
      );
      expect(legs.legacy.status).toBe(502);
      expect(legs.legacy.body).toMatchObject({ upstreamCode: 20261, failureStage: 'qr-create' });
      expect(legs.operation).toEqual(legs.legacy);
      expect(legs.host).toEqual(legs.legacy);
    });
  if (runtime === 'serverless')
    it('前一把密钥封存的 key 仍可重放', async () => {
      const options = await upstream.options('create', { previous: true });
      const legs = await parity(
        runtime,
        '/login/qr/create?key=' + encodeURIComponent(options.key),
        upstream.calls,
        options,
      );
      expect(legs.legacy.status).toBe(200);
      expect(legs.operation).toEqual(legs.legacy);
      expect(legs.host).toEqual(legs.legacy);
    });
});
