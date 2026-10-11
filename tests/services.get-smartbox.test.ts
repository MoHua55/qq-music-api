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

import getSmartbox from '../src/services/search/getSmartbox';
import { logger } from '../src/util/logger';

const mockedLogger = logger as jest.Mocked<typeof logger>;

describe('services/getSmartbox', () => {
  beforeEach(() => {
    mockYCommon.mockReset();
    jest.clearAllMocks();
  });

  it('应在成功时返回标准响应并合并默认参数', async () => {
    mockYCommon.mockResolvedValue({
      data: {
        code: 0,
        tips: ['jay'],
      },
    });

    const option = {
      headers: {
        'x-req-id': '1',
      },
    };

    const result = await getSmartbox({
      method: 'post',
      params: {
        key: '周杰伦',
        is_xml: 1,
      },
      option,
    });

    expect(mockYCommon).toHaveBeenCalledWith({
      url: '/splcloud/fcgi-bin/smartbox_new.fcg',
      method: 'post',
      options: {
        headers: {
          'x-req-id': '1',
        },
        params: {
          key: '周杰伦',
          is_xml: 0,
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
          tips: ['jay'],
        },
      },
    });
    expect(mockedLogger.info).toHaveBeenCalledWith(
      'service.requesting',
      expect.objectContaining({
        service: 'getSmartbox',
      }),
    );
    expect(mockedLogger.info).toHaveBeenCalledWith(
      'service.succeeded',
      expect.objectContaining({
        service: 'getSmartbox',
        key: '周杰伦',
      }),
    );
  });

  it('应在未传入参数时使用默认值', async () => {
    mockYCommon.mockResolvedValue({
      data: {
        code: 0,
      },
    });

    await getSmartbox({});

    expect(mockYCommon).toHaveBeenCalledWith({
      url: '/splcloud/fcgi-bin/smartbox_new.fcg',
      method: 'get',
      options: {
        params: {
          format: 'json',
          outCharset: 'utf-8',
          is_xml: 0,
        },
      },
    });
  });

  it('应在底层请求失败时返回 500', async () => {
    const error = new Error('smartbox failed');
    mockYCommon.mockRejectedValue(error);

    const result = await getSmartbox({
      params: {
        key: 'test',
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
        service: 'getSmartbox',
        error: {
          name: 'Error',
          message: 'Service request failed',
        },
      }),
    );
  });
});
