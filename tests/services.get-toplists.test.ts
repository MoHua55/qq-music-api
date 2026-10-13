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

import getTopLists from '../src/services/rank/getTopLists';
import { logger } from '../src/util/logger';

const mockedLogger = logger as jest.Mocked<typeof logger>;

describe('services/getTopLists', () => {
  beforeEach(() => {
    mockYCommon.mockReset();
    jest.clearAllMocks();
  });

  it('应在成功时解析 JSONP 并合并默认参数', async () => {
    mockYCommon.mockResolvedValue({
      data: 'MusicJsonCallback({"code":0,"data":{"topList":[{"id":26}]}})',
    });

    const option = {
      headers: {
        'x-req-id': '1',
      },
    };

    const result = await getTopLists({
      method: 'post',
      params: {
        format: 'xml',
        needNewCode: 0,
      },
      option,
    });

    expect(mockYCommon).toHaveBeenCalledWith({
      url: '/v8/fcg-bin/fcg_myqq_toplist.fcg',
      method: 'post',
      options: {
        headers: {
          'x-req-id': '1',
        },
        params: {
          format: 'json',
          outCharset: 'utf-8',
          platform: 'h5',
          needNewCode: 1,
        },
      },
      hasCommonParams: false,
    });
    expect(result).toEqual({
      status: 200,
      body: {
        response: {
          code: 0,
          data: {
            topList: [{ id: 26 }],
          },
        },
      },
    });
    expect(mockedLogger.info).toHaveBeenCalledWith(
      'service.requesting',
      expect.objectContaining({
        service: 'getTopLists',
        hasCommonParams: false,
      }),
    );
    expect(mockedLogger.info).toHaveBeenCalledWith(
      'service.succeeded',
      expect.objectContaining({
        service: 'getTopLists',
        isJsonpResponse: true,
      }),
    );
  });

  it('应在未传入参数时使用默认值', async () => {
    mockYCommon.mockResolvedValue({
      data: {
        code: 0,
      },
    });

    await getTopLists({});

    expect(mockYCommon).toHaveBeenCalledWith({
      url: '/v8/fcg-bin/fcg_myqq_toplist.fcg',
      method: 'get',
      options: {
        params: {
          format: 'json',
          outCharset: 'utf-8',
          platform: 'h5',
          needNewCode: 1,
        },
      },
      hasCommonParams: false,
    });
  });

  it('应在非匹配 JSONP 时直接返回原始字符串', async () => {
    mockYCommon.mockResolvedValue({
      data: 'MusicJsonCallback(not-json)',
    });

    const result = await getTopLists({});

    expect(result).toEqual({
      status: 200,
      body: {
        response: 'MusicJsonCallback(not-json)',
      },
    });
  });

  it('应在底层请求失败时返回 500', async () => {
    const error = new Error('toplists failed');
    mockYCommon.mockRejectedValue(error);

    const result = await getTopLists({});

    expect(result).toEqual({
      status: 500,
      body: {
        error: { name: 'Error', message: 'Service request failed' },
      },
    });
    expect(mockedLogger.error).toHaveBeenCalledWith(
      'service.failed',
      expect.objectContaining({
        service: 'getTopLists',
        hasCommonParams: false,
        error: {
          name: 'Error',
          message: 'Service request failed',
        },
      }),
    );
  });
});
