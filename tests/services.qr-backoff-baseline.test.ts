import type { AxiosResponse } from 'axios';
import { createMemoryDeviceContextRepository } from '../src/services/auth/deviceContext';
import type { AuthHttpClient } from '../src/services/auth/httpClient';
import {
  createQrLoginService,
  QqProtocolError,
  type QrChannelDriver,
  type QrEvent,
  QrLoginServiceError,
} from '../src/services/auth/qrLogin';
import { logger } from '../src/util/logger';
import deviceFixture from './fixtures/contracts/device-v1.json';
import { CONTRACT_CREDENTIAL, CONTRACT_NOW } from './helpers/contractUpstream';

const response = (data: unknown) =>
  ({ data, status: 200, statusText: 'OK', headers: {}, config: { headers: {} } }) as AxiosResponse;

const harness = (expiresIn = 180) => {
  let current = CONTRACT_NOW;
  let keySequence = 0;
  let bootstrapFailure: unknown;
  let createFailure: unknown;
  const listeners: Array<{
    emit: (event: QrEvent) => void;
    reject: (error: Error) => void;
    close: jest.Mock;
    ttl: number;
  }> = [];
  const post = jest.fn(async (_url: string, raw: unknown) => {
    const payload = raw as { req_0?: { method?: string } };
    if (payload.req_0?.method === 'GetSession') {
      if (bootstrapFailure) throw bootstrapFailure;
      return response({
        code: 0,
        req_0: { code: 0, data: { session: { uid: 'fixture-uid', sid: 'fixture-sid' } } },
      });
    }
    if (payload.req_0?.method === 'Login')
      return response({ code: 0, req_0: { code: 0, data: CONTRACT_CREDENTIAL } });
    throw new Error('Unstubbed baseline request');
  });
  const driver: QrChannelDriver = {
    mode: 'push',
    createQr: async () => {
      if (createFailure) throw createFailure;
      return { identifier: 'fixture-qr', imageUrl: 'data:image/png;base64,AA', expiresIn };
    },
    start: (_session, context) => {
      let reject!: (error: Error) => void;
      const done = new Promise<void>((_resolve, rejected) => {
        reject = rejected;
      });
      const close = jest.fn(() => reject(new Error('MQTT WebSocket closed')));
      listeners.push({ emit: context.onEvent, reject, close, ttl: context.timeoutMs });
      context.onEvent({ type: 'waiting', payload: null });
      return { ready: Promise.resolve(), done, close };
    },
    advance: async () => [],
    close: () => undefined,
  };
  const service = createQrLoginService({
    http: { post, request: jest.fn(), getCookieHeader: () => '' } as unknown as AuthHttpClient,
    deviceRepository: createMemoryDeviceContextRepository(deviceFixture.device),
    drivers: { qq: driver },
    now: () => current,
    randomBytes: (size) => Buffer.alloc(size, ++keySequence),
  });
  return {
    service,
    listeners,
    post,
    advance: (ms: number) => {
      current += ms;
    },
    failBootstrap: (error: unknown) => {
      bootstrapFailure = error;
    },
    failCreate: (error: unknown) => {
      createFailure = error;
    },
    start: async (createCode = true) => {
      const key = await service.createSession('qq');
      if (createCode) await service.createQr(key);
      return key;
    },
  };
};

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const errorOf = async (operation: Promise<unknown>): Promise<QrLoginServiceError> => {
  const error = await operation.catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(QrLoginServiceError);
  return error as QrLoginServiceError;
};

