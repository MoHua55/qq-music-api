import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import { CHECK_BUDGET_MS } from '../src/serverless/qrRuntime';
import type { AuthHttpClient } from '../src/services/auth/httpClient';
import { createQrLoginService, type QrChannelDriver } from '../src/services/auth/qrLogin';
import {
  WECHAT_DEFAULT_POLL_BUDGET_MS,
  wechatPollBudgetMsOf,
} from '../src/services/auth/wechatLogin';

// 微信长轮询的等待时间：Node 每次 check 只等 1.5 秒时，每次中止都会断开连接，下一次要重新握手；
// 网络稍慢就一次都等不到上游回话，手机上同意了，电脑还一直是 801。

const response = <T>(data: T): AxiosResponse<T> =>
  ({
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config: { headers: {} },
  }) as AxiosResponse<T>;

const dictionaryOf = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

/** 只回应建立会话前的两次调用。 */
const createBootstrapHttp = (): AuthHttpClient =>
  ({
    getCookieHeader: () => '',
    request: jest.fn(),
    post: jest.fn(async (_url: string, payload?: unknown) => {
      if (!dictionaryOf(payload).req_0) {
        return response({
          data: JSON.stringify({ code: 0, data: { q16: 'q'.repeat(36), q36: 'r'.repeat(36) } }),
        });
      }
      return response({
        code: 0,
        req_0: { code: 0, data: { session: { uid: 1234567890, sid: 'session-sid' } } },
      });
    }),
  }) as unknown as AuthHttpClient;

interface PollReply {
  status: number;
  /** 上游过多久才回（毫秒）；客户端中止时就不回了。 */
  delayMs?: number;
}

/** 假的微信端点：长轮询按顺序回 `replies`，并且照 `signal` 中止。 */
const createWechatHttp = (replies: PollReply[], polls: AxiosRequestConfig[]): AuthHttpClient =>
  ({
    getCookieHeader: () => '',
    request: jest.fn(async (config: AxiosRequestConfig) => {
      const url = String(config.url);
      if (url === 'https://open.weixin.qq.com/connect/qrconnect')
        return response('<a href="https://open.weixin.qq.com/connect/confirm?uuid=wx-uuid">x</a>');
      if (url.includes('/connect/qrcode/'))
        return response(Buffer.from('89504e470d0a1a0a01020304', 'hex'));
      if (!url.includes('/l/qrconnect')) throw new Error(`Unexpected WeChat URL: ${url}`);
      polls.push(config);
      const next = replies.shift() ?? { status: 408 };
      const signal = config.signal as AbortSignal | undefined;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => resolve(response(`window.wx_errcode=${next.status};window.wx_code='';`)),
          next.delayMs ?? 0,
        );
        signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(signal.reason);
          },
          { once: true },
        );
      });
    }),
    post: jest.fn(),
  }) as unknown as AuthHttpClient;

const startWechat = async (replies: PollReply[], checkBudgetMs?: number) => {
  const polls: AxiosRequestConfig[] = [];
  const service = createQrLoginService({
    http: createBootstrapHttp(),
    createSessionHttp: () => createWechatHttp(replies, polls),
    checkBudgetMs,
    randomBytes: (size) => Buffer.alloc(size, 7),
  });
  const key = await service.createSession('wechat');
  await service.createQr(key);
  return { service, key, polls };
};

describe('WeChat long poll budget', () => {
  it('should give one WeChat check 15 s by default', async () => {
    const budgets: number[] = [];
    const driver: QrChannelDriver = {
      mode: 'pull',
      createQr: async () => ({ identifier: 'pull-uuid', imageUrl: 'data:image/png;base64,AA' }),
      advance: async (_session, budgetMs) => {
        budgets.push(budgetMs);
        return [];
      },
      close: () => undefined,
    };
    const service = createQrLoginService({
      http: createBootstrapHttp(),
      drivers: { wechat: driver },
      randomBytes: (size) => Buffer.alloc(size, 7),
    });
    const key = await service.createSession('wechat');
    await service.createQr(key);
    await service.checkQr(key);

    expect(WECHAT_DEFAULT_POLL_BUDGET_MS).toBe(15_000);
    expect(budgets).toEqual([15_000]);
  });

  it('should still see a scan the upstream only answers after 2 s', async () => {
    const { service, key } = await startWechat([{ status: 404, delayMs: 2000 }]);

    await expect(service.checkQr(key)).resolves.toEqual({
      code: 802,
      message: 'QR code scanned',
    });
  });

  it('should keep Serverless at its own 20 s check budget', () => {
    expect(CHECK_BUDGET_MS).toBe(20_000);
  });
});

describe('WeChat scanned cursor', () => {
  it('should send last=404 only after the scan was seen', async () => {
    const { service, key, polls } = await startWechat([
      { status: 408 },
      { status: 404 },
      { status: 408 },
    ]);

    await service.checkQr(key);
    await service.checkQr(key);
    await expect(service.checkQr(key)).resolves.toMatchObject({ code: 802 });

    expect(polls.map((poll) => dictionaryOf(poll.params).last)).toEqual([
      undefined,
      undefined,
      404,
    ]);
    expect(polls.map((poll) => dictionaryOf(poll.params).uuid)).toEqual([
      'wx-uuid',
      'wx-uuid',
      'wx-uuid',
    ]);
  });

  it('should still finish the login when the held poll answers 405', async () => {
    const { service, key, polls } = await startWechat([{ status: 404 }, { status: 405 }], 2000);
    await service.checkQr(key);
    // 换凭证没有模拟，这里只看第二次轮询带了 last=404、而且 405 被当成授权处理。
    const second = await service.checkQr(key);

    expect(dictionaryOf(polls[1]?.params).last).toBe(404);
    expect(second.code).toBe(800);
    expect(second).toMatchObject({ failureStage: 'credential-payload' });
  });
});

describe('QQ_WECHAT_POLL_BUDGET_MS', () => {
  it.each([
    [undefined, 15_000],
    ['', 15_000],
    ['8000', 8000],
    [' 3000 ', 3000],
    ['1000', 1000],
    ['20000', 20_000],
    ['999', 15_000],
    ['20001', 15_000],
    ['1.5', 15_000],
    ['abc', 15_000],
    ['-1', 15_000],
  ])('should read %p as %p ms', (raw, expected) => {
    expect(wechatPollBudgetMsOf(raw)).toBe(expected);
  });

  it('should be what the Node service uses for WeChat checks', () => {
    const previous = process.env.QQ_WECHAT_POLL_BUDGET_MS;
    process.env.QQ_WECHAT_POLL_BUDGET_MS = '8000';
    const captured: Array<Record<string, unknown>> = [];
    try {
      jest.isolateModules(() => {
        jest.doMock('../src/services/auth/qrLogin', () => {
          const actual = jest.requireActual('../src/services/auth/qrLogin');
          return {
            ...actual,
            createQrLoginService: (dependencies: Record<string, unknown>) => {
              captured.push(dependencies);
              return actual.createQrLoginService(dependencies);
            },
          };
        });
        const { createNodeQrLoginService } = require('../src/services/auth/qrLogin.node');
        createNodeQrLoginService();
      });
    } finally {
      if (previous === undefined) delete process.env.QQ_WECHAT_POLL_BUDGET_MS;
      else process.env.QQ_WECHAT_POLL_BUDGET_MS = previous;
      jest.dontMock('../src/services/auth/qrLogin');
    }

    expect(captured.length).toBeGreaterThan(0);
    for (const dependencies of captured) expect(dependencies.checkBudgetMs).toBe(8000);
  });
});
