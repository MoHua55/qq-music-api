import path from 'node:path';
import Koa from 'koa';
import request from 'supertest';
import { lookupBusinessCode } from '../src/protocol/businessCodes';
import { normalizeQqFailure, QqApiError, toNewRouteErrorResponse } from '../src/protocol/errors';
import { inspectRuntimeClosure } from './helpers/runtimeClosure';

describe('scoped upstream error meanings', () => {
  it.each([1000, 104400, 104401])('keeps existing credential code %i on 401', (code) => {
    const error = normalizeQqFailure({ source: 'business', upstreamCode: code });
    expect(error.kind).toBe('credential-invalid');
    expect(error.errorKey).toBe('auth.credential-invalid');
    expect(toNewRouteErrorResponse(error).status).toBe(401);
    expect(error.retryable).toBe(false);
  });

  it.each([
    [20279, 'device-limit', 'auth.device-limit'],
    [20277, 'account-restricted', 'auth.account-restricted'],
    [20278, 'account-restricted', 'auth.account-restricted'],
    [20450, 'account-banned', 'auth.account-banned'],
    [20272, 'account-binding', 'auth.account-binding'],
    [20274, 'account-binding', 'auth.account-binding'],
    [20261, 'login-rejected', 'auth.login-rejected'],
  ] as const)('classifies login code %i without clearing a session', (code, kind, key) => {
    const error = normalizeQqFailure(
      { source: 'business', upstreamCode: code },
      { operation: 'login' },
    );
    expect(error.kind).toBe(kind);
    expect(error.errorKey).toBe(key);
    expect(error.evidence).toBe('protocol-reference');
    expect(toNewRouteErrorResponse(error).status).toBe(502);
    expect(error.retryable).toBe(false);
  });

  it.each([
    20279, 20277, 20278, 20450, 20272, 20274, 20261, 104604,
  ])('does not apply login code %i to playlists', (code) => {
    const error = normalizeQqFailure(
      { source: 'business', upstreamCode: code },
      { operation: 'playlist-read' },
    );
    expect(error.kind).toBe('upstream-business');
    expect(error.errorKey).toBe('upstream.unknown');
    expect(error.upstreamCode).toBe(code);
    expect(error.evidence).toBeUndefined();
  });

  it.each([2001, 104604])('does not invent a cooldown for a business rate limit %i', (code) => {
    const error = normalizeQqFailure(
      { source: 'business', upstreamCode: code },
      { operation: 'login', readOnly: true },
    );
    expect(error.kind).toBe('rate-limited');
    expect(error.retryable).toBe(false);
    expect(toNewRouteErrorResponse(error)).toMatchObject({ status: 429, headers: {} });
    expect(error.retryAfterMs).toBeUndefined();
  });

  it('keeps playlist not-found distinct from an absent route', () => {
    const error = normalizeQqFailure(
      { source: 'business', upstreamCode: 10004 },
      { operation: 'playlist-read' },
    );
    expect(error.kind).toBe('not-found');
    expect(toNewRouteErrorResponse(error)).toMatchObject({
      status: 422,
      body: { code: 422, errorKey: 'playlist.not-found' },
    });
    expect(lookupBusinessCode(10004, 'login')).toBeUndefined();
  });

  it.each([
    [10, 'playlist-read', 'playlist.anonymous-unreadable', 'observed-response'],
    [80120, 'playlist-read', 'playlist.authentication-unverified', 'observed-response'],
    [50006, 'login', 'upstream.unknown', 'observed-response'],
    [22006, 'recommendation-read', 'recommendation.rejected', 'observed-response'],
    [80000, 'album-read', 'album.endpoint-unavailable', 'observed-response'],
    [40000, 'album-read', 'album.endpoint-unavailable', 'observed-response'],
    [80105, 'playlist-write', 'playlist.write-rejected', 'third-party-report'],
  ] as const)('keeps scoped observed code %i conservative', (code, operation, key, evidence) => {
    const error = normalizeQqFailure({ source: 'business', upstreamCode: code }, { operation });
    expect(error.kind).toBe('upstream-business');
    expect(error.errorKey).toBe(key);
    expect(error.evidence).toBe(evidence);
    expect(toNewRouteErrorResponse(error).status).toBe(502);
    expect(error.retryable).toBe(false);
  });

  it('records an idempotency candidate without treating a failed write as success', () => {
    expect(lookupBusinessCode(80092, 'playlist-write')).toMatchObject({
      disposition: 'idempotent-candidate',
      evidence: 'protocol-reference',
    });
    expect(lookupBusinessCode(80092, 'playlist-read')).toBeUndefined();
    const error = normalizeQqFailure(
      { source: 'business', upstreamCode: 80092 },
      { operation: 'playlist-write' },
    );
    expect(toNewRouteErrorResponse(error).status).toBe(502);
    expect(error.retryable).toBe(false);
  });

  it('scopes verification-code rejection to phone login', () => {
    expect(lookupBusinessCode(20271, 'phone-login')?.errorKey).toBe('auth.verification-rejected');
    expect(lookupBusinessCode(20271, 'login')).toBeUndefined();
  });

  it('does not promote a gateway code into credential rejection', () => {
    for (const code of [1000, 500003, -30002]) {
      const error = normalizeQqFailure({ source: 'gateway', upstreamGlobalCode: code });
      expect(error.kind).toBe('upstream-gateway');
      expect(error.upstreamGlobalCode).toBe(code);
      expect(toNewRouteErrorResponse(error).status).toBe(502);
    }
    expect(lookupBusinessCode(500003, 'generic', 'gateway')?.evidence).toBe('third-party-report');
    expect(lookupBusinessCode(500003, 'generic')).toBeUndefined();
  });

  it.each([987654, -30002])('preserves unknown business code %i as an opaque number', (code) => {
    const error = normalizeQqFailure(
      { source: 'business', upstreamCode: code },
      { operation: 'login' },
    );
    expect(error.errorKey).toBe('upstream.unknown');
    expect(error.upstreamCode).toBe(code);
    expect(error.evidence).toBeUndefined();
  });

  it.each([
    0,
    NaN,
    Infinity,
    '1000',
    null,
    {},
    Number.MAX_SAFE_INTEGER + 1,
  ])('rejects an unusable failure code without coercion: %p', (code) => {
    const error = normalizeQqFailure({ source: 'business', upstreamCode: code });
    expect(error.kind).toBe('invalid-response');
    expect(toNewRouteErrorResponse(error).status).toBe(502);
  });
});

