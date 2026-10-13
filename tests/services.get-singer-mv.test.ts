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

import getSingerMv from '../src/services/singers/getSingerMv';
import { logger } from '../src/util/logger';

const mockedLogger = logger as jest.Mocked<typeof logger>;

describe('services/getSingerMv', () => {
  beforeEach(() => {
    mockYCommon.mockReset();
    jest.clearAllMocks();
  });

  it('应在成功时返回标准响应并合并默认参数', async () => {
    mockYCommon.mockResolvedValue({
      data: {
        code: 0,
        list: [{ vid: 'mv001' }],
      },
    });

    const option = {
      headers: {
        'x-req-id': '1',
      },
    };

    const result = await getSingerMv({
      method: 'post',
      params: {
        singermid: '0025NhlN2yWrP4',
        begin: 8,
      },
      option,
    });

    expect(mockYCommon).toHaveBeenCalledWith({
      url: '/mv/fcgi-bin/fcg_singer_mv.fcg',
      method: 'post',
      options: {
        headers: {
          'x-req-id': '1',
        },
        params: {
          singermid: '0025NhlN2yWrP4',
          begin: 0,
          format: 'json',
          outCharset: 'utf-8',
          cid: 205360581,
        },
      },
    });
    expect(result).toEqual({
      status: 200,
      body: {
        response: {
          code: 0,
          list: [{ vid: 'mv001' }],
        },
      },
    });
    expect(mockedLogger.info).toHaveBeenCalledWith(
      'service.requesting',
      expect.objectContaining({
        service: 'getSingerMv',
      }),
    );
    expect(mockedLogger.info).toHaveBeenCalledWith(
      'service.succeeded',
      expect.objectContaining({
        service: 'getSingerMv',
        singermid: '0025NhlN2yWrP4',
      }),
    );
  });

  it('应在未传入参数时使用默认值', async () => {
    mockYCommon.mockResolvedValue({
      data: {
        code: 0,
      },
    });

    await getSingerMv({});

    expect(mockYCommon).toHaveBeenCalledWith({
      url: '/mv/fcgi-bin/fcg_singer_mv.fcg',
      method: 'get',
      options: {
        params: {
          format: 'json',
          outCharset: 'utf-8',
          cid: 205360581,
          begin: 0,
        },
      },
    });
  });

  it('应在底层请求失败时返回 500', async () => {
    const error = new Error('singer mv failed');
    mockYCommon.mockRejectedValue(error);

    const result = await getSingerMv({
      params: {
        singermid: 'test',
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
        service: 'getSingerMv',
        error: {
          name: 'Error',
          message: 'Service request failed',
        },
      }),
    );
  });
});
