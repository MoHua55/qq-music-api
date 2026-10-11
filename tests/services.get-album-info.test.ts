const mockYCommon = jest.fn();

jest.mock('../src/services/y_common', () => ({
  __esModule: true,
  default: mockYCommon,
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

import getAlbumInfo from '../src/services/album/getAlbumInfo';
import { logger } from '../src/util/logger';

const mockedLogger = logger as jest.Mocked<typeof logger>;

describe('services/getAlbumInfo', () => {
  beforeEach(() => {
    mockYCommon.mockReset();
    jest.clearAllMocks();
  });

  it('应在成功时返回标准响应并合并默认参数', async () => {
    mockYCommon.mockResolvedValue({
      data: {
        code: 0,
        data: {
          name: '范特西',
        },
      },
    });

    const options = {
      headers: {
        'x-req-id': '1',
      },
    };

    const result = await getAlbumInfo({
      method: 'post',
      params: {
        albummid: '0016l2F430zMux',
        format: 'xml',
      },
      options,
    });

    expect(mockYCommon).toHaveBeenCalledWith({
      url: '/v8/fcg-bin/fcg_v8_album_info_cp.fcg',
      method: 'post',
      options: {
        headers: {
          'x-req-id': '1',
        },
        params: {
          albummid: '0016l2F430zMux',
          format: 'json',
          outCharset: 'utf-8',
        },
      },
    });
    expect(result).toEqual({
      status: 200,
      body: {
        response: {
          code: 0,
          data: {
            name: '范特西',
          },
        },
      },
    });
    expect(mockedLogger.info).toHaveBeenCalledWith(
      'service.requesting',
      expect.objectContaining({
        service: 'getAlbumInfo',
      }),
    );
    expect(mockedLogger.info).toHaveBeenCalledWith(
      'service.succeeded',
      expect.objectContaining({
        service: 'getAlbumInfo',
      }),
    );
  });

  it('应在未传入参数时使用默认值', async () => {
    mockYCommon.mockResolvedValue({
      data: {
        code: 0,
      },
    });

    await getAlbumInfo({});

    expect(mockYCommon).toHaveBeenCalledWith({
      url: '/v8/fcg-bin/fcg_v8_album_info_cp.fcg',
      method: 'get',
      options: {
        params: {
          format: 'json',
          outCharset: 'utf-8',
        },
      },
    });
  });

  it('应在底层请求失败时返回 500', async () => {
    const error = new Error('album info failed');
    mockYCommon.mockRejectedValue(error);

    const result = await getAlbumInfo({
      params: {
        albummid: 'test',
      },
    });

    expect(result).toEqual({
      status: 500,
      body: {
        error: { name: 'Error', message: 'Service request failed' },
      },
    });
    expect(mockedLogger.error).toHaveBeenCalledWith(
      'service.failed',
      expect.objectContaining({
        service: 'getAlbumInfo',
        error: {
          name: 'Error',
          message: 'Service request failed',
        },
      }),
    );
  });
});
