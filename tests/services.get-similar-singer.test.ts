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

import getSimilarSinger from '../src/services/singers/getSimilarSinger';
import { logger } from '../src/util/logger';

const mockedLogger = logger as jest.Mocked<typeof logger>;

describe('services/getSimilarSinger', () => {
  beforeEach(() => {
    mockYCommon.mockReset();
    jest.clearAllMocks();
  });

  it('应在成功时返回标准响应并合并默认参数', async () => {
    mockYCommon.mockResolvedValue({
      data: {
        code: 0,
        singerlist: [{ mid: '0025NhlN2yWrP4' }],
      },
    });

    const option = {
      headers: {
        'x-req-id': '1',
      },
    };

    const result = await getSimilarSinger({
      method: 'post',
      params: {
        singermid: '0025NhlN2yWrP4',
        num: 9,
      },
      option,
    });

    expect(mockYCommon).toHaveBeenCalledWith({
      url: '/v8/fcg-bin/fcg_v8_simsinger.fcg',
      method: 'post',
      options: {
        headers: {
          'x-req-id': '1',
        },
        params: {
          singermid: '0025NhlN2yWrP4',
          num: 5,
          format: 'json',
          outCharset: 'utf-8',
          utf8: 1,
          start: 0,
        },
      },
    });
    expect(result).toEqual({
      status: 200,
      body: {
        response: {
          code: 0,
          singerlist: [{ mid: '0025NhlN2yWrP4' }],
        },
      },
    });
    expect(mockedLogger.info).toHaveBeenCalledWith(
      'service.requesting',
      expect.objectContaining({
        service: 'getSimilarSinger',
      }),
    );
    expect(mockedLogger.info).toHaveBeenCalledWith(
      'service.succeeded',
      expect.objectContaining({
        service: 'getSimilarSinger',
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

    await getSimilarSinger({});

    expect(mockYCommon).toHaveBeenCalledWith({
      url: '/v8/fcg-bin/fcg_v8_simsinger.fcg',
      method: 'get',
      options: {
        params: {
          format: 'json',
          outCharset: 'utf-8',
          utf8: 1,
          start: 0,
          num: 5,
        },
      },
    });
  });

  it('应在底层请求失败时返回 500', async () => {
    const error = new Error('similar singer failed');
    mockYCommon.mockRejectedValue(error);

    const result = await getSimilarSinger({
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
        service: 'getSimilarSinger',
        error: {
          name: 'Error',
          message: 'Service request failed',
        },
      }),
    );
  });
});
