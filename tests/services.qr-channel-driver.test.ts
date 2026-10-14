import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import type { AuthHttpClient } from '../src/services/auth/httpClient';
import {
  createMemoryQrSessionRepository,
  createQrLoginService,
  type QrChannelDriver,
  type QrEvent,
  type QrEventListener,
  type QrSessionRecord,
} from '../src/services/auth/qrLogin';
import { logger } from '../src/util/logger';

const QIMEI_16 = 'q'.repeat(36);
const QIMEI_36 = 'r'.repeat(36);

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

/** Answers only the two calls `createSession()` makes before a QR exists. */
const createBootstrapHttp = (): AuthHttpClient =>
  ({
    getCookieHeader: () => '',
    request: jest.fn(),
    post: jest.fn(async (_url: string, payload?: unknown) => {
      if (!dictionaryOf(payload).req_0) {
        return response({
          data: JSON.stringify({ code: 0, data: { q16: QIMEI_16, q36: QIMEI_36 } }),
        });
      }
      return response({
        code: 0,
        req_0: { code: 0, data: { session: { uid: 1234567890, sid: 'session-sid' } } },
      });
    }),
  }) as unknown as AuthHttpClient;

interface PullDriverStub {
  driver: QrChannelDriver;
  budgets: number[];
  queue: Array<QrEvent[] | Error>;
}

const createPullDriverStub = (): PullDriverStub => {
  const budgets: number[] = [];
  const queue: Array<QrEvent[] | Error> = [];
  return {
    budgets,
    queue,
    driver: {
      mode: 'pull',
      createQr: async () => ({ identifier: 'pull-uuid', imageUrl: 'data:image/png;base64,AA' }),
      advance: async (_session, budgetMs) => {
        budgets.push(budgetMs);
        const next = queue.shift();
        if (next instanceof Error) throw next;
        return next ?? [];
      },
      close: () => undefined,
    },
  };
};

interface PushDriverStub {
  driver: QrChannelDriver;
  advances: number;
  closed: boolean;
  emit(event: QrEvent): void;
}

const createPushDriverStub = (): PushDriverStub => {
  const stub: PushDriverStub = {
    advances: 0,
    closed: false,
    emit: () => {
      throw new Error('listener not started');
    },
    driver: {
      mode: 'push',
      createQr: async () => ({ identifier: 'push-id', imageUrl: 'data:image/png;base64,BB' }),
      start: (_session: QrSessionRecord, context): QrEventListener => {
        stub.emit = context.onEvent;
        context.onEvent({ type: 'waiting', payload: null });
        return {
          ready: Promise.resolve(),
          done: new Promise<void>(() => undefined),
          close: () => {
            stub.closed = true;
          },
        };
      },
      advance: async () => {
        stub.advances += 1;
        return [];
      },
      close: () => {
        stub.closed = true;
      },
    },
  };
  return stub;
};

const startSession = async (
  channel: 'qq' | 'wechat',
  driver: QrChannelDriver,
  checkBudgetMs?: number,
) => {
  const service = createQrLoginService({
    http: createBootstrapHttp(),
    drivers: { [channel]: driver },
    checkBudgetMs,
    randomBytes: (size) => Buffer.alloc(size, 7),
  });
  const key = await service.createSession(channel);
  await service.createQr(key);
  return { service, key };
};

