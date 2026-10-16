import path from 'node:path';
import { createMusicuClient, type MusicuDescriptor } from '../src/protocol/musicu';
import { createFetchTransport } from '../src/transport/fetch';
import { type HttpRequest, type HttpTransport, HttpTransportError } from '../src/transport/http';
import { createTokenBucket } from '../src/transport/tokenBucket';
import { inspectRuntimeClosure } from './helpers/runtimeClosure';

const descriptor = (overrides: Partial<MusicuDescriptor> = {}): MusicuDescriptor => ({
  module: 'fixture.catalog',
  method: 'Read',
  param: { id: 'synthetic-id' },
  readOnly: true,
  operation: 'playlist.authenticated-detail',
  ...overrides,
});
const envelope = (data: unknown = { songs: [] }) => ({ code: 0, req_0: { code: 0, data } });
const response = (body: unknown = envelope(), status = 200) => ({ status, body });
const client = (http: HttpTransport, options = {}) =>
  createMusicuClient({
    http,
    comm: { platform: 'fixture' },
    ...options,
  });
const caught = async (task: Promise<unknown>) => {
  try {
    await task;
    throw new Error('Expected rejection');
  } catch (error) {
    if (!(error instanceof Error) || error.message === 'Expected rejection') throw error;
    return error;
  }
};

describe('musicu request and response contracts', () => {
  it('merges explicit descriptors into one numbered envelope, preserving order and context', async () => {
    const http = jest.fn(async (_request: HttpRequest) =>
      response({
        code: 0,
        req_0: { code: 0, data: { first: true } },
        req_1: { code: 0, data: [2] },
      }),
    );
    const api = client(http, { headers: { Cookie: 'fixture=one' } });
    expect(await api.executeBatch([descriptor(), descriptor({ method: 'Second' })])).toEqual([
      { ok: true, code: 0, data: { first: true } },
      { ok: true, code: 0, data: [2] },
    ]);
    expect(http).toHaveBeenCalledTimes(1);
    expect(JSON.parse(http.mock.calls[0][0].body)).toEqual({
      comm: { platform: 'fixture' },
      req_0: { module: 'fixture.catalog', method: 'Read', param: { id: 'synthetic-id' } },
      req_1: { module: 'fixture.catalog', method: 'Second', param: { id: 'synthetic-id' } },
    });
    expect(http.mock.calls[0][0].headers.Cookie).toBe('fixture=one');
  });

  it('snapshots context and descriptors before waiting, never sharing accounts or mutable input', async () => {
    const comm = { account: 'fake-one' },
      headers = { Cookie: 'fixture=one' };
    const request = descriptor();
    const requests: HttpRequest[] = [];
    const api = createMusicuClient({
      comm,
      headers,
      http: async (r: HttpRequest) => {
        requests.push(r);
        return response();
      },
    });
    comm.account = 'fake-two';
    headers.Cookie = 'fixture=two';
    const pending = api.execute(request);
    request.param.id = 'changed';
    await pending;
    expect(JSON.parse(requests[0].body)).toMatchObject({
      comm: { account: 'fake-one' },
      req_0: { param: { id: 'synthetic-id' } },
    });
    expect(requests[0].headers.Cookie).toBe('fixture=one');
    const other = createMusicuClient({
      comm,
      headers,
      http: async (r: HttpRequest) => {
        requests.push(r);
        return response();
      },
    });
    await other.execute(descriptor());
    expect(requests[1].headers.Cookie).toBe('fixture=two');
  });

  it('preserves partial successes and scopes each business error independently', async () => {
    const api = client(async () =>
      response({
        code: 0,
        req_0: { code: 0, data: [] },
        req_1: { code: 10004 },
        req_2: { code: 20279 },
      }),
    );
    const results = await api.executeBatch([
      descriptor(),
      descriptor(),
      descriptor({ operation: 'login.wechat.credential-exchange' }),
    ]);
    expect(results[0]).toEqual({ ok: true, code: 0, data: [] });
    expect(results[1]).toMatchObject({
      ok: false,
      error: { kind: 'not-found', upstreamCode: 10004 },
    });
    expect(results[2]).toMatchObject({
      ok: false,
      error: { kind: 'device-limit', upstreamCode: 20279 },
    });
  });

  it('allows only explicitly approved nonzero business codes', async () => {
    const http = jest.fn(async (_request: HttpRequest) =>
      response({ code: 0, req_0: { code: 80092, data: { applied: true } } }),
    );
    expect(
      await client(http).execute(
        descriptor({ operation: 'playlist.add-songs', readOnly: false, allowedCodes: [80092] }),
      ),
    ).toEqual({ applied: true });
    expect(
      await caught(
        client(http).execute(descriptor({ operation: 'playlist.add-songs', readOnly: false })),
      ),
    ).toMatchObject({
      kind: 'upstream-business',
      upstreamCode: 80092,
      retryable: false,
    });
  });

  it.each([
    undefined,
    null,
    [],
    {},
    { code: '0' },
    { code: 0.5 },
    { code: 0, req_0: {} },
    { code: 0, req_0: { code: '0', data: [] } },
    { code: 0, req_0: { code: 0 } },
    { code: 0, req_0: { code: 0, data: [], subcode: 'bad' } },
  ])('rejects malformed envelopes rather than inventing an empty success: %j', async (body) => {
    const http = jest.fn(async (_request: HttpRequest) => ({ status: 200, body }));
    expect(await caught(client(http).execute(descriptor()))).toMatchObject({
      kind: 'invalid-response',
      retryable: false,
    });
    expect(http).toHaveBeenCalledTimes(1);
  });

  it('makes gateway rejection win over credential codes and allowed business codes', async () => {
    expect(
      await caught(
        client(async () => response({ code: 500003, req_0: { code: 1000, data: {} } })).execute(
          descriptor({ allowedCodes: [1000] }),
        ),
      ),
    ).toMatchObject({ kind: 'upstream-gateway', upstreamGlobalCode: 500003 });
  });

  it('uses optional data validation and sanitizes thrown decoder errors', async () => {
    expect(
      await client(async () => response(envelope({ value: 3 }))).execute(
        descriptor({ decode: (data: unknown) => (data as { value: number }).value }),
      ),
    ).toBe(3);
    const error = await caught(
      client(async () => response()).execute(
        descriptor({
          decode: () => {
            throw new Error('SECRET_COOKIE');
          },
        }),
      ),
    );
    expect(error).toMatchObject({ kind: 'invalid-response' });
    expect(JSON.stringify(error)).not.toContain('SECRET_COOKIE');
  });

  it.each([
    { module: '' },
    { method: '' },
    { param: [] },
    { param: { bad: Number.NaN } },
    { param: { bad: undefined } },
    { allowedCodes: [1.5] },
    { readOnly: undefined },
  ])('rejects invalid descriptors before issuing any request: %j', async (overrides) => {
    const http = jest.fn(async (_request: HttpRequest) => response());
    expect(
      await caught(client(http).execute(descriptor(overrides as Partial<MusicuDescriptor>))),
    ).toMatchObject({ kind: 'input' });
    expect(http).not.toHaveBeenCalled();
  });

  it('accepts an empty batch without consuming a token or sending a request', async () => {
    const http = jest.fn(async (_request: HttpRequest) => response());
    expect(await client(http).executeBatch([])).toEqual([]);
    expect(http).not.toHaveBeenCalled();
  });
});