describe('QR cooldown boundaries', () => {
  beforeEach(() => {
    for (const level of ['debug', 'info', 'warn', 'error'] as const)
      jest.spyOn(logger, level).mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('does not count dialog close, repeated cancel or a late listener rejection as a failure', async () => {
    const h = harness();
    const key = await h.start();
    h.service.cancelSession(key);
    h.service.cancelSession(key);
    await flush();
    expect(h.listeners[0].close).toHaveBeenCalledTimes(1);
    expect(await h.service.checkQr(key)).toEqual({ code: 800, message: 'QR code expired' });
    await expect(h.start()).resolves.not.toBe(key);
  });

  it.each([
    'created',
    'waiting',
  ] as const)('preempts a %s QR without cooldown and ignores its late callbacks', async (state) => {
    const h = harness();
    const oldKey = await h.start(state === 'waiting');
    const newKey = await h.start();
    if (state === 'waiting') {
      for (const type of ['scanned', 'timeout', 'cookies'])
        h.listeners[0].emit({ type, payload: null });
    }
    await flush();
    expect(await h.service.checkQr(oldKey)).toEqual({ code: 800, message: 'QR code expired' });
    expect(await h.service.checkQr(newKey)).toMatchObject({ code: 801 });
    await expect(h.start()).resolves.not.toBe(newKey);
  });

  it('keeps scanned sessions busy until keyed cancellation releases them', async () => {
    const h = harness();
    const key = await h.start();
    h.listeners[0].emit({ type: 'scanned', payload: null });
    expect(await errorOf(h.service.createSession())).toMatchObject({
      httpStatus: 409,
      diagnostics: { failureReason: 'session-busy' },
    });
    h.service.cancelSession('unknown-key');
    expect((await errorOf(h.service.createSession())).httpStatus).toBe(409);
    h.service.cancelSession(key);
    await flush();
    await expect(h.start()).resolves.not.toBe(key);
  });

  it.each([
    'canceled',
    'timeout',
    'loginFailed',
  ] as const)('counts mobile %s once and keeps the next distinct failure at fifteen seconds', async (type) => {
    const h = harness();
    const key = await h.start();
    const event = { type, payload: null };
    h.listeners[0].emit(event);
    h.listeners[0].emit(event);
    h.listeners[0].reject(new Error('MQTT WebSocket error'));
    await flush();
    const failureReason = {
      canceled: 'user-canceled',
      timeout: 'qr-timeout',
      loginFailed: 'login-rejected',
    }[type];
    expect(await h.service.checkQr(key)).toMatchObject({
      code: 800,
      failureReason,
      retryAfterMs: 15000,
    });
    expect(await h.service.checkQr(key)).toMatchObject({ retryAfterMs: 15000 });
    expect(await errorOf(h.service.createSession())).toMatchObject({
      httpStatus: 429,
      retryAfterMs: 15000,
      diagnostics: { lastFailure: { failureReason } },
    });
    h.advance(15000);
    await h.start();
    h.listeners[1].emit(event);
    expect((await errorOf(h.service.createSession())).retryAfterMs).toBe(15000);
  });

  it('does not count repeated create attempts on the same failed session twice', async () => {
    const h = harness();
    const key = await h.start(false);
    h.failCreate(new Error('MQTT WebSocket error'));
    expect((await errorOf(h.service.createQr(key))).retryAfterMs).toBe(15000);
    expect((await errorOf(h.service.createQr(key))).httpStatus).toBe(409);
    expect((await errorOf(h.service.createSession())).retryAfterMs).toBe(15000);
  });

  it.each([
    [429, 30000],
    [503, 15000],
  ])('keeps bootstrap HTTP %i as 502 followed by local 429 for %i ms', async (status, cooldown) => {
    const h = harness();
    h.failBootstrap(Object.assign(new Error('Fixture HTTP failure'), { response: { status } }));
    const first = await errorOf(h.service.createSession());
    expect(first).toMatchObject({
      httpStatus: 502,
      retryAfterMs: cooldown,
      diagnostics: {
        failureStage: 'session-bootstrap',
        upstreamHttpStatus: status,
        failureReason: 'upstream-http-error',
      },
    });
    const calls = h.post.mock.calls.length;
    for (let index = 0; index < 3; index++) {
      h.advance(501);
      const retry = await errorOf(h.service.createSession());
      expect(retry).toMatchObject({
        httpStatus: 429,
        retryAfterMs: cooldown - 501 * (index + 1),
        diagnostics: { failureReason: 'local-backoff', lastFailure: first.diagnostics },
      });
      expect(h.post).toHaveBeenCalledTimes(calls);
    }
  });

  it('resets both the failure count and lastFailure after successful confirmation', async () => {
    const h = harness();
    await h.start();
    h.listeners[0].emit({ type: 'loginFailed', payload: null });
    h.advance(15000);
    const successful = await h.start();
    h.listeners[1].emit({
      type: 'cookies',
      payload: {
        cookies: { qqmusic_uin: { value: '10000' }, qqmusic_key: { value: 'fixture-exchange' } },
      },
    });
    await flush();
    expect(await h.service.checkQr(successful)).toMatchObject({ code: 803 });
    h.service.cancelSession(successful);
    expect(await h.service.checkQr(successful)).toMatchObject({ code: 803 });
    await h.start();
    h.listeners[2].emit({ type: 'canceled', payload: null });
    expect(await errorOf(h.service.createSession())).toMatchObject({
      retryAfterMs: 15000,
      diagnostics: { lastFailure: { failureReason: 'user-canceled' } },
    });
  });

  it('cancels just before TTL without failure even when the old callback arrives after TTL', async () => {
    const h = harness();
    const key = await h.start();
    h.advance(179999);
    h.service.cancelSession(key);
    h.advance(2);
    h.listeners[0].emit({ type: 'timeout', payload: null });
    await flush();
    await expect(h.start()).resolves.not.toBe(key);
  });

  it.each([
    false,
    true,
  ])('counts natural TTL expiration only if a scannable code existed: %s', async (createCode) => {
    const h = harness();
    const key = await h.start(createCode);
    h.advance(180000);
    expect(await h.service.checkQr(key)).toEqual({ code: 800, message: 'QR code expired' });
    await flush();
    if (createCode) {
      expect(await errorOf(h.service.createSession())).toMatchObject({
        retryAfterMs: 15000,
        diagnostics: { lastFailure: { failureReason: 'qr-timeout' } },
      });
      h.advance(15000);
    }
    await expect(h.start()).resolves.not.toBe(key);
  });

  it.each([
    [2, 2000],
    [600, 180000],
  ])('converts expiresIn %i seconds into a bounded listener TTL of %i ms', async (seconds, ttl) => {
    const h = harness(seconds);
    const key = await h.start();
    expect(h.listeners[0].ttl).toBe(ttl);
    h.advance(ttl - 1);
    expect(await h.service.checkQr(key)).toMatchObject({ code: 801 });
    h.advance(1);
    expect(await h.service.checkQr(key)).toEqual({ code: 800, message: 'QR code expired' });
  });

  it('keeps successive failures at fifteen seconds instead of doubling them', async () => {
    const h = harness();
    for (let attempt = 0; attempt < 7; attempt++) {
      await h.start();
      h.listeners.at(-1)?.emit({ type: 'loginFailed', payload: null });
      expect((await errorOf(h.service.createSession())).retryAfterMs).toBe(15000);
      h.advance(15000);
    }
  });

  it('cools down for thirty seconds when the upstream says logins are too frequent', async () => {
    const h = harness();
    h.failBootstrap(new QqProtocolError('GetSession', 104604, 0, 200));
    expect(await errorOf(h.service.createSession())).toMatchObject({
      httpStatus: 502,
      retryAfterMs: 30000,
      diagnostics: { failureReason: 'upstream-rejected', upstreamCode: 104604 },
    });
    h.advance(29999);
    expect(await errorOf(h.service.createSession())).toMatchObject({
      httpStatus: 429,
      retryAfterMs: 1,
    });
    h.failBootstrap(undefined);
    h.advance(1);
    await h.start();
    h.listeners[0].emit({ type: 'canceled', payload: null });
    expect((await errorOf(h.service.createSession())).retryAfterMs).toBe(15000);
  });
});
