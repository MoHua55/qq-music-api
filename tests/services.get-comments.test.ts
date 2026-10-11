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

import getComments from '../src/services/comments/getComments';
import { logger } from '../src/util/logger';

const mockedLogger = logger as jest.Mocked<typeof logger>;

describe('services/getComments', () => {
  beforeEach(() => {
    mockYCommon.mockReset();
    jest.clearAllMocks();
  });

  it('应在成功时返回标准响应并记录请求/成功日志', async () => {
    mockYCommon.mockResolvedValue({
      data: {
        comment: {
          total: 2,
        },
      },
    });

    const result = await getComments({
      params: {
        topid: '8220',
        pagesize: 25,
      },
    });

    expect(mockYCommon).toHaveBeenCalledWith({
      url: '/base/fcgi-bin/fcg_global_comment_h5.fcg',
      method: 'get',
      options: {
        params: {
          topid: '8220',
          pagesize: 25,
          format: 'json',
          outCharset: 'GB2312',
          domain: 'qq.com',
          ct: 24,
          cv: 10101010,
          needmusiccrit: 0,
        },
      },
    });
    expect(result).toEqual({
      status: 200,
      body: {
        response: {
          comment: {
            total: 2,
          },
        },
      },
    });
    expect(mockedLogger.info).toHaveBeenCalledWith(
      'service.requesting',
      expect.objectContaining({
        service: 'getComments',
      }),
    );
    expect(mockedLogger.info).toHaveBeenCalledWith(
      'service.succeeded',
      expect.objectContaining({
        service: 'getComments',
        topId: '8220',
      }),
    );
  });

  it('应在底层请求失败时返回 500 并记录失败日志', async () => {
    const error = new Error('comments failed');
    mockYCommon.mockRejectedValue(error);

    const result = await getComments({
      params: {
        topid: '8220',
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
        service: 'getComments',
        error: {
          name: 'Error',
          message: 'Service request failed',
        },
      }),
    );
  });
});
