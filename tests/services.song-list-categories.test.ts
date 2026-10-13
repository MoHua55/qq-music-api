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

import songListCategories from '../src/services/songLists/songListCategories';
import { logger } from '../src/util/logger';

const mockedLogger = logger as jest.Mocked<typeof logger>;

describe('services/songListCategories', () => {
  beforeEach(() => {
    mockYCommon.mockReset();
    jest.clearAllMocks();
  });

  it('应在成功时返回标准响应并记录请求/成功日志', async () => {
    mockYCommon.mockResolvedValue({
      data: {
        categories: [{ id: 1 }],
      },
    });

    const result = await songListCategories({
      params: {
        outCharset: 'gbk',
      },
    });

    expect(mockYCommon).toHaveBeenCalledWith({
      url: '/splcloud/fcgi-bin/fcg_get_diss_tag_conf.fcg',
      method: 'get',
      options: {
        params: {
          format: 'json',
          outCharset: 'utf-8',
        },
      },
    });
    expect(result).toEqual({
      status: 200,
      body: {
        response: {
          categories: [{ id: 1 }],
        },
      },
    });
    expect(mockedLogger.info).toHaveBeenCalledWith(
      'service.requesting',
      expect.objectContaining({
        service: 'songListCategories',
      }),
    );
    expect(mockedLogger.info).toHaveBeenCalledWith(
      'service.succeeded',
      expect.objectContaining({
        service: 'songListCategories',
      }),
    );
  });

  it('应在底层请求失败时返回 500 并记录失败日志', async () => {
    const error = new Error('song list categories failed');
    mockYCommon.mockRejectedValue(error);

    const result = await songListCategories({});

    expect(result).toEqual({
      status: 500,
      body: {
        error: { name: 'Error', message: 'Service request failed' },
      },
    });
    expect(mockedLogger.error).toHaveBeenCalledWith(
      'service.failed',
      expect.objectContaining({
        service: 'songListCategories',
        error: {
          name: 'Error',
          message: 'Service request failed',
        },
      }),
    );
  });
});
