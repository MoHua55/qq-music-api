import './helpers/qrRoutes';
import { loginChannels as legacyLoginChannels } from '../src/controllers/login';
import { loginChannels } from '../src/routes/operations/loginChannels';
import { handleRequest } from '../src/serverless';
import { legacyRoutes } from '../src/serverless/legacyRoutes';
import { CATALOG_RUNTIMES } from './helpers/catalogRoutes';
import { createParityRunner } from './helpers/operationParity';
import { useQrUpstream } from './helpers/qrRoutes';

const parity = createParityRunner(
  { name: 'loginChannels', node: '/login/channels', serverless: '/login/channels' },
  {
    legacyNode: legacyLoginChannels,
    legacyServerless: legacyRoutes['/login/channels'],
    operation: loginChannels,
  },
);
describe.each(CATALOG_RUNTIMES)('/login/channels 新旧实现比对（%s）', (runtime) => {
  const upstream = useQrUpstream(runtime);
  it.each([
    { relay: true, secret: 'fixture-secret', configured: true },
    { relay: false, secret: 'fixture-secret', configured: true },
    { relay: true, secret: undefined, configured: false },
    { relay: false, secret: '', configured: false },
    { relay: true, secret: undefined, previous: 'fixture-old-secret', configured: false },
  ])('relay 与密钥 $relay/$configured', async ({ relay, secret, previous, configured }) => {
    const options = await upstream.options('channels', { relay });
    options.env = { QQ_SESSION_SECRET: secret, QQ_SESSION_SECRET_PREVIOUS: previous };
    const service = jest.fn(options.service);
    options.service = service;
    const legs = await parity(runtime, '/login/channels', upstream.calls, options);
    expect(legs.legacy.status).toBe(200);
    expect(legs.legacy.body).toMatchObject({
      code: 200,
      data: {
        channels: runtime === 'node' || relay ? ['qq', 'wechat'] : ['wechat'],
        sessionMode: runtime === 'node' ? 'stored' : 'sealed',
        configured: runtime === 'node' ? true : configured,
        features: { recommendations: { getPersonalFm: true, getRecommendedCollections: true } },
      },
    });
    expect(legs.legacy.calls).toEqual([]);
    expect(service).not.toHaveBeenCalled();
    expect(legs.operation).toEqual(legs.legacy);
    expect(legs.host).toEqual(legs.legacy);
  });
  it.each([
    '/',
    '?unused=&unused=b',
    '?cookie=not-a-session',
    '?channel=invalid',
    '?channel=qq&channel=wechat',
  ])('尾斜线与无关参数 %s 不影响能力', async (suffix) => {
    const legs = await parity(
      runtime,
      '/login/channels' + suffix,
      upstream.calls,
      await upstream.options('channels'),
    );
    expect(legs.legacy.status).toBe(200);
    expect(legs.legacy.calls).toEqual([]);
    expect(legs.operation).toEqual(legs.legacy);
    expect(legs.host).toEqual(legs.legacy);
  });
  if (runtime === 'serverless')
    it('保留入口在 POST 时也直接回能力的既有行为', async () => {
      const response = await handleRequest(
        new Request('https://fixture.invalid/login/channels/', { method: 'POST' }),
        {},
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        code: 200,
        data: { configured: false, channels: ['wechat'] },
      });
      expect(upstream.calls).toEqual([]);
    });
});