describe('network and HTTP classification', () => {
  it.each([
    ['ENOTFOUND', 'network.dns'],
    ['EAI_AGAIN', 'network.dns'],
    ['ECONNREFUSED', 'network.refused'],
    ['ECONNRESET', 'network.reset'],
    ['ETIMEDOUT', 'network.timeout'],
    ['ECONNABORTED', 'network.timeout'],
  ] as const)('only suggests retries for known read-only connection failures: %s', (code, key) => {
    const failure = {
      source: 'network' as const,
      error: Object.assign(new Error('fixture-private-message'), { code }),
    };
    expect(normalizeQqFailure(failure, { readOnly: true, networkPhase: 'connect' })).toMatchObject({
      kind: 'network',
      errorKey: key,
      retryable: true,
    });
    expect(normalizeQqFailure(failure, { readOnly: true, networkPhase: 'read' }).retryable).toBe(
      false,
    );
    expect(normalizeQqFailure(failure, { readOnly: true }).retryable).toBe(false);
    expect(
      normalizeQqFailure(failure, { readOnly: false, networkPhase: 'connect' }).retryable,
    ).toBe(false);
  });

  it.each(['AbortError', 'CanceledError'])('does not retry caller cancellation %s', (name) => {
    const error = normalizeQqFailure(
      { source: 'network', error: Object.assign(new Error('private'), { name }) },
      { readOnly: true, networkPhase: 'connect' },
    );
    expect(error.errorKey).toBe('network.aborted');
    expect(error.retryable).toBe(false);
  });

  it('handles a fetch cause without retaining the native error', () => {
    const raw = Object.assign(new TypeError('private-url-and-cookie'), {
      cause: { code: 'ENOTFOUND', hostname: 'private-host' },
    });
    const error = normalizeQqFailure(
      { source: 'network', error: raw },
      { readOnly: true, networkPhase: 'connect' },
    );
    expect(error.errorKey).toBe('network.dns');
    expect(JSON.stringify(error)).not.toContain('private');
    expect(error).not.toHaveProperty('cause');
  });

  it('handles unknown, cyclic and throwing network error objects safely', () => {
    const cyclic: Record<string, unknown> = { code: 'PRIVATE_UNKNOWN' };
    cyclic.cause = cyclic;
    const throwing = Object.defineProperty({}, 'code', {
      get() {
        throw new Error('private getter');
      },
    });
    for (const raw of [undefined, null, 'private', cyclic, throwing]) {
      const error = normalizeQqFailure(
        { source: 'network', error: raw },
        { readOnly: true, networkPhase: 'connect' },
      );
      expect(error.errorKey).toBe('network.unknown');
      expect(error.retryable).toBe(false);
    }
  });

  it.each([
    400, 401, 403, 404, 500, 503,
  ])('keeps upstream HTTP %i out of session and route status semantics', (status) => {
    const error = normalizeQqFailure(
      { source: 'http', upstreamHttpStatus: status },
      { readOnly: true },
    );
    expect(error.kind).toBe('upstream-http');
    expect(toNewRouteErrorResponse(error).status).toBe(502);
    expect(error.retryable).toBe(status >= 500);
  });

  it('does not retry a failed write even after an upstream 503', () => {
    expect(
      normalizeQqFailure({ source: 'http', upstreamHttpStatus: 503 }, { readOnly: false })
        .retryable,
    ).toBe(false);
  });

  it('preserves a supplied cooldown and rounds Retry-After upward', () => {
    const error = normalizeQqFailure({
      source: 'http',
      upstreamHttpStatus: 429,
      retryAfterMs: 1501,
    });
    expect(toNewRouteErrorResponse(error)).toMatchObject({
      status: 429,
      headers: { 'Retry-After': '2' },
      body: { retryAfterMs: 1501, retryable: false },
    });
    expect(
      toNewRouteErrorResponse(normalizeQqFailure({ source: 'http', upstreamHttpStatus: 429 }))
        .headers,
    ).toEqual({});
  });

  it('gives HTTP and gateway rejection priority over a conflicting credential code', () => {
    const http = normalizeQqFailure({
      source: 'business',
      upstreamCode: 1000,
      upstreamHttpStatus: 503,
    });
    expect(http.kind).toBe('upstream-http');
    expect(toNewRouteErrorResponse(http).status).toBe(502);
    const gateway = normalizeQqFailure({
      source: 'business',
      upstreamCode: 1000,
      upstreamGlobalCode: 500003,
    });
    expect(gateway.kind).toBe('upstream-gateway');
    expect(toNewRouteErrorResponse(gateway).status).toBe(502);
  });

  it.each([
    undefined,
    0,
    200,
    600,
    NaN,
    '503',
  ])('rejects an invalid HTTP failure observation: %p', (status) => {
    expect(normalizeQqFailure({ source: 'http', upstreamHttpStatus: status }).kind).toBe(
      'invalid-response',
    );
  });
});

