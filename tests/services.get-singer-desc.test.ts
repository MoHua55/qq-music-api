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

import getSingerDesc from '../src/services/singers/getSingerDesc';
import { logger } from '../src/util/logger';

const mockedLogger = logger as jest.Mocked<typeof logger>;

describe('services/getSingerDesc', () => {
  beforeEach(() => {
    mockYCommon.mockReset();
    mockMoment.mockClear();
    mockMomentValueOf.mockClear();
    jest.clearAllMocks();
  });

  it('应在成功时返回标准响应并附带 hasCommonParams=false', async () => {
    mockYCommon.mockResolvedValue({
      data: '<xml><data>desc</data></xml>',
    });

    const option = {
      headers: {
        'x-req-id': '1',
      },
    };

    const result = await getSingerDesc({
      method: 'post',
      params: {
        singermid: '0025NhlN2yWrP4',
      },
      option,
    });

    expect(mockYCommon).toHaveBeenCalledWith({
      url: '/splcloud/fcgi-bin/fcg_get_singer_desc.fcg',
      method: 'post',
      options: {
        headers: {
          'x-req-id': '1',
        },
        params: {
          singermid: '0025NhlN2yWrP4',
          format: 'xml',
          outCharset: 'utf-8',
          utf8: 1,
          r: 1710000000000,
        },
      },
      hasCommonParams: false,
    });
    expect(result).toEqual({
      status: 200,
      body: {
        response: '<xml><data>desc</data></xml>',
      },
    });
    expect(mockedLogger.info).toHaveBeenCalledWith(
      'service.requesting',
      expect.objectContaining({
        service: 'getSingerDesc',
        hasCommonParams: false,
      }),
    );
    expect(mockedLogger.info).toHaveBeenCalledWith(
      'service.succeeded',
      expect.objectContaining({
        service: 'getSingerDesc',
        hasCommonParams: false,
        singermid: '0025NhlN2yWrP4',
      }),
    );
  });

  it('应在未传入参数时使用默认值', async () => {
    mockYCommon.mockResolvedValue({
      data: '',
    });

    await getSingerDesc({});

    expect(mockYCommon).toHaveBeenCalledWith({
      url: '/splcloud/fcgi-bin/fcg_get_singer_desc.fcg',
      method: 'get',
      options: {
        params: {
          format: 'xml',
          outCharset: 'utf-8',
          utf8: 1,
          r: 1710000000000,
        },
      },
      hasCommonParams: false,
    });
  });

  it('应在底层请求失败时返回 500', async () => {
    const error = new Error('singer desc failed');
    mockYCommon.mockRejectedValue(error);

    const result = await getSingerDesc({
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
        service: 'getSingerDesc',
        hasCommonParams: false,
        error: {
          name: 'Error',
          message: 'Service request failed',
        },
      }),
    );
  });
});
