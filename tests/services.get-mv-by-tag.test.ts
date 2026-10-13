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

import getMvByTag from '../src/services/mv/getMvByTag';
import { logger } from '../src/util/logger';

const mockedLogger = logger as jest.Mocked<typeof logger>;

describe('services/getMvByTag', () => {
  beforeEach(() => {
    mockYCommon.mockReset();
    jest.clearAllMocks();
  });

  it('应在成功时返回标准响应并记录请求/成功日志', async () => {
    mockYCommon.mockResolvedValue({
      data: {
        data: [{ vid: 'mv001' }],
      },
    });

    const result = await getMvByTag({
      params: {
        cmd: 'custom',
        lan: 'cn',
      },
    });

    expect(mockYCommon).toHaveBeenCalledWith({
      url: '/mv/fcgi-bin/getmv_by_tag',
      method: 'get',
      options: {
        params: {
          cmd: 'shoubo',
          lan: 'all',
          format: 'json',
          outCharset: 'GB2312',
        },
      },
    });
    expect(result).toEqual({
      status: 200,
      body: {
        response: {
          data: [{ vid: 'mv001' }],
        },
      },
    });
    expect(mockedLogger.info).toHaveBeenCalledWith(
      'service.requesting',
      expect.objectContaining({
        service: 'getMvByTag',
      }),
    );
    expect(mockedLogger.info).toHaveBeenCalledWith(
      'service.succeeded',
      expect.objectContaining({
        service: 'getMvByTag',
        cmd: 'shoubo',
        lan: 'all',
      }),
    );
  });

  it('应在底层请求失败时返回 500 并记录失败日志', async () => {
    const error = new Error('mv by tag failed');
    mockYCommon.mockRejectedValue(error);

    const result = await getMvByTag({});

    expect(result).toEqual({
      status: 500,
      body: {
        error: { name: 'Error', message: 'Service request failed' },
      },
    });
    expect(mockedLogger.error).toHaveBeenCalledWith(
      'service.failed',
      expect.objectContaining({
        service: 'getMvByTag',
        error: {
          name: 'Error',
          message: 'Service request failed',
        },
      }),
    );
  });
});