describe('safe new-route error projection', () => {
  it.each([
    ['input', 400],
    ['auth-missing', 401],
    ['invalid-response', 502],
    ['unexpected', 500],
  ] as const)('maps local %s failures to %i', (source, status) => {
    const result = toNewRouteErrorResponse(normalizeQqFailure({ source }));
    expect(result.status).toBe(status);
    expect(result.body.code).toBe(status);
  });

  it('keeps raw messages, keys, bodies and identifiers out of an error summary', () => {
    const error = new QqApiError('input', {
      errorKey: 'https://private.invalid/token',
      message: 'fixture-private-message',
      credential: { musickey: 'fixture-private-key' },
      cookie: 'fixture-private-cookie',
      response: { data: 'fixture-private-body' },
      uid: 'fixture-private-user',
      cause: new Error('fixture-private-cause'),
      upstreamCode: 7,
      upstreamHttpStatus: 503,
      upstreamGlobalCode: -1,
      upstreamSubCode: 4,
    } as any);
    expect(error.message).toBe('Invalid request');
    expect(error.errorKey).toBe('input.invalid');
    expect(error.toJSON()).toEqual({
      kind: 'input',
      errorKey: 'input.invalid',
      message: 'Invalid request',
      retryable: false,
      upstreamCode: 7,
      upstreamHttpStatus: 503,
      upstreamGlobalCode: -1,
      upstreamSubCode: 4,
    });
    expect(JSON.stringify(error)).not.toContain('fixture-private');
    expect(JSON.stringify(toNewRouteErrorResponse(error))).not.toContain('private.invalid');
  });

  it.each([
    NaN,
    Infinity,
    -1,
    1.5,
    '30000',
  ])('does not serialize an invalid cooldown %p', (retryAfterMs) => {
    const error = normalizeQqFailure({ source: 'http', upstreamHttpStatus: 429, retryAfterMs });
    expect(error.toJSON()).not.toHaveProperty('retryAfterMs');
    expect(toNewRouteErrorResponse(error).headers).toEqual({});
  });

  it('does not allow a caller to mark a business rejection retryable', () => {
    expect(new QqApiError('device-limit', { retryable: true }).retryable).toBe(false);
  });

  it('keeps summaries detached from subsequent source mutation', () => {
    const input = { upstreamCode: 7, retryAfterMs: 0 };
    const error = new QqApiError('upstream-business', input);
    input.upstreamCode = 1000;
    expect(error.upstreamCode).toBe(7);
    const summary = error.toJSON();
    summary.upstreamCode = 1000;
    expect(error.upstreamCode).toBe(7);
  });

  it.each(['node', 'fetch'])('projects the same failure through a %s host', async (host) => {
    const error = normalizeQqFailure(
      { source: 'business', upstreamCode: 10004 },
      { operation: 'playlist-read' },
    );
    const projected = toNewRouteErrorResponse(error);
    let status: number;
    let body: unknown;
    if (host === 'node') {
      const local = new Koa();
      local.use((ctx) => {
        ctx.status = projected.status;
        ctx.set(projected.headers);
        ctx.body = projected.body;
      });
      const response = await request(local.callback()).get('/fixture');
      status = response.status;
      body = response.body;
    } else {
      const response = new Response(JSON.stringify(projected.body), {
        status: projected.status,
        headers: projected.headers,
      });
      status = response.status;
      body = await response.json();
    }
    expect(status).toBe(422);
    expect(body).toEqual(projected.body);
  });

  it('keeps the complete error core dependency closure runtime-neutral', () => {
    expect(
      inspectRuntimeClosure(path.join(__dirname, '../src/protocol/errors.ts')).forbidden,
    ).toEqual([]);
  });
});
