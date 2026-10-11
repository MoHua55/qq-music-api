import http from 'node:http';
import { createMusicuClient, type MusicuDescriptor } from '../src/protocol/musicu';
import { createFetchTransport, type FetchExecutor, type FetchInit } from '../src/transport/fetch';
import { type HttpRequest, sleep } from '../src/transport/http';
import { createTokenBucket } from '../src/transport/tokenBucket';

const request: MusicuDescriptor = {
  module: 'fixture.catalog',
  method: 'Read',
  param: {},
  readOnly: true,
};
const envelope = { code: 0, req_0: { code: 0, data: { songs: ['synthetic-song'] } } };
const makeClient = (fetcher: FetchExecutor, extra = {}) =>
  createMusicuClient({
    http: createFetchTransport(fetcher),
    comm: { platform: 'fixture' },
    limiter: createTokenBucket(),
    ...extra,
  });

describe.each(['node', 'web'] as const)('transport executed through the %s host', (runtime) => {
  let server: http.Server | undefined;
  let execute: FetchExecutor;
  let seen: { method?: string; cookie?: string; body: string }[];
  let replyStatus: number;
  let replyText: string;
  beforeEach(async () => {
    seen = [];
    replyStatus = 200;
    replyText = JSON.stringify(envelope);
    if (runtime === 'web') {
      execute = async (_url, init) => {
        seen.push({ method: init.method, cookie: init.headers.Cookie, body: init.body });
        return new Response(replyText, {
          status: replyStatus,
          headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'fixture=session; Path=/' },
        });
      };
    } else {
      server = http.createServer((incoming, outgoing) => {
        let body = '';
        incoming.on('data', (chunk) => {
          body += chunk;
        });
        incoming.on('end', () => {
          seen.push({ method: incoming.method, cookie: incoming.headers.cookie, body });
          outgoing.writeHead(replyStatus, {
            'Content-Type': 'application/json',
            'Set-Cookie': 'fixture=session; Path=/',
          });
          outgoing.end(replyText);
        });
      });
      await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing local host');
      const url = `http://127.0.0.1:${address.port}`;
      execute = (_url, init) => globalThis.fetch(url, init);
    }
  });
  afterEach(async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server?.close((error) => (error ? reject(error) : resolve())),
      );
      server = undefined;
    }
  });

  it('executes JSON POST and restores only its own Cookie jar', async () => {
    const api = makeClient(execute);
    expect(await api.execute(request)).toEqual({ songs: ['synthetic-song'] });
    await api.execute(request);
    expect(seen).toHaveLength(2);
    expect(seen[0].method).toBe('POST');
    expect(seen[1].cookie).toBe('fixture=session');
    expect(JSON.parse(seen[0].body)).toEqual({
      comm: { platform: 'fixture' },
      req_0: { module: 'fixture.catalog', method: 'Read', param: {} },
    });
    await makeClient(execute).execute(request);
    expect(seen[2].cookie).toBeUndefined();
  });
  it('reports HTTP 503 without interpreting credential codes in its body', async () => {
    replyStatus = 503;
    replyText = JSON.stringify({ code: 1000 });
    await expect(makeClient(execute, { maxRetries: 0 }).execute(request)).rejects.toMatchObject({
      kind: 'upstream-http',
      upstreamHttpStatus: 503,
    });
    expect(seen).toHaveLength(1);
  });
  it('rejects malformed JSON without exposing its body', async () => {
    replyText = 'SECRET_COOKIE';
    const error = await makeClient(execute)
      .execute(request)
      .catch((e: Error) => e);
    expect(error).toMatchObject({ kind: 'invalid-response' });
    expect(JSON.stringify(error)).not.toContain('SECRET_COOKIE');
  });
});

