jest.mock('../src/util/logger', () => ({
  __esModule: true,
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import controllers from '../src/controllers';
import { logger } from '../src/util/logger';

const mockedLogger = logger as jest.Mocked<typeof logger>;

const createCtx = (overrides: Record<string, unknown> = {}) =>
  ({
    method: 'GET',
    path: '/',
    query: {},
    params: {},
    request: {},
    status: 404,
    body: undefined,
    ...overrides,
  }) as any;

describe('controllers logging', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('应为 getAlbumInfo 的参数缺失场景记录 received 和 validation_failed 日志', async () => {
    const ctx = createCtx({
      path: '/getAlbumInfo',
    });

    await controllers.getAlbumInfo(ctx);

    expect(ctx.status).toBe(400);
    expect(mockedLogger.info).toHaveBeenCalledWith(
      'request.received',
      expect.objectContaining({
        controller: 'getAlbumInfo',
        route: '/getAlbumInfo',
      }),
    );
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      'request.validation_failed',
      expect.objectContaining({
        controller: 'getAlbumInfo',
        status: 400,
      }),
    );
  });
});
