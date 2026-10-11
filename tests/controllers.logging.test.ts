const mockServices = {
  getAlbumInfo: jest.fn(),
  getSearchByKey: jest.fn(),
  downloadQQMusic: jest.fn(),
  UCommon: jest.fn(),
};

jest.mock('../src/services', () => ({
  __esModule: true,
  default: mockServices,
}));

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

  it('应为 getSearchByKey 成功场景记录 succeeded 日志', async () => {
    mockServices.getSearchByKey.mockResolvedValue({
      status: 200,
      body: {
        response: {
          data: {
            list: ['jay'],
          },
        },
      },
    });

    const ctx = createCtx({
      path: '/getSearchByKey',
      query: {
        key: '周杰伦',
        limit: '20',
      },
    });

    await controllers.getSearchByKey(ctx);

    expect(ctx.status).toBe(200);
    expect(mockedLogger.info).toHaveBeenCalledWith(
      'request.succeeded',
      expect.objectContaining({
        controller: 'getSearchByKey',
        status: 200,
      }),
    );
  });

  it('应为 getDownloadQQMusic 成功场景记录请求摘要和成功日志', async () => {
    mockServices.downloadQQMusic.mockResolvedValue({
      status: 200,
      body: {
        response: {
          code: 0,
          url: 'https://qqmusic.test',
        },
      },
    });

    const ctx = createCtx({
      path: '/getDownloadQQMusic',
    });

    await controllers.getDownloadQQMusic(ctx);

    expect(mockedLogger.info).toHaveBeenCalledWith(
      'request.received',
      expect.objectContaining({
        controller: 'getDownloadQQMusic',
      }),
    );
    expect(mockedLogger.info).toHaveBeenCalledWith(
      'request.succeeded',
      expect.objectContaining({
        controller: 'getDownloadQQMusic',
        status: 200,
      }),
    );
  });

  it('应在 batchGetSongInfo 内部抛错时记录 failed 日志并返回 500', async () => {
    mockServices.UCommon.mockRejectedValue(new Error('u common failed'));

    const ctx = createCtx({
      method: 'POST',
      path: '/batchGetSongInfo',
      request: {
        body: {
          songs: [['001']],
        },
      },
    });

    await controllers.batchGetSongInfo(ctx);

    expect(ctx.status).toBe(500);
    expect(ctx.body).toEqual({
      error: 'Service request failed',
    });
    expect(mockedLogger.error).toHaveBeenCalledWith(
      'request.failed',
      expect.objectContaining({
        controller: 'batchGetSongInfo',
        status: 500,
      }),
    );
  });

  it('应为 getCookie 记录成功日志并返回安全配置', async () => {
    const ctx = createCtx({
      path: '/user/getCookie',
    });

    await controllers.getCookie(ctx);

    expect(ctx.status).toBe(200);
    expect(ctx.body).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          code: 200,
        }),
      }),
    );
    expect(mockedLogger.info).toHaveBeenCalledWith(
      'request.succeeded',
      expect.objectContaining({
        controller: 'getCookie',
        status: 200,
      }),
    );
  });

  it('应为 setCookie 记录校验失败日志并返回 403', async () => {
    const ctx = createCtx({
      path: '/user/setCookie',
    });

    await controllers.setCookie(ctx);

    expect(ctx.status).toBe(403);
    expect(ctx.body).toEqual({
      data: {
        code: 403,
        message: 'Setting cookie dynamically is disabled for security reasons.',
      },
    });
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      'request.validation_failed',
      expect.objectContaining({
        controller: 'setCookie',
        status: 403,
      }),
    );
  });

  it('应为 getMvPlay 的参数缺失场景记录 validation_failed 日志', async () => {
    const ctx = createCtx({
      path: '/getMvPlay',
    });

    await controllers.getMvPlay(ctx);

    expect(ctx.status).toBe(400);
    expect(ctx.body).toEqual({
      response: 'vid is null',
    });
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      'request.validation_failed',
      expect.objectContaining({
        controller: 'getMvPlay',
        status: 400,
      }),
    );
  });

  it('应为 getMvPlay 的成功场景记录 succeeded 日志并补充播放列表', async () => {
    mockServices.UCommon.mockResolvedValue({
      data: {
        getMVUrl: {
          data: {
            sample: {
              mp4: [{ freeflow_url: ['https://qq.test/video.f10.mp4'] }],
              hls: [{ freeflow_url: ['https://qq.test/video.m3u8'] }],
            },
          },
        },
      },
    });

    const ctx = createCtx({
      path: '/getMvPlay',
      query: {
        vid: 'mv001',
      },
    });

    await controllers.getMvPlay(ctx);

    expect(ctx.status).toBe(200);
    expect(ctx.body).toEqual({
      response: expect.objectContaining({
        getMVUrl: expect.any(Object),
        playLists: {
          f10: ['https://qq.test/video.f10.mp4'],
          f20: [],
          f30: [],
          f40: [],
        },
      }),
    });
    expect(mockedLogger.info).toHaveBeenCalledWith(
      'request.succeeded',
      expect.objectContaining({
        controller: 'getMvPlay',
        status: 200,
      }),
    );
  });
});