describe('QR channel drivers', () => {
  it('should observe a pull channel exactly once per check and never between checks', async () => {
    const pull = createPullDriverStub();
    const { service, key } = await startSession('wechat', pull.driver);

    expect(pull.budgets).toHaveLength(0);
    await expect(service.checkQr(key)).resolves.toMatchObject({ code: 801 });
    expect(pull.budgets).toHaveLength(1);

    // Nothing runs between checks: a closed dialog stops polling instead of holding a loop open
    // for the rest of the QR's life.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(pull.budgets).toHaveLength(1);

    await service.checkQr(key);
    expect(pull.budgets).toHaveLength(2);
  });

  it('should pass the configured budget to a pull driver and let a caller override it', async () => {
    const pull = createPullDriverStub();
    const { service, key } = await startSession('wechat', pull.driver, 2500);

    await service.checkQr(key);
    await service.checkQr(key, 9000);

    expect(pull.budgets).toEqual([2500, 9000]);
  });

  it('should keep waiting while a pull driver reports no change', async () => {
    const pull = createPullDriverStub();
    const { service, key } = await startSession('wechat', pull.driver);

    // An elapsed long-poll budget is "nothing happened", not a failure.
    pull.queue.push([]);

    await expect(service.checkQr(key)).resolves.toMatchObject({
      code: 801,
      message: 'Waiting for QR scan',
    });
  });

  it('should tolerate a run of pull failures before failing the session', async () => {
    const pull = createPullDriverStub();
    const { service, key } = await startSession('wechat', pull.driver);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      pull.queue.push(new Error('dropped long poll'));
      await expect(service.checkQr(key)).resolves.toMatchObject({ code: 801 });
    }

    pull.queue.push(new Error('dropped long poll'));
    const failed = await service.checkQr(key);

    expect(failed.code).toBe(800);
    expect(failed.message).toBe('QR login failed');
    expect(failed.retryAfterMs).toBeGreaterThan(0);
  });

  it('should move a pull channel through scanned to confirmed', async () => {
    const pull = createPullDriverStub();
    const { service, key } = await startSession('wechat', pull.driver);

    pull.queue.push([{ type: 'scanned', payload: null }]);
    await expect(service.checkQr(key)).resolves.toMatchObject({ code: 802 });

    pull.queue.push([{ type: 'timeout', payload: null }]);
    await expect(service.checkQr(key)).resolves.toMatchObject({ code: 800 });
  });

  it('should retain a scanned WeChat QR when a later event says waiting', async () => {
    const pull = createPullDriverStub();
    const { service, key } = await startSession('wechat', pull.driver);
    pull.queue.push([{ type: 'scanned', payload: null }]);
    await expect(service.checkQr(key)).resolves.toEqual({ code: 802, message: 'QR code scanned' });
    pull.queue.push([{ type: 'waiting', payload: null }]);
    await expect(service.checkQr(key)).resolves.toEqual({ code: 802, message: 'QR code scanned' });
    // Preserving progress must not hide a real cancellation or change the keyed cancel API.
    service.cancelSession(key);
    await expect(service.checkQr(key)).resolves.toEqual({ code: 800, message: 'QR code expired' });
  });

  it('should retain WeChat progress when scanned and waiting arrive in the same check', async () => {
    const pull = createPullDriverStub();
    const { service, key } = await startSession('wechat', pull.driver);
    pull.queue.push([
      { type: 'scanned', payload: null },
      { type: 'waiting', payload: null },
    ]);
    await expect(service.checkQr(key)).resolves.toEqual({ code: 802, message: 'QR code scanned' });
  });

  it('should retain an exchanging WeChat QR when a late event says waiting', async () => {
    const pull = createPullDriverStub();
    const record: QrSessionRecord = {
      key: 'fixture-exchanging-key',
      channel: 'wechat',
      state: 'exchanging',
      identifier: 'fixture-uuid',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    };
    const service = createQrLoginService({
      drivers: { wechat: pull.driver },
      qrSessionRepository: createMemoryQrSessionRepository([record]),
    });
    pull.queue.push([{ type: 'waiting', payload: null }]);
    await expect(service.checkQr(record.key)).resolves.toEqual({
      code: 802,
      message: 'QR code scanned',
    });
  });

  it('should preserve QQ listener waiting events after a scan', async () => {
    const push = createPushDriverStub();
    const { service, key } = await startSession('qq', push.driver);
    push.emit({ type: 'scanned', payload: null });
    await expect(service.checkQr(key)).resolves.toMatchObject({ code: 802 });
    push.emit({ type: 'waiting', payload: null });
    await expect(service.checkQr(key)).resolves.toEqual({
      code: 801,
      message: 'Waiting for QR scan',
    });
  });

  it('should never poll a push channel and should drive it from its listener', async () => {
    const push = createPushDriverStub();
    const { service, key } = await startSession('qq', push.driver);

    await expect(service.checkQr(key)).resolves.toMatchObject({ code: 801 });
    expect(push.advances).toBe(0);

    push.emit({ type: 'scanned', payload: null });
    await expect(service.checkQr(key)).resolves.toMatchObject({ code: 802 });
    expect(push.advances).toBe(0);
  });

  it('should back off an expired scannable code but not an abandoned key', async () => {
    let current = 1_000_000;
    const now = () => current;
    const build = async (channel: 'wechat', driver: QrChannelDriver, createCode: boolean) => {
      const service = createQrLoginService({
        http: createBootstrapHttp(),
        drivers: { [channel]: driver },
        now,
        randomBytes: (size) => Buffer.alloc(size, 7),
      });
      const key = await service.createSession(channel);
      if (createCode) await service.createQr(key);
      return service;
    };

    // A key issued and abandoned before `createQr` never had anything to scan, and the
    // pre-driver implementation never started a listener for it either.
    const abandoned = await build('wechat', createPullDriverStub().driver, false);
    current += 3 * 60 * 1000 + 1;
    await expect(abandoned.createSession('wechat')).resolves.toEqual(expect.any(String));

    // A code that was displayed and then left to expire keeps counting as a failure, which is
    // what the App channel's `timeout` event has always done.
    current = 1_000_000;
    const expired = await build('wechat', createPullDriverStub().driver, true);
    current += 3 * 60 * 1000 + 1;
    const error = await expired.createSession('wechat').catch((reason: unknown) => reason);

    expect(error).toEqual(expect.objectContaining({ httpStatus: 429 }));
  });

  it('should close a push listener when the session is cancelled', async () => {
    const push = createPushDriverStub();
    const { service, key } = await startSession('qq', push.driver);

    expect(push.closed).toBe(false);
    service.cancelSession(key);

    expect(push.closed).toBe(true);
    await expect(service.checkQr(key)).resolves.toMatchObject({ code: 800 });
  });
});

