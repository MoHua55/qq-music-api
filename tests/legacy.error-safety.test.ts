import http from 'node:http';
import { inspect } from 'node:util';
import type { Context } from 'koa';
import request from 'supertest';
import app from '../src/app';
import { createAxiosLegacyTransport } from '../src/node/request';
import { handleRequest } from '../src/serverless';
import { QqDeviceBootstrapError, QqProtocolError } from '../src/services/auth/qrLogin';
import {
  getLegacyHttpTransport,
  type LegacyHttpTransport,
  setLegacyHttpTransport,
} from '../src/services/httpTransport';
import { AuthCredentialRejectedError } from '../src/util/authError';
import { logger } from '../src/util/logger';
import {
  logServiceFailure,
  summarizeRequestContext,
  withControllerLogging,
} from '../src/util/observability';

// Every value below is a decoy: none of them may appear in an HTTP response or in a log line.
const DECOYS = {
  cookie: 'decoy-cookie-value',
  token: 'decoy-session-token',
  musickey: 'decoy-music-key',
  mqttToken: 'decoy-mqtt-token',
  host: 'decoy-host.invalid',
  path: '/decoy-private-path',
  uin: 'decoy-uin-918273',
  device: 'decoy-qimei-device',
  requestBody: 'decoy-request-body',
  responseBody: 'decoy-response-body',
  stack: 'decoy-stack-frame',
  name: 'DecoyPrivateError',
  code: 'DECOY_PRIVATE_CODE',
  phase: 'decoy-phase',
};
const DECOY_VALUES = Object.values(DECOYS);
const DECOY_URL = `https://${DECOYS.host}${DECOYS.path}?musickey=${DECOYS.musickey}&uin=${DECOYS.uin}`;
const DECOY_MESSAGE = `request to ${DECOY_URL} failed; Cookie: qqmusic_key=${DECOYS.cookie}; token=${DECOYS.token}`;

const withDecoyFields = <T extends object>(error: T): T =>
  Object.assign(error, {
    stack: `${DECOYS.stack}\n    at ${DECOY_URL}`,
    config: {
      url: DECOY_URL,
      headers: { Cookie: `qqmusic_key=${DECOYS.cookie}`, Authorization: DECOYS.token },
      data: DECOYS.requestBody,
    },
    request: { path: DECOYS.path, host: DECOYS.host },
    response: undefined,
    headers: { 'set-cookie': DECOYS.cookie },
    body: DECOYS.responseBody,
    mqtt: { token: DECOYS.mqttToken },
    account: { uin: DECOYS.uin, qimei36: DECOYS.device },
  });

interface RawCase {
  label: string;
  make: () => unknown;
  expected: { name: string; message: string; code?: string; status?: number };
}

// The same raw failure is fed to both runtimes: the Node transport rejects with it, and the
// serverless `fetch` rejects with it.
const rawCases: RawCase[] = [
  {
    label: 'fetch failure with a known connection code in its cause',
    make: () =>
      withDecoyFields(
        Object.assign(new TypeError(DECOY_MESSAGE), {
          cause: { code: 'ECONNREFUSED', hostname: DECOYS.host, address: DECOYS.path },
        }),
      ),
    expected: {
      name: 'TypeError',
      message: 'Upstream request failed (ECONNREFUSED)',
      code: 'ECONNREFUSED',
    },
  },
  {
    label: 'deadline abort',
    make: () => withDecoyFields(new DOMException(DECOY_MESSAGE, 'TimeoutError')),
    expected: { name: 'TimeoutError', message: 'Upstream request timed out' },
  },
  {
    label: 'connection reset carried on the error itself',
    make: () => withDecoyFields(Object.assign(new Error(DECOY_MESSAGE), { code: 'ECONNRESET' })),
    expected: {
      name: 'Error',
      message: 'Upstream request failed (ECONNRESET)',
      code: 'ECONNRESET',
    },
  },
  {
    label: 'unknown error with a private name and code',
    make: () =>
      withDecoyFields(
        Object.assign(new Error(DECOY_MESSAGE), { name: DECOYS.name, code: DECOYS.code }),
      ),
    expected: { name: 'Error', message: 'Service request failed' },
  },
];

