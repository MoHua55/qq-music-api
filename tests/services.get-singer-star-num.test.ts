const mockYCommon = jest.fn();
const mockMomentValueOf = jest.fn(() => 1710000000000);
const mockMoment = jest.fn(() => ({
  valueOf: mockMomentValueOf,
}));

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

jest.mock('moment', () => ({
  __esModule: true,
  default: mockMoment,
}));

import getSingerStarNum from '../src/services/singers/getSingerStarNum';
import { logger } from '../src/util/logger';

const mockedLogger = logger as jest.Mocked<typeof logger>;

describe('services/getSingerStarNum', () => {
  beforeEach(() => {
    mockYCommon.mockReset();
    mockMoment.mockClear();
    mockMomentValueOf.mockClear();
    jest.clearAllMocks();
  });

  it('应在成功时返回标准响应并合并默认参数', async () => {
    mockYCommon.mockResolvedValue({
      data: {
        code: 0,
        num: 1024,
      },
    });

    const option = {
      headers: {
        'x-req-id': '1',
      },
    };

    const result = await getSingerStarNum({
      method: 'post',
      params: {
        singermid: '0025NhlN2yWrP4',
      },
      option,
    });

    expect(mockYCommon).toHaveBeenCalledWith({
      url: '/rsc/fcgi-bin/fcg_order_singer_getnum.fcg',
      method: 'post',
      options: {
        headers: {
          'x-req-id': '1',
        },
        params: {
          singermid: '0025NhlN2yWrP4',
          format: 'json',
          outCharset: 'utf-8',
          utf8: 1,
          rnd: 1710000000000,
        },
      },
    });
    expect(result).toEqual({
      status: 200,
      body: {
        response: {
          code: 0,
          num: 1024,
        },
      },
    });
    expect(mockedLogger.info).toHaveBeenCalledWith(
      'service.requesting',
      expect.objectContaining({
        service: 'getSingerStarNum',
      }),
    );
    expect(mockedLogger.info).toHaveBeenCalledWith(
      'service.succeeded',
      expect.objectContaining({
        service: 'getSingerStarNum',
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

    await getSingerStarNum({});

    expect(mockYCommon).toHaveBeenCalledWith({
      url: '/rsc/fcgi-bin/fcg_order_singer_getnum.fcg',
      method: 'get',
      options: {
        params: {
          format: 'json',
          outCharset: 'utf-8',
          utf8: 1,
          rnd: 1710000000000,
        },
      },
    });
  });

  it('应在底层请求失败时返回 500', async () => {
    const error = new Error('singer star num failed');
    mockYCommon.mockRejectedValue(error);

    const result = await getSingerStarNum({
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
        service: 'getSingerStarNum',
        error: {
          name: 'Error',
          message: 'Service request failed',
        },
      }),
    );
  });
});
