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

import getRadioLists from '../src/services/radio/getRadioLists';
import { logger } from '../src/util/logger';

const mockedLogger = logger as jest.Mocked<typeof logger>;

describe('services/getRadioLists', () => {
  beforeEach(() => {
    mockYCommon.mockReset();
    jest.clearAllMocks();
  });

  it('应在成功时返回标准响应并记录请求/成功日志', async () => {
    mockYCommon.mockResolvedValue({
      data: {
        radio_list: [{ id: 1 }],
      },
    });

    const result = await getRadioLists({
      params: {
        p: 3,
      },
    });

    expect(mockYCommon).toHaveBeenCalledWith({
      url: '/v8/fcg-bin/fcg_v8_radiolist.fcg',
      method: 'get',
      options: {
        params: {
          p: 1,
          format: 'json',
          outCharset: 'utf-8',
          channel: 'radio',
          page: 'index',
          tpl: 'wk',
          new: 1,
        },
      },
    });
    expect(result).toEqual({
      status: 200,
      body: {
        response: {
          radio_list: [{ id: 1 }],
        },
      },
    });
    expect(mockedLogger.info).toHaveBeenCalledWith(
      'service.requesting',
      expect.objectContaining({
        service: 'getRadioLists',
      }),
    );
    expect(mockedLogger.info).toHaveBeenCalledWith(
      'service.succeeded',
      expect.objectContaining({
        service: 'getRadioLists',
        page: 1,
      }),
    );
  });

  it('应在底层请求失败时返回 500 并记录失败日志', async () => {
    const error = new Error('radio failed');
    mockYCommon.mockRejectedValue(error);

    const result = await getRadioLists({});

    expect(result).toEqual({
      status: 500,
      body: {
        error: { name: 'Error', message: 'Service request failed' },
      },
    });
    expect(mockedLogger.error).toHaveBeenCalledWith(
      'service.failed',
      expect.objectContaining({
        service: 'getRadioLists',
        error: {
          name: 'Error',
          message: 'Service request failed',
        },
      }),
    );
  });
});