type LogCall = [level: string, ...args: unknown[]];

const captureLogs = (): { calls: LogCall[]; restore: () => void } => {
  const calls: LogCall[] = [];
  const spies = (['debug', 'info', 'warn', 'error'] as const).map((level) =>
    jest.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
      calls.push([level, ...args]);
    }),
  );
  return {
    calls,
    restore: () => {
      for (const spy of spies) spy.mockRestore();
    },
  };
};

// `showHidden` also prints non-enumerable `message` and `stack`, so a raw Error that slipped into a
// log argument is caught even though JSON.stringify would hide it.
const render = (value: unknown): string =>
  inspect(value, { depth: Number.POSITIVE_INFINITY, showHidden: true, breakLength: Infinity });

const expectNoDecoys = (rendered: string) => {
  for (const decoy of DECOY_VALUES) expect(rendered).not.toContain(decoy);
};

const failingTransport = (base: LegacyHttpTransport, raw: unknown): LegacyHttpTransport => ({
  kind: base.kind,
  get defaults() {
    return base.defaults;
  },
  request: () => Promise.reject(raw),
});

describe('legacy 500 responses on the Node host', () => {
  const server = app.callback();
  let original: LegacyHttpTransport;
  let logs: ReturnType<typeof captureLogs>;

  beforeEach(() => {
    original = getLegacyHttpTransport();
    logs = captureLogs();
  });

  afterEach(() => {
    setLegacyHttpTransport(original);
    logs.restore();
  });

  it.each(rawCases)('keeps the error object safe on a catalog service: $label', async ({
    make,
    expected,
  }) => {
    setLegacyHttpTransport(failingTransport(original, make()));

    const response = await request(server).get('/getAlbumInfo').query({ albummid: 'fixture' });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: expected });
    expectNoDecoys(response.text);
    expectNoDecoys(render(logs.calls));
  });

  it.each(rawCases)('keeps the error string safe on a thrown controller error: $label', async ({
    make,
    expected,
  }) => {
    setLegacyHttpTransport(failingTransport(original, make()));

    const response = await request(server).get('/getSongInfo/fixture-song');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: expected.message });
    expectNoDecoys(response.text);
    expectNoDecoys(render(logs.calls));
  });
});

describe('legacy 500 responses on the serverless host', () => {
  let fetchSpy: jest.SpyInstance;
  let logs: ReturnType<typeof captureLogs>;

  beforeEach(() => {
    logs = captureLogs();
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    logs.restore();
  });

  const call = (path: string) => handleRequest(new Request(`https://worker.invalid${path}`), {});

  it.each(rawCases)('keeps the error object safe on a catalog service: $label', async ({
    make,
    expected,
  }) => {
    const raw = make();
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(() => Promise.reject(raw));

    const response = await call('/getAlbumInfo?albummid=fixture');
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ error: expected });
    expectNoDecoys(text);
    expectNoDecoys(render(logs.calls));
  });

  it.each(rawCases)('keeps the error string safe on a thrown route error: $label', async ({
    make,
    expected,
  }) => {
    const raw = make();
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(() => Promise.reject(raw));

    const response = await call('/getSongInfo/fixture-song');
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ error: expected.message });
    expectNoDecoys(text);
    expectNoDecoys(render(logs.calls));
  });
});

