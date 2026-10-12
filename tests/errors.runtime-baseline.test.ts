import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import type { QrLoginService } from '../src/services/auth/qrLogin';
import type { createContractUpstream } from './helpers/contractUpstream';

let mockUpstream: ReturnType<typeof createContractUpstream>;
let mockNodeService: QrLoginService;
let mockFailure: { status: number; global: number; business: number } | undefined;

const mockFetch = async (input: string | URL | Request, init?: RequestInit) => {
  const outgoing = new Request(input, init);
  const url = new URL(outgoing.url);
  const payload =
    url.pathname === '/cgi-bin/musicu.fcg'
      ? JSON.parse(url.searchParams.get('data') ?? (await outgoing.clone().text()))
      : {};
  const result = await mockUpstream.fetch(outgoing);
  if (!mockFailure || payload.req_0?.method !== 'GetLoginUserInfo') return result;
  return Response.json(
    { code: mockFailure.global, req_0: { code: mockFailure.business, data: {} } },
    { status: mockFailure.status },
  );
};

jest.mock('axios', () => {
  const actual = jest.requireActual('axios');
  const create = actual.default.create.bind(actual.default);
  actual.default.create = (config: AxiosRequestConfig) =>
    create({
      ...config,
      adapter: async (outgoing: AxiosRequestConfig): Promise<AxiosResponse> => {
        const url = new URL(String(outgoing.url));
        for (const [key, value] of Object.entries(outgoing.params ?? {}))
          if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
        const result = await mockFetch(url, {
          method: String(outgoing.method ?? 'GET').toUpperCase(),
          body: outgoing.data === undefined ? undefined : String(outgoing.data),
        });
        const data = result.ok ? await result.json() : await result.text();
        if (!result.ok)
          throw Object.assign(new Error('Fixture HTTP failure'), {
            response: { status: result.status, data },
          });
        return {
          data,
          status: result.status,
          statusText: 'OK',
          headers: {},
          config: outgoing,
        } as AxiosResponse;
      },
    });
  return actual;
});
jest.mock('../src/services/auth/qrLogin.node', () => ({
  __esModule: true,
  get default() {
    return mockNodeService;
  },
  get qrLoginService() {
    return mockNodeService;
  },
}));

import request from 'supertest';
import app from '../src/app';
import { handleRequest } from '../src/serverless';
import { deriveAndroidDevice } from '../src/serverless/derivedDevice';
import { createSealedSessionResolver } from '../src/serverless/sealedResolver';
import { createMemoryDeviceContextRepository } from '../src/services/auth/deviceContext';
import createAuthHttpClient from '../src/services/auth/httpClient';
import {
  createMemoryAuthSessionRepository,
  createQrLoginService,
} from '../src/services/auth/qrLogin';
import { getLegacyHttpTransport, setLegacyHttpTransport } from '../src/services/httpTransport';
import { logger } from '../src/util/logger';
import { createAxiosLegacyTransport } from '../src/util/request';
import deviceFixture from './fixtures/contracts/device-v1.json';
import {
  CONTRACT_CREDENTIAL,
  CONTRACT_NOW,
  CONTRACT_SECRET,
  createContractUpstream as makeUpstream,
} from './helpers/contractUpstream';

