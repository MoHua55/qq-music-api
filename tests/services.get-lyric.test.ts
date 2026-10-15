const mockYCommon = jest.fn();
const mockLyricParse = jest.fn();

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

jest.mock('../src/util/lyricParse', () => ({
  __esModule: true,
  default: {
    lyricParse: mockLyricParse,
  },
}));

import getLyric from '../src/services/music/getLyric';
import { logger } from '../src/util/logger';

const mockedLogger = logger as jest.Mocked<typeof logger>;

describe('services/getLyric', () => {
  // 时间戳只用来避开缓存，固定下来好比对请求参数。
  let now: jest.SpyInstance;
  beforeEach(() => {
    mockYCommon.mockReset();
    mockLyricParse.mockReset();
    jest.clearAllMocks();
    now = jest.spyOn(Date, 'now').mockReturnValue(1710000000000);
  });
  afterEach(() => {
    now.mockRestore();
  });

  it('应在未格式化时返回解码后的歌词字符串', async () => {
    const encodedLyric = Buffer.from('[00:01.00]hello').toString('base64');
    mockYCommon.mockResolvedValue({
      data: {
        code: 0,
        lyric: encodedLyric,
      },
    });

    const result = await getLyric({
      params: {
        songmid: '001',
      },
    });

    expect(mockYCommon).toHaveBeenCalledWith({
      url: '/lyric/fcgi-bin/fcg_query_lyric_new.fcg',
      method: 'get',
      options: {
        params: {
          songmid: '001',
          format: 'json',
          outCharset: 'utf-8',
          pcachetime: 1710000000000,
        },
      },
    });
    expect(mockLyricParse).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 200,
      body: {
        response: {
          code: 0,
          lyric: '[00:01.00]hello',
        },
      },
    });
    expect(mockedLogger.info).toHaveBeenCalledWith(
      'service.requesting',
      expect.objectContaining({
        service: 'getLyric',
        formatLyric: false,
      }),
    );
    expect(mockedLogger.info).toHaveBeenCalledWith(
      'service.succeeded',
      expect.objectContaining({
        service: 'getLyric',
      }),
    );
  });

  it('应在 isFormat=true 时调用 lyricParse 格式化歌词', async () => {
    const encodedLyric = Buffer.from('[00:01.00]world').toString('base64');
    const parsedLyric = {
      lines: [{ time: 1000, txt: 'world' }],
    };

    mockYCommon.mockResolvedValue({
      data: {
        lyric: encodedLyric,
        trans: 'ignored',
      },
    });
    mockLyricParse.mockReturnValue(parsedLyric);

    const result = await getLyric({
      isFormat: true,
      options: {
        headers: {
          'x-req-id': '1',
        },
      },
    });

    expect(mockLyricParse).toHaveBeenCalledWith('[00:01.00]world');
    expect(result).toEqual({
      status: 200,
      body: {
        response: {
          lyric: parsedLyric,
          trans: 'ignored',
        },
      },
    });
    expect(mockedLogger.debug).toHaveBeenCalledWith(
      'service.branch_selected',
      expect.objectContaining({
        service: 'getLyric',
        branch: 'format',
      }),
    );
  });

  it('应在歌词为空时以空字符串执行格式化', async () => {
    mockYCommon.mockResolvedValue({
      data: {
        code: 0,
        lyric: '',
      },
    });
    mockLyricParse.mockReturnValue({ lines: [] });

    await getLyric({
      isFormat: true,
    });

    expect(mockLyricParse).toHaveBeenCalledWith('');
  });

  it('应在底层请求失败时返回 500', async () => {
    const error = new Error('lyric failed');
    mockYCommon.mockRejectedValue(error);

    const result = await getLyric({
      params: {
        songmid: '002',
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
        service: 'getLyric',
        error: {
          name: 'Error',
          message: 'Service request failed',
        },
      }),
    );
  });
});