describe('a real axios failure through the Node transport', () => {
  let upstream: http.Server;
  let upstreamUrl: string;
  let original: LegacyHttpTransport;
  let logs: ReturnType<typeof captureLogs>;

  beforeAll(async () => {
    upstream = http.createServer((req, res) => {
      req.resume();
      res.writeHead(503, {
        'Content-Type': 'application/json',
        'Set-Cookie': `qqmusic_key=${DECOYS.cookie}`,
        'X-Decoy': DECOYS.token,
      });
      res.end(JSON.stringify({ body: DECOYS.responseBody, uin: DECOYS.uin }));
    });
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const address = upstream.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    upstreamUrl = `http://127.0.0.1:${address.port}/legacy-upstream`;
  });

  afterAll(() => new Promise<void>((resolve) => upstream.close(() => resolve())));

  beforeEach(() => {
    original = getLegacyHttpTransport();
    logs = captureLogs();
    const axiosTransport = createAxiosLegacyTransport();
    // Same request the catalog service built, redirected to the local decoy upstream and
    // carrying decoy credentials, so the AxiosError holds them in its config and response.
    setLegacyHttpTransport({
      kind: 'axios',
      get defaults() {
        return axiosTransport.defaults;
      },
      request: (_url, method, options = {}) =>
        axiosTransport.request(
          upstreamUrl,
          method,
          {
            ...options,
            params: { ...options.params, musickey: DECOYS.musickey, uin: DECOYS.uin },
            headers: { ...options.headers, Cookie: `qqmusic_key=${DECOYS.cookie}` },
            data: DECOYS.requestBody,
          },
          'u',
        ),
    });
  });

  afterEach(() => {
    setLegacyHttpTransport(original);
    logs.restore();
  });

  it('answers the existing 500 with only the whitelisted code and upstream status', async () => {
    const response = await request(app.callback())
      .get('/getAlbumInfo')
      .query({ albummid: 'fixture' });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: {
        name: 'AxiosError',
        message: 'Upstream request failed (HTTP 503)',
        code: 'ERR_BAD_RESPONSE',
        status: 503,
      },
    });
    expectNoDecoys(response.text);
    // The failing request is logged as well; it must carry the same safe summary.
    expect(logs.calls).toContainEqual([
      'error',
      'upstream.failed',
      expect.objectContaining({
        error: {
          name: 'AxiosError',
          message: 'Upstream request failed (HTTP 503)',
          code: 'ERR_BAD_RESPONSE',
          status: 503,
        },
      }),
    ]);
    expectNoDecoys(render(logs.calls));
  });
});