describe('WeChat pull driver long-poll semantics', () => {
  const createWechatHttp = (onPoll: () => Promise<AxiosResponse<string>>): AuthHttpClient =>
    ({
      getCookieHeader: () => '',
      request: jest.fn(async (config: AxiosRequestConfig) => {
        const url = String(config.url);
        if (url === 'https://open.weixin.qq.com/connect/qrconnect') {
          return response(
            '<a href="https://open.weixin.qq.com/connect/confirm?uuid=wx-uuid">x</a>',
          );
        }
        if (url.includes('/connect/qrcode/'))
          return response(Buffer.from('89504e470d0a1a0a01020304', 'hex'));
        if (url.includes('/l/qrconnect')) return onPoll();
        throw new Error(`Unexpected WeChat URL: ${url}`);
      }),
      post: jest.fn(),
    }) as unknown as AuthHttpClient;

  it('should report an elapsed poll budget as "still waiting"', async () => {
    let polls = 0;
    const service = createQrLoginService({
      http: createBootstrapHttp(),
      createSessionHttp: () =>
        createWechatHttp(async () => {
          polls += 1;
          // What `AbortSignal.timeout` produces once the budget elapses.
          const aborted = new Error('timeout');
          aborted.name = 'TimeoutError';
          throw aborted;
        }),
      randomBytes: (size) => Buffer.alloc(size, 7),
    });
    const key = await service.createSession('wechat');
    await service.createQr(key);

    await expect(service.checkQr(key)).resolves.toMatchObject({ code: 801 });
    await expect(service.checkQr(key)).resolves.toMatchObject({ code: 801 });
    expect(polls).toBe(2);
  });

  it('should retain scanned progress through real 404, 408 and budget-expiry responses', async () => {
    const queue: Array<number | Error> = [
      404,
      408,
      Object.assign(new Error('timeout'), { name: 'TimeoutError' }),
    ];
    const service = createQrLoginService({
      http: createBootstrapHttp(),
      createSessionHttp: () =>
        createWechatHttp(async () => {
          const next = queue.shift();
          if (next instanceof Error) throw next;
          return response(`window.wx_errcode=${next};window.wx_code='';`);
        }),
    });
    const key = await service.createSession('wechat');
    await service.createQr(key);
    for (let check = 0; check < 3; check += 1) {
      await expect(service.checkQr(key)).resolves.toEqual({
        code: 802,
        message: 'QR code scanned',
      });
    }
  });

  it('should log allowlisted poll evidence and the retained API state without secrets', async () => {
    const info = jest.spyOn(logger, 'info').mockImplementation(() => undefined);
    const record: QrSessionRecord = {
      key: 'private-qr-key',
      channel: 'wechat',
      state: 'waiting',
      identifier: 'private-uuid',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    };
    const queue: Array<number | Error | string> = [
      404,
      408,
      Object.assign(new Error('private-error-body'), { name: 'TimeoutError' }),
      Object.assign(new Error('private-cookie=private-token'), {
        response: { status: 503, data: 'private-body' },
      }),
      'private-malformed-body',
    ];
    const service = createQrLoginService({
      createSessionHttp: () =>
        ({
          getCookieHeader: () => 'private-cookie',
          post: jest.fn(),
          request: async () => {
            const next = queue.shift();
            if (next instanceof Error) throw next;
            return response(
              typeof next === 'string'
                ? next
                : `window.wx_errcode=${next};window.wx_code='private-oauth-code';`,
            );
          },
        }) as unknown as AuthHttpClient,
      qrSessionRepository: createMemoryQrSessionRepository([record]),
    });
    try {
      for (let check = 0; check < 5; check += 1) await service.checkQr(record.key);
      const evidence = info.mock.calls.filter(([name]) =>
        String(name).startsWith('qq-auth.wechat-'),
      );
      const polls = evidence
        .filter(([name]) => name === 'qq-auth.wechat-poll')
        .map(([, fields]) => fields);
      expect(polls).toEqual([
        expect.objectContaining({ outcome: 'status', upstreamCode: 404 }),
        expect.objectContaining({ outcome: 'status', upstreamCode: 408 }),
        expect.objectContaining({ outcome: 'budget-expired' }),
        expect.objectContaining({
          outcome: 'error',
          upstreamHttpStatus: 503,
          failureReason: 'upstream-http-error',
        }),
        expect.objectContaining({ outcome: 'error', failureReason: 'upstream-rejected' }),
      ]);
      const checks = evidence
        .filter(([name]) => name === 'qq-auth.wechat-qr-check')
        .map(([, fields]) => fields);
      expect(checks).toHaveLength(5);
      expect(checks).toEqual(
        Array.from({ length: 5 }, () =>
          expect.objectContaining({ apiCode: 802, state: 'scanned', sessionMode: 'stored' }),
        ),
      );
      expect(evidence).toContainEqual([
        'qq-auth.wechat-qr-state',
        expect.objectContaining({
          eventType: 'waiting',
          previousState: 'scanned',
          state: 'scanned',
          ignored: true,
        }),
      ]);
      const attempts = new Set(
        evidence.map(([, fields]) => (fields as { attemptId: number }).attemptId),
      );
      expect(attempts.size).toBe(1);
      expect([...attempts][0]).toEqual(expect.any(Number));
      const allowed = new Set([
        'attemptId',
        'loginChannel',
        'outcome',
        'durationMs',
        'budgetMs',
        'upstreamCode',
        'upstreamHttpStatus',
        'failureReason',
        'eventType',
        'previousState',
        'state',
        'ignored',
        'apiCode',
        'sessionMode',
        'failureStage',
        'pollErrors',
      ]);
      for (const [, fields] of evidence) {
        expect(Object.keys(fields as object).every((key) => allowed.has(key))).toBe(true);
      }
      expect(JSON.stringify(evidence)).not.toContain('private-');
    } finally {
      info.mockRestore();
    }
  });
});