describe('additional transport isolation and boundary cases', () => {
  it('does not send jar cookies to a different origin', async () => {
    const seen: FetchInit[] = [];
    const transport = createFetchTransport(async (_url, init) => {
      seen.push(init);
      return new Response(JSON.stringify(envelope), {
        headers: { 'Set-Cookie': 'fixture=one; Path=/' },
      });
    });
    const base: HttpRequest = {
      url: 'https://one.invalid/musicu',
      body: '{}',
      headers: {},
      signal: new AbortController().signal,
    };
    await transport(base);
    await transport({ ...base, url: 'https://two.invalid/musicu' });
    await transport(base);
    expect(seen[1].headers.Cookie).toBeUndefined();
    expect(seen[2].headers.Cookie).toBe('fixture=one');
  });

  it('pins the executor supplied at client creation throughout retries', async () => {
    const first = jest.fn(async () => ({ status: 503 }));
    const other = jest.fn(async () => ({ status: 200, body: envelope }));
    const options = {
      http: first,
      comm: {},
      maxRetries: 1,
      random: () => 0,
      limiter: createTokenBucket(),
    };
    const api = createMusicuClient(options);
    options.http = other;
    await expect(api.execute(request)).rejects.toMatchObject({ kind: 'upstream-http' });
    expect(first).toHaveBeenCalledTimes(2);
    expect(other).not.toHaveBeenCalled();
  });

  it('ignores hostile code getters and coercion instead of executing them', async () => {
    const convert = jest.fn(() => {
      throw new Error('SECRET_COOKIE');
    });
    const transport = createFetchTransport(async () => {
      throw { code: { toString: convert } };
    });
    await expect(
      makeClient(async () => {
        throw {
          get code() {
            throw new Error('SECRET_COOKIE');
          },
        };
      }).execute(request),
    ).rejects.toMatchObject({ kind: 'network', retryable: false });
    await expect(
      transport({
        url: 'https://fixture.invalid',
        body: '{}',
        headers: {},
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ phase: 'unknown' });
    expect(convert).not.toHaveBeenCalled();
  });

  it('ends the deadline while reading a response body, even if the executor ignores abort', async () => {
    jest.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      const api = makeClient(
        async (_url, init) => {
          signal = init.signal;
          return { status: 200, text: () => new Promise<string>(() => {}) };
        },
        { timeoutMs: 100 },
      );
      const task = api.execute(request).catch((e: Error) => e);
      await jest.advanceTimersByTimeAsync(100);
      expect(await task).toMatchObject({ errorKey: 'network.timeout', retryable: false });
      expect(signal?.aborted).toBe(true);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejects already-cancelled sleeps and bucket waits without leaving timers', async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(sleep(10, abort.signal)).rejects.toMatchObject({ errorKey: 'network.aborted' });
    await expect(createTokenBucket().acquire(abort.signal)).rejects.toMatchObject({
      errorKey: 'network.aborted',
    });
  });

  it.each([
    '-1',
    'invalid',
    'Infinity',
    '9999999999999999999999999',
  ])('does not invent a delay from Retry-After %s', async (header) => {
    const api = makeClient(
      async () =>
        new Response('SECRET_COOKIE', { status: 429, headers: { 'Retry-After': header } }),
    );
    await expect(api.execute(request)).rejects.toMatchObject({
      kind: 'rate-limited',
      retryAfterMs: undefined,
    });
  });

  it('merges explicitly supplied cookies after jar cookies and pins JSON content type', async () => {
    const seen: FetchInit[] = [];
    const transport = createFetchTransport(async (_url, init) => {
      seen.push(init);
      return {
        status: 200,
        headers: new Headers({ 'set-cookie': 'fixture=jar; Path=/' }),
        text: async () => JSON.stringify(envelope),
      };
    });
    await createMusicuClient({ http: transport, comm: {}, limiter: createTokenBucket() }).execute(
      request,
    );
    await createMusicuClient({
      http: transport,
      comm: {},
      limiter: createTokenBucket(),
      headers: { cookie: 'fixture=explicit', 'content-type': 'text/plain' },
    }).execute(request);
    expect(seen[1].headers.Cookie).toBe('fixture=explicit');
    expect(seen[1].headers['Content-Type']).toBe('application/json');
    expect(seen[1].headers['content-type']).toBeUndefined();
  });

  it('keeps a missing batch member distinct from a successful empty list', async () => {
    const api = makeClient(async () => new Response(JSON.stringify(envelope)));
    const results = await api.executeBatch([request, request]);
    expect(results[0]).toMatchObject({ ok: true });
    expect(results[1]).toMatchObject({ ok: false, error: { kind: 'invalid-response' } });
  });

  it('rejects circular request parameters without executing the transport', async () => {
    const param: Record<string, unknown> = {};
    param.self = param;
    const execute = jest.fn(async () => new Response(JSON.stringify(envelope)));
    await expect(makeClient(execute).execute({ ...request, param })).rejects.toMatchObject({
      kind: 'input',
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects nonzero subcodes on otherwise successful results', async () => {
    const api = makeClient(
      async () =>
        new Response(JSON.stringify({ code: 0, req_0: { code: 0, subcode: 1000, data: [] } })),
    );
    await expect(api.execute(request)).rejects.toMatchObject({
      kind: 'invalid-response',
      upstreamSubCode: 1000,
    });
  });
});
