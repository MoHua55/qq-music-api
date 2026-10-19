const mockRequest = jest.fn();

jest.mock('../src/node/request', () => ({
  __esModule: true,
  default: mockRequest,
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

import downloadQQMusic from '../src/services/downloadQQMusic';
import { logger } from '../src/util/logger';

const mockedLogger = logger as jest.Mocked<typeof logger>;

describe('services/downloadQQMusic', () => {
  beforeEach(() => {
    mockRequest.mockReset();
    jest.clearAllMocks();
  });

  it('应在成功时解析 JSONP 字符串并合并默认参数', async () => {
    mockRequest.mockResolvedValue({
      data: 'MusicJsonCallback({"code":0,"url":"https://qqmusic.test"})',
    });

    const option = {
      headers: {
        'x-trace-id': 'trace-1',
      },
    };

    const result = await downloadQQMusic({
      method: 'post',
      params: {
        songmid: '0039MnYb0qxYhV',
      },
      option,
    });

    expect(mockRequest).toHaveBeenCalledWith(
      '/download/download.js',
      'post',
      {
        headers: {
          host: 'y.qq.com',
          referer: 'https://y.qq.com/',
          'x-trace-id': 'trace-1',
        },
        params: {
          songmid: '0039MnYb0qxYhV',
          format: 'jsonp',
          jsonpCallback: 'MusicJsonCallback',
          platform: 'yqq',
        },
      },
      'y',
    );
    expect(result).toEqual({
      status: 200,
      body: {
        response: {
          code: 0,
          url: 'https://qqmusic.test',
        },
      },
    });
    expect(mockedLogger.info).toHaveBeenCalledWith(
      'service.requesting',
      expect.objectContaining({
        service: 'downloadQQMusic',
      }),
    );
    expect(mockedLogger.info).toHaveBeenCalledWith(
      'service.succeeded',
      expect.objectContaining({
        service: 'downloadQQMusic',
        isJsonpResponse: true,
      }),
    );
  });

  it('应在响应不是 JSONP 时直接透传对象', async () => {
    mockRequest.mockResolvedValue({
      data: {
        code: 0,
        message: 'ok',
      },
    });

    const result = await downloadQQMusic({});

    expect(mockRequest).toHaveBeenCalledWith(
      '/download/download.js',
      'get',
      {
        headers: {
          host: 'y.qq.com',
          referer: 'https://y.qq.com/',
        },
        params: {
          format: 'jsonp',
          jsonpCallback: 'MusicJsonCallback',
          platform: 'yqq',
        },
      },
      'y',
    );
    expect(result).toEqual({
      status: 200,
      body: {
        response: {
          code: 0,
          message: 'ok',
        },
      },
    });
  });

  it('应在 JSONP 不匹配时返回原始字符串', async () => {
    mockRequest.mockResolvedValue({
      data: 'MusicJsonCallback(not-json)',
    });

    const result = await downloadQQMusic({});

    expect(result).toEqual({
      status: 200,
      body: {
        response: 'MusicJsonCallback(not-json)',
      },
    });
  });

  it('应在底层请求失败时返回 500', async () => {
    const error = new Error('download failed');
    mockRequest.mockRejectedValue(error);

    const result = await downloadQQMusic({
      params: {
        songmid: 'test',
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
        service: 'downloadQQMusic',
        error: {
          name: 'Error',
          message: 'Service request failed',
        },
      }),
    );
  });
});
