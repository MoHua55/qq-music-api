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

import getHotKey from '../src/services/search/getHotKey';
import { logger } from '../src/util/logger';

const mockedLogger = logger as jest.Mocked<typeof logger>;

describe('services/getHotKey', () => {
  beforeEach(() => {
    mockYCommon.mockReset();
    jest.clearAllMocks();
  });

  it('应在成功时返回标准响应并记录请求/成功日志', async () => {
    mockYCommon.mockResolvedValue({
      data: {
        hotkey: ['jay'],
      },
    });

    const result = await getHotKey({
      params: {
        hostUin: 1,
      },
    });

    expect(mockYCommon).toHaveBeenCalledWith({
      url: '/splcloud/fcgi-bin/gethotkey.fcg',
      method: 'get',
      options: {
        params: {
          hostUin: 0,
          format: 'json',
          outCharset: 'utf-8',
          needNewCode: 0,
        },
      },
    });
    expect(result).toEqual({
      status: 200,
      body: {
        response: {
          hotkey: ['jay'],
        },
      },
    });
    expect(mockedLogger.info).toHaveBeenCalledWith(
      'service.requesting',
      expect.objectContaining({
        service: 'getHotKey',
      }),
    );
    expect(mockedLogger.info).toHaveBeenCalledWith(
      'service.succeeded',
      expect.objectContaining({
        service: 'getHotKey',
      }),
    );
  });

  it('应在底层请求失败时返回 500 并记录失败日志', async () => {
    const error = new Error('hotkey failed');
    mockYCommon.mockRejectedValue(error);

    const result = await getHotKey({});

    expect(result).toEqual({
      status: 500,
      body: {
        error: { name: 'Error', message: 'Service request failed' },
      },
    });
    expect(mockedLogger.error).toHaveBeenCalledWith(
      'service.failed',
      expect.objectContaining({
        service: 'getHotKey',
        error: {
          name: 'Error',
          message: 'Service request failed',
        },
      }),
    );
  });
});
