import type { Context } from 'koa';
import { getLegacyHttpTransport, setLegacyHttpTransport } from '../src/services/httpTransport';
import uCommon from '../src/services/u_common';
import yCommon from '../src/services/y_common';
import { logger } from '../src/util/logger';
import {
  sanitizeRequestUrl,
  summarizeRequestContext,
  withControllerLogging,
} from '../src/util/observability';

const PRIVATE = [
  'SongSecretA1234',
  'SongSecretB1234',
  'MediaSecret123',
  'PrivateTitle',
  'PrivateCookie',
];
const expectSafe = (value: unknown) => {
  const json = JSON.stringify(value);
  for (const secret of PRIVATE) expect(json).not.toContain(secret);
};
describe('日志只保留结构', () => {
  afterEach(() => jest.restoreAllMocks());
  it('路径和 query 不泄露歌曲标识或参数值', () => {
    expect(
      sanitizeRequestUrl(
        '/getMusicPlay/SongSecretA1234?mediaId=MediaSecret123&cookie=PrivateCookie',
      ),
    ).toBe('/getMusicPlay/:songmid');
    expectSafe(
      summarizeRequestContext({
        path: '/getMusicPlay/SongSecretA1234',
        params: { songmid: 'SongSecretA1234' },
        query: { mediaId: 'MediaSecret123', name: 'PrivateTitle' },
        request: { body: { ids: PRIVATE } },
      } as unknown as Context),
    );
  });
  it('controller 保留方法、路由模板、数量、错误码和耗时，响应中的动态键也不泄露', async () => {
    const info = jest.spyOn(logger, 'info').mockImplementation(() => undefined);
    const ctx = {
      method: 'GET',
      path: '/getMusicPlay/SongSecretA1234,SongSecretB1234',
      _matchedRoute: '/getMusicPlay/:songmid?',
      query: { mediaId: 'MediaSecret123' },
      params: { songmid: 'SongSecretA1234,SongSecretB1234' },
      request: {},
      status: 200,
      body: {
        code: 104003,
        data: { playUrl: { SongSecretA1234: { url: 'https://stream.invalid/MediaSecret123' } } },
      },
    } as unknown as Context;
    await withControllerLogging('getMusicPlay', async () => undefined)(ctx);
    expectSafe(info.mock.calls);
    expect(info).toHaveBeenCalledWith(
      'request.received',
      expect.objectContaining({
        method: 'GET',
        route: '/getMusicPlay/:songmid',
        params: expect.any(Object),
      }),
    );
    expect(info).toHaveBeenCalledWith(
      'request.succeeded',
      expect.objectContaining({
        status: 200,
        durationMs: expect.any(Number),
        result: expect.objectContaining({ code: 104003 }),
      }),
    );
    expect(JSON.stringify(info.mock.calls)).toContain('mediaId');
  });
  it('u_common 与 y_common 的原始请求日志只留 RPC 方法和参数键名', async () => {
    const debug = jest.spyOn(logger, 'debug').mockImplementation(() => undefined);
    const previous = getLegacyHttpTransport();
    setLegacyHttpTransport({
      kind: 'fixture',
      defaults: previous.defaults,
      request: jest.fn(async () => ({ data: {}, status: 200 }) as any),
    });
    try {
      await uCommon({
        method: 'post',
        options: {
          params: {
            data: JSON.stringify({
              comm: { uin: 'PrivateCookie' },
              req_0: {
                module: 'fixture.module',
                method: 'FixtureRead',
                param: { songmid: PRIVATE[0], mediaId: PRIVATE[2] },
              },
            }),
          },
        },
      });
      await yCommon({
        url: '/cgi-bin/fixture.fcg?uin=PrivateCookie',
        options: { params: { name: 'PrivateTitle' } },
      });
      expectSafe(debug.mock.calls);
      expect(JSON.stringify(debug.mock.calls)).toContain('FixtureRead');
      expect(JSON.stringify(debug.mock.calls)).toContain('songmid');
      expect(JSON.stringify(debug.mock.calls)).toContain('post');
    } finally {
      setLegacyHttpTransport(previous);
    }
  });
});
