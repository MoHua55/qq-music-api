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

import getDigitalAlbumLists from '../src/services/digitalAlbum/getDigitalAlbumLists';
import { logger } from '../src/util/logger';

const mockedLogger = logger as jest.Mocked<typeof logger>;

describe('services/getDigitalAlbumLists', () => {
  beforeEach(() => {
    mockYCommon.mockReset();
    jest.clearAllMocks();
  });

  it('应在成功时返回标准响应并记录请求/成功日志', async () => {
    mockYCommon.mockResolvedValue({
      data: {
        list: [{ albumId: '1' }],
      },
    });

    const result = await getDigitalAlbumLists({
      params: {
        cmd: 'custom_cmd',
      },
    });

    expect(mockYCommon).toHaveBeenCalledWith({
      url: '/v8/fcg-bin/musicmall.fcg',
      method: 'get',
      options: {
        params: {
          cmd: 'pc_index_new',
          format: 'json',
          outCharset: 'utf-8',
        },
      },
    });
    expect(result).toEqual({
      status: 200,
      body: {
        response: {
          list: [{ albumId: '1' }],
        },
      },
    });
    expect(mockedLogger.info).toHaveBeenCalledWith(
      'service.requesting',
      expect.objectContaining({
        service: 'getDigitalAlbumLists',
      }),
    );
    expect(mockedLogger.info).toHaveBeenCalledWith(
      'service.succeeded',
      expect.objectContaining({
        service: 'getDigitalAlbumLists',
        cmd: 'pc_index_new',
      }),
    );
  });

  it('应在底层请求失败时返回 500 并记录失败日志', async () => {
    const error = new Error('digital album failed');
    mockYCommon.mockRejectedValue(error);

    const result = await getDigitalAlbumLists({});

    expect(result).toEqual({
      status: 500,
      body: {
        error: { name: 'Error', message: 'Service request failed' },
      },
    });
    expect(mockedLogger.error).toHaveBeenCalledWith(
      'service.failed',
      expect.objectContaining({
        service: 'getDigitalAlbumLists',
        error: {
          name: 'Error',
          message: 'Service request failed',
        },
      }),
    );
  });
});