describe.each(['node', 'serverless'] as const)('existing error boundaries: %s', (runtime) => {
  let token: string;
  let current: number;
  let originalTransport: ReturnType<typeof getLegacyHttpTransport>;

  const call = async (path: string, authenticated = true) => {
    const headers = authenticated ? { 'X-QQ-Session': token } : {};
    if (runtime === 'node') {
      const result = await request(app.callback()).get(path).set(headers);
      return { status: result.status, body: result.body, headers: result.headers };
    }
    const result = await handleRequest(
      new Request(`https://baseline.invalid${path}`, { headers }),
      { QQ_SESSION_SECRET: CONTRACT_SECRET },
      { qqRelay: mockUpstream.relay },
    );
    return {
      status: result.status,
      body: await result.json(),
      headers: Object.fromEntries(result.headers),
    };
  };

  beforeEach(async () => {
    current = CONTRACT_NOW;
    jest.spyOn(Date, 'now').mockImplementation(() => current);
    for (const level of ['debug', 'info', 'warn', 'error'] as const)
      jest.spyOn(logger, level).mockImplementation(() => undefined);
    mockUpstream = makeUpstream();
    mockFailure = undefined;
    jest.spyOn(global, 'fetch').mockImplementation(mockFetch);
    originalTransport = getLegacyHttpTransport();
    setLegacyHttpTransport(createAxiosLegacyTransport());
    const session = {
      token: 'b'.repeat(64),
      credential: CONTRACT_CREDENTIAL,
      device: deviceFixture.device,
      expiresAt: current + 3600000,
    };
    mockNodeService = createQrLoginService({
      http: createAuthHttpClient(),
      authSessionRepository: createMemoryAuthSessionRepository([session]),
      deviceRepository: createMemoryDeviceContextRepository(
        await deriveAndroidDevice(CONTRACT_SECRET),
      ),
      listen: mockUpstream.listen,
    });
    token =
      runtime === 'node'
        ? session.token
        : await createSealedSessionResolver({ secrets: { current: CONTRACT_SECRET } }).issue(
            session,
          );
    app.silent = true;
  });

  afterEach(async () => {
    await mockNodeService.logout();
    setLegacyHttpTransport(originalTransport);
    jest.restoreAllMocks();
  });

  it.each([
    1000, 104400, 104401,
  ])('keeps authenticated credential rejection %i at 401', async (business) => {
    mockFailure = { status: 200, global: 0, business };
    expect(await call('/user/detail')).toMatchObject({
      status: 401,
      body: { code: 401, message: 'Login required' },
    });
    expect(await call('/login/status')).toMatchObject({
      status: 200,
      body: { code: 200, data: {} },
    });
  });

  it.each([
    '/getSingerAlbum?singermid=fixture-artist',
    '/getSingerHotsong?singermid=fixture-artist',
  ])('keeps singer parameter rejection inside 200 on %s', async (path) => {
    mockUpstream.state.catalogCode = 104400;
    expect(await call(path)).toMatchObject({
      status: 200,
      body: { response: { code: 0, singer: { code: 104400, data: {} } } },
    });
    expect((await call('/user/detail')).status).toBe(200);
  });

  it('keeps a real upstream HTTP 503 with business 1000 out of 401', async () => {
    mockFailure = { status: 503, global: 0, business: 1000 };
    const failed = await call('/user/detail');
    expect(failed.status).toBe(500);
    expect(failed.headers['retry-after']).toBeUndefined();
    mockFailure = undefined;
    expect((await call('/user/detail')).status).toBe(200);
  });

  it.each([
    { global: 1000, business: 0 },
    { global: 500003, business: 0 },
    { global: 0, business: 500003 },
    { global: 0, business: 987654 },
  ])('preserves gateway and unknown business numbers without clearing a session: %p', async (failure) => {
    mockFailure = { status: 200, ...failure };
    const failed = await call('/user/detail');
    expect(failed.status).toBe(500);
    expect(failed.body).toEqual({
      error: `get-login-user failed (HTTP 200, global=${failure.global}, code=${failure.business})`,
    });
    expect(failed.headers['retry-after']).toBeUndefined();
    mockFailure = undefined;
    expect((await call('/user/detail')).status).toBe(200);
  });

  // Current legacy mapping only inspects the business number, even with a gateway failure.
  it('records the existing conflicting gateway and credential-code mapping', async () => {
    mockFailure = { status: 200, global: 500003, business: 1000 };
    expect((await call('/user/detail')).status).toBe(401);
  });

  it.each([
    20279, 104604, 20450, 2001,
  ])('does not apply login failure %i to catalog state or QR cooldown', async (code) => {
    mockUpstream.state.catalogCode = code;
    const rejected = await call('/getSingerAlbum?singermid=fixture-artist');
    expect(rejected.status).toBe(200);
    expect(rejected.body.response.singer.code).toBe(code);
    expect(rejected.headers['retry-after']).toBeUndefined();
    expect((await call('/user/detail')).status).toBe(200);
    const qr = await call('/login/qr/key?channel=qq', false);
    expect(qr.status).toBe(200);
    await call(`/login/qr/cancel?key=${encodeURIComponent(qr.body.data.unikey)}`, false);
  });

  // This is a baseline for the current global rule, not evidence that 2001 means rate limiting.
  it('records the current recommendation 2001 projection without retries or session removal', async () => {
    mockUpstream.state.recommendCode = 2001;
    expect(await call('/user/guess-you-like')).toMatchObject({
      status: 429,
      body: { errorKey: 'upstream.rate-limited' },
    });
    expect(mockUpstream.calls.filter((rpc) => rpc.method === 'get_radio_track')).toHaveLength(1);
    expect((await call('/user/detail')).status).toBe(200);
  });

  it.each([
    429, 503,
  ])('keeps bootstrap HTTP %i and per-runtime cooldown lifecycle explicit', async (status) => {
    mockUpstream.state.bootstrapStatus = status;
    const first = await call('/login/qr/key?channel=qq', false);
    expect(first).toMatchObject({
      status: 502,
      headers: { 'retry-after': '30' },
      body: {
        retryAfterMs: 30000,
        failureReason: 'upstream-http-error',
        upstreamHttpStatus: status,
      },
    });
    current += 1501;
    const retry = await call('/login/qr/key?channel=qq', false);
    if (runtime === 'node') {
      expect(retry).toMatchObject({
        status: 429,
        headers: { 'retry-after': '29' },
        body: {
          retryAfterMs: 28499,
          failureReason: 'local-backoff',
          lastFailure: {
            failureStage: 'device-bootstrap',
            failureReason: 'upstream-http-error',
            upstreamHttpStatus: status,
          },
        },
      });
      expect(mockUpstream.requests).toHaveLength(1);
    } else {
      expect(retry).toMatchObject({
        status: 502,
        headers: { 'retry-after': '30' },
        body: { retryAfterMs: 30000 },
      });
      expect(mockUpstream.requests).toHaveLength(2);
    }
  });

  it.each([
    'canceled',
    'timeout',
    'loginFailed',
  ] as const)('keeps mobile %s backoff local to the reconstructed service', async (event) => {
    const key = (await call('/login/qr/key?channel=qq', false)).body.data.unikey;
    const path = `/login/qr/check?key=${encodeURIComponent(key)}`;
    await call(`/login/qr/create?key=${encodeURIComponent(key)}`, false);
    await mockUpstream.observe({ type: event, payload: null });
    const failureReason = {
      canceled: 'user-canceled',
      timeout: 'qr-timeout',
      loginFailed: 'login-rejected',
    }[event];
    expect(await call(path, false)).toMatchObject({
      status: 200,
      body: { code: 800, retryAfterMs: 30000, failureStage: 'qr-event', failureReason },
    });
    expect(await call(path, false)).toMatchObject({
      status: 200,
      body: { code: 800, retryAfterMs: 30000 },
    });
    expect((await call('/login/qr/key?channel=qq', false)).status).toBe(
      runtime === 'node' ? 429 : 200,
    );
  });

  it('keeps cancellation idempotent while preserving the different QR storage lifecycles', async () => {
    const key = (await call('/login/qr/key?channel=qq', false)).body.data.unikey;
    await call(`/login/qr/create?key=${encodeURIComponent(key)}`, false);
    expect(await call(`/login/qr/cancel?key=${encodeURIComponent(key)}`, false)).toMatchObject({
      status: 200,
      body: { code: 200 },
    });
    const closedOnce = mockUpstream.closed.length;
    expect(await call(`/login/qr/cancel?key=${encodeURIComponent(key)}`, false)).toMatchObject({
      status: 200,
      body: { code: 200 },
    });
    expect(mockUpstream.closed.length).toBe(closedOnce + (runtime === 'node' ? 0 : 1));
    await mockUpstream.observe({ type: 'timeout', payload: null });
    const late = await call(`/login/qr/check?key=${encodeURIComponent(key)}`, false);
    expect(late.body).toEqual(
      runtime === 'node'
        ? { code: 800, message: 'QR code expired' }
        : {
            code: 800,
            message: 'QR code expired',
            failureStage: 'qr-event',
            failureReason: 'qr-timeout',
            retryAfterMs: 30000,
          },
    );
    expect(mockUpstream.closed).toContain('fixture-qr-id');
    expect((await call('/login/qr/key?channel=qq', false)).status).toBe(200);
  });

  it('keeps preemption process-local and does not back off either runtime', async () => {
    const oldKey = (await call('/login/qr/key?channel=qq', false)).body.data.unikey;
    await call(`/login/qr/create?key=${encodeURIComponent(oldKey)}`, false);
    const next = await call('/login/qr/key?channel=qq', false);
    expect(next.status).toBe(200);
    expect(next.body.data.unikey).not.toBe(oldKey);
    expect((await call(`/login/qr/check?key=${encodeURIComponent(oldKey)}`, false)).body.code).toBe(
      runtime === 'node' ? 800 : 801,
    );
    if (runtime === 'node') expect(mockUpstream.closed).toContain('fixture-qr-id');
    else expect(mockUpstream.closed).toEqual([]);
    await call(`/login/qr/cancel?key=${encodeURIComponent(next.body.data.unikey)}`, false);
  });
});