describe('controller wrapper error projection', () => {
  let logs: ReturnType<typeof captureLogs>;

  beforeEach(() => {
    logs = captureLogs();
  });

  afterEach(() => {
    logs.restore();
  });

  const createCtx = (): Context =>
    ({
      path: '/fixture',
      method: 'GET',
      query: {},
      params: {},
      request: {},
      status: 404,
      body: undefined,
    }) as unknown as Context;

  const run = async (thrown: unknown) => {
    const ctx = createCtx();
    await withControllerLogging('fixture', () => {
      throw thrown;
    })(ctx);
    return ctx;
  };

  it('keeps the protocol phase and numeric codes of a known upstream rejection', async () => {
    const ctx = await run(new QqProtocolError('get-user-playlists', 2000, 0, 200));

    expect(ctx.status).toBe(500);
    expect(ctx.body).toEqual({
      error: 'get-user-playlists failed (HTTP 200, global=0, code=2000)',
    });
    expect(logs.calls).toContainEqual([
      'error',
      'request.failed',
      expect.objectContaining({
        error: {
          name: 'QqProtocolError',
          message: 'get-user-playlists failed (HTTP 200, global=0, code=2000)',
          status: 200,
          stage: 'get-user-playlists',
          upstreamCode: 2000,
          globalCode: 0,
        },
      }),
    ]);
  });

  it('keeps the numeric codes of a device bootstrap rejection', async () => {
    const ctx = await run(new QqDeviceBootstrapError(503, 7, undefined));

    expect(ctx.body).toEqual({
      error: 'QIMEI bootstrap failed (HTTP 503, outer=7, inner=unknown)',
    });
  });

  it('drops a protocol phase that is not on the whitelist', async () => {
    const ctx = await run(new QqProtocolError(`${DECOYS.phase} ${DECOYS.musickey}`, 2000, 0, 200));

    expect(ctx.body).toEqual({
      error: 'Upstream request failed (HTTP 200, global=0, code=2000)',
    });
    expectNoDecoys(render(ctx.body));
    expectNoDecoys(render(logs.calls));
  });

  it('does not trust a lookalike protocol error with unsafe numbers', async () => {
    const lookalike = Object.assign(new Error(DECOY_MESSAGE), {
      name: 'QqProtocolError',
      phase: 'get-user-playlists',
      httpStatus: DECOYS.uin,
      globalCode: DECOYS.token,
      upstreamCode: Number.MAX_VALUE,
    });
    const ctx = await run(lookalike);

    expect(ctx.body).toEqual({ error: 'Service request failed' });
    expectNoDecoys(render(logs.calls));
  });

  it.each([
    ['a thrown string', DECOY_MESSAGE],
    ['a thrown plain object', { message: DECOY_MESSAGE, config: { url: DECOY_URL } }],
    ['undefined', undefined],
  ])('answers a fixed message for %s', async (_label, thrown) => {
    const ctx = await run(thrown);

    expect(ctx.status).toBe(500);
    expect(ctx.body).toEqual({ error: 'Service request failed' });
    expectNoDecoys(render(logs.calls));
  });

  it('survives cyclic causes and throwing getters', async () => {
    const cyclic: Record<string, unknown> = { code: DECOYS.code };
    cyclic.cause = cyclic;
    const hostile = Object.defineProperties(new Error(DECOY_MESSAGE), {
      code: {
        get() {
          throw new Error(DECOY_MESSAGE);
        },
      },
      cause: { value: cyclic },
      response: {
        get() {
          throw new Error(DECOY_MESSAGE);
        },
      },
    });
    const ctx = await run(hostile);

    expect(ctx.body).toEqual({ error: 'Service request failed' });
    expectNoDecoys(render(logs.calls));
  });

  it('still answers a credential rejection with the existing 401 body', async () => {
    const ctx = await run(new AuthCredentialRejectedError(1000));

    expect(ctx.status).toBe(401);
    expect(ctx.body).toEqual({ code: 401, message: 'Login required' });
    expect(logs.calls).toContainEqual([
      'warn',
      'request.validation_failed',
      expect.objectContaining({
        error: {
          name: 'AuthCredentialRejectedError',
          message: 'Login required',
          upstreamCode: 1000,
        },
      }),
    ]);
  });
});

describe('account and device identifiers in log parameters', () => {
  let logs: ReturnType<typeof captureLogs>;

  beforeEach(() => {
    logs = captureLogs();
  });

  afterEach(() => {
    logs.restore();
  });

  const identifiers = {
    uin: DECOYS.uin,
    uid: DECOYS.uin,
    loginUin: DECOYS.uin,
    hostUin: DECOYS.uin,
    musicid: DECOYS.uin,
    str_musicid: DECOYS.uin,
    encryptUin: DECOYS.uin,
    euin: DECOYS.uin,
    openid: DECOYS.uin,
    access_token: DECOYS.token,
    refresh_token: DECOYS.token,
    qm_keyst: DECOYS.musickey,
    guid: DECOYS.device,
    udid: DECOYS.device,
    imei: DECOYS.device,
    androidId: DECOYS.device,
    deviceId: DECOYS.device,
    qimei16: DECOYS.device,
  };

  // The summarizer prints at most six keys per object, so each identifier is checked on its own.
  it.each(Object.entries(identifiers))('masks %s in a service failure log', (key, value) => {
    logServiceFailure('fixture', '/fixture', new Error(DECOY_MESSAGE), { [key]: value });

    expectNoDecoys(render(logs.calls));
    expect(logs.calls).toContainEqual([
      'error',
      'service.failed',
      expect.objectContaining({ error: { name: 'Error', message: 'Service request failed' } }),
    ]);
  });

  it.each(Object.entries(identifiers))('masks %s in a controller request summary', (key, value) => {
    const summary = summarizeRequestContext({
      path: '/user/playlist',
      query: { [key]: value },
      params: {},
      request: {},
    } as unknown as Context);

    expect(summary).toEqual({ query: { [key]: '*** MASKED ***' } });
  });
});