describe('transport scheduling, deadlines and retries', () => {
  beforeEach(() => jest.useFakeTimers({ now: 0 }));
  afterEach(() => jest.useRealTimers());

  it('allows the default burst of 50 and refills at ten HTTP requests per second', async () => {
    const http = jest.fn(async (_request: HttpRequest) => response());
    const api = client(http, { limiter: createTokenBucket() });
    const tasks = Array.from({ length: 52 }, () => api.execute(descriptor()));
    await jest.advanceTimersByTimeAsync(0);
    expect(http).toHaveBeenCalledTimes(50);
    await jest.advanceTimersByTimeAsync(99);
    expect(http).toHaveBeenCalledTimes(50);
    await jest.advanceTimersByTimeAsync(1);
    expect(http).toHaveBeenCalledTimes(51);
    await jest.advanceTimersByTimeAsync(100);
    expect(http).toHaveBeenCalledTimes(52);
    await Promise.all(tasks);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('shares an explicitly supplied limiter across clients, not their request credentials', async () => {
    const limiter = createTokenBucket({ ratePerSecond: 2, burst: 1 });
    const http = jest.fn(async (_request: HttpRequest) => response());
    const a = client(http, { limiter }),
      b = client(http, { limiter });
    const tasks = [a.execute(descriptor()), b.execute(descriptor())];
    await jest.advanceTimersByTimeAsync(499);
    expect(http).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await Promise.all(tasks);
    expect(http).toHaveBeenCalledTimes(2);
  });

  it.each([
    'connect',
    'http',
  ])('retries a readonly %s failure twice with bounded exponential jitter', async (failure) => {
    const http = jest.fn(async (_request: HttpRequest) => {
      if (failure === 'connect')
        throw new HttpTransportError({ code: 'ECONNREFUSED', phase: 'connect' });
      return response({ code: 1000 }, 503);
    });
    const task = caught(
      client(http, { random: () => 0.5, limiter: createTokenBucket() }).execute(descriptor()),
    );
    await jest.advanceTimersByTimeAsync(299);
    expect(http).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(http).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(599);
    expect(http).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1);
    expect(http).toHaveBeenCalledTimes(3);
    expect(await task).toMatchObject({
      kind: failure === 'connect' ? 'network' : 'upstream-http',
      retryable: true,
    });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('returns a successful retry using the same immutable request snapshot', async () => {
    const http = jest
      .fn<ReturnType<HttpTransport>, [HttpRequest]>()
      .mockResolvedValueOnce(response({}, 500))
      .mockResolvedValueOnce(response(envelope({ value: true })));
    const task = client(http, { random: () => 0 }).execute(descriptor());
    await jest.advanceTimersByTimeAsync(200);
    expect(await task).toEqual({ value: true });
    expect(http.mock.calls[0][0].body).toBe(http.mock.calls[1][0].body);
  });

  it.each([
    'write',
    'mixed',
    'read-timeout',
    'unknown-reset',
    'business',
    'gateway',
    '429',
    'http404',
    'raw-error',
  ])('does not retry %s failures', async (mode) => {
    const http = jest.fn(async (_request: HttpRequest) => {
      if (mode === 'read-timeout')
        throw new HttpTransportError({ code: 'ETIMEDOUT', phase: 'read' });
      if (mode === 'unknown-reset')
        throw new HttpTransportError({ code: 'ECONNRESET', phase: 'unknown' });
      if (mode === 'raw-error') throw { code: 'ECONNREFUSED', message: 'SECRET_COOKIE' };
      if (mode === 'business') return response({ code: 0, req_0: { code: 2001 } });
      if (mode === 'gateway') return response({ code: 500003 });
      return response({}, mode === '429' ? 429 : mode === 'http404' ? 404 : 503);
    });
    const api = client(http, { limiter: createTokenBucket() });
    const task = caught(
      mode === 'mixed'
        ? api.executeBatch([descriptor(), descriptor({ readOnly: false })])
        : api.execute(descriptor({ readOnly: mode !== 'write' })),
    );
    await jest.advanceTimersByTimeAsync(1000);
    expect(await task).toMatchObject({ retryable: false });
    expect(http).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(await task)).not.toContain('SECRET_COOKIE');
  });

  it('charges retries to the same token bucket', async () => {
    const http = jest
      .fn<ReturnType<HttpTransport>, [HttpRequest]>()
      .mockResolvedValueOnce(response({}, 503))
      .mockResolvedValue(response());
    const task = client(http, {
      random: () => 0,
      limiter: createTokenBucket({ ratePerSecond: 1, burst: 1 }),
    }).execute(descriptor());
    await jest.advanceTimersByTimeAsync(999);
    expect(http).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await task;
    expect(http).toHaveBeenCalledTimes(2);
  });

  it.each([
    'queue',
    'request',
    'backoff',
  ])('enforces one deadline including %s and prevents late retries', async (stage) => {
    const limiter = createTokenBucket({ ratePerSecond: 1, burst: 1 });
    if (stage === 'queue') await limiter.acquire(new AbortController().signal);
    const http = jest.fn(async (_request: HttpRequest) =>
      stage === 'request' ? new Promise<never>(() => {}) : response({}, 503),
    );
    const task = caught(
      client(http, { limiter, timeoutMs: 150, random: () => 0 }).execute(descriptor()),
    );
    await jest.advanceTimersByTimeAsync(150);
    expect(await task).toMatchObject({ errorKey: 'network.timeout', retryable: false });
    expect(http).toHaveBeenCalledTimes(stage === 'queue' ? 0 : 1);
    if (stage !== 'queue') expect(http.mock.calls[0][0].signal.aborted).toBe(true);
    await jest.advanceTimersByTimeAsync(2000);
    expect(http).toHaveBeenCalledTimes(stage === 'queue' ? 0 : 1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each([
    'before',
    'queue',
    'request',
    'backoff',
  ])('honors caller cancellation at %s without retries', async (stage) => {
    const controller = new AbortController(),
      limiter = createTokenBucket({ ratePerSecond: 1, burst: 1 });
    if (stage === 'queue') await limiter.acquire(new AbortController().signal);
    if (stage === 'before') controller.abort('SECRET_REASON');
    const http = jest.fn(async (_request: HttpRequest) =>
      stage === 'request' ? new Promise<never>(() => {}) : response({}, 503),
    );
    const task = caught(
      client(http, { limiter }).execute(descriptor(), { signal: controller.signal }),
    );
    await jest.advanceTimersByTimeAsync(0);
    controller.abort('SECRET_REASON');
    expect(await task).toMatchObject({ errorKey: 'network.aborted', retryable: false });
    await jest.advanceTimersByTimeAsync(1000);
    expect(http).toHaveBeenCalledTimes(['before', 'queue'].includes(stage) ? 0 : 1);
    expect(JSON.stringify(await task)).not.toContain('SECRET_REASON');
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each([
    { timeoutMs: 0 },
    { timeoutMs: Infinity },
    { maxRetries: 3 },
    { maxRetries: -1 },
  ])('rejects invalid scheduling options: %j', (options) => {
    expect(() => client(async () => response(), options)).toThrow();
  });
  it.each([
    { ratePerSecond: 0 },
    { ratePerSecond: Infinity },
    { burst: 0 },
    { burst: 1.5 },
  ])('rejects invalid bucket options: %j', (options) => {
    expect(() => createTokenBucket(options)).toThrow();
  });
});

describe('shared native fetch adapter for Node and Web hosts', () => {
  it('pins JSON POST, refuses redirects and keeps response cookies local to each adapter', async () => {
    const fetcher = jest.fn(
      async (
        _url: string,
        _init: { method: string; redirect: string; headers: Record<string, string> },
      ) => ({
        status: 200,
        headers: new Headers({ 'set-cookie': 'fixture=next; Path=/' }),
        text: async () => JSON.stringify(envelope()),
      }),
    );
    const http = createFetchTransport(fetcher);
    await client(http).execute(descriptor());
    await client(http).execute(descriptor());
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      // 不跟着转址：送 manual，转址在传输层算网络失败（见 transport.hosts.test.ts）。
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(fetcher.mock.calls[1][1].headers.Cookie).toBe('fixture=next');
    await client(createFetchTransport(fetcher)).execute(descriptor());
    expect(fetcher.mock.calls[2][1].headers.Cookie).toBeUndefined();
  });

  it.each([
    'ENOTFOUND',
    'ECONNREFUSED',
    'UND_ERR_CONNECT_TIMEOUT',
  ])('recognizes confirmed connection establishment failure %s', async (code) => {
    const http = createFetchTransport(async () => {
      throw { cause: { code, secret: 'SECRET_COOKIE' } };
    });
    const r: HttpRequest = {
      url: 'https://fixture.invalid',
      body: '{}',
      headers: {},
      signal: new AbortController().signal,
    };
    expect(await caught(http(r))).toMatchObject({
      phase: 'connect',
      code: code === 'UND_ERR_CONNECT_TIMEOUT' ? 'ETIMEDOUT' : code,
    });
  });

  it('does not guess the phase of a reset before receiving headers', async () => {
    const http = createFetchTransport(async () => {
      throw { code: 'ECONNRESET' };
    });
    expect(
      await caught(
        http({
          url: 'https://fixture.invalid',
          body: '{}',
          headers: {},
          signal: new AbortController().signal,
        }),
      ),
    ).toMatchObject({ phase: 'unknown' });
  });

  it('marks body-read failures as read phase, including connection resets', async () => {
    const http = createFetchTransport(async () => ({
      status: 200,
      text: async () => {
        throw { code: 'ECONNRESET' };
      },
    }));
    expect(await caught(client(http).execute(descriptor()))).toMatchObject({
      errorKey: 'network.reset',
      retryable: false,
    });
  });

  it('prioritizes HTTP failure over invalid JSON and interprets numeric Retry-After only', async () => {
    const read = jest.fn(async () => 'not json');
    const http = createFetchTransport(async () => ({
      status: 429,
      headers: new Headers({ 'Retry-After': '2' }),
      text: read,
    }));
    expect(await caught(client(http).execute(descriptor()))).toMatchObject({
      kind: 'rate-limited',
      retryAfterMs: 2000,
    });
    expect(read).not.toHaveBeenCalled();
  });

  it('rejects invalid JSON with fixed safe messages', async () => {
    const http = createFetchTransport(async () => ({
      status: 200,
      text: async () => 'SECRET_COOKIE',
    }));
    const error = await caught(client(http).execute(descriptor()));
    expect(error).toMatchObject({ kind: 'invalid-response' });
    expect(JSON.stringify(error)).not.toContain('SECRET_COOKIE');
  });

  it('keeps the complete transport core free of npm and Node imports', () => {
    for (const entry of ['protocol/musicu.ts', 'transport/fetch.ts']) {
      expect(inspectRuntimeClosure(path.join(__dirname, '../src', entry)).forbidden).toEqual([]);
    }
  });
});
