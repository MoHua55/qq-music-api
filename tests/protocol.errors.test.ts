import path from 'node:path';
import Koa from 'koa';
import request from 'supertest';
import {
  lookupUpstreamCode,
  UPSTREAM_CODES,
  UPSTREAM_OPERATIONS,
} from '../src/protocol/businessCodes';
import { normalizeQqFailure, QqApiError, toNewRouteErrorResponse } from '../src/protocol/errors';
import { inspectRuntimeClosure } from './helpers/runtimeClosure';

const CREDENTIAL_CODES = [1000, 104400, 104401] as const;

const LOGIN_EXCHANGE = [
  'login.qq.credential-exchange',
  'login.wechat.credential-exchange',
  'login.wechat.credential-refresh',
] as const;

const LOGIN_CODES = [
  [20279, 'device-limit', 'auth.device-limit'],
  [20277, 'account-restricted', 'auth.account-restricted'],
  [20278, 'account-restricted', 'auth.account-restricted'],
  [20450, 'account-banned', 'auth.account-banned'],
  [20272, 'account-binding', 'auth.account-binding'],
  [20274, 'account-binding', 'auth.account-binding'],
  [20261, 'login-rejected', 'auth.login-rejected'],
] as const;

describe('scoped upstream error meanings', () => {
  // 1000 这几个码只在登记过的带凭证读取里表示凭证失效；没给调用或换一个调用都不推断。
  it.each([
    'session.authenticated-read',
    'recommend.guess-you-like',
    'recommend.playlists',
  ] as const)('maps credential codes to 401 only for the registered call %s', (operation) => {
    for (const code of CREDENTIAL_CODES) {
      const error = normalizeQqFailure({ source: 'business', upstreamCode: code }, { operation });
      expect(error.kind).toBe('credential-invalid');
      expect(error.errorKey).toBe('auth.credential-invalid');
      expect(error.evidence).toBe('existing-behavior');
      expect(toNewRouteErrorResponse(error).status).toBe(401);
      expect(error.retryable).toBe(false);
    }
  });

  it.each([
    undefined,
    'login.qq.fallback-validation',
    'playlist.authenticated-detail',
    'playlist.del-songs',
  ] as const)('does not turn credential codes into 401 for call %p', (operation) => {
    for (const code of CREDENTIAL_CODES) {
      const error = normalizeQqFailure({ source: 'business', upstreamCode: code }, { operation });
      expect(error.kind).toBe('upstream-business');
      expect(error.upstreamCode).toBe(code);
      expect(toNewRouteErrorResponse(error).status).toBe(502);
    }
  });

  it.each(
    LOGIN_EXCHANGE,
  )('classifies login codes on %s without clearing a session', (operation) => {
    for (const [code, kind, key] of LOGIN_CODES) {
      const error = normalizeQqFailure({ source: 'business', upstreamCode: code }, { operation });
      expect(error.kind).toBe(kind);
      expect(error.errorKey).toBe(key);
      expect(error.evidence).toBe('protocol-reference');
      expect(toNewRouteErrorResponse(error).status).toBe(502);
      expect(error.retryable).toBe(false);
    }
  });

  it.each([
    'login.qq.fallback-validation',
    'session.authenticated-read',
    'playlist.authenticated-detail',
    'recommend.guess-you-like',
  ] as const)('does not apply login codes to %s', (operation) => {
    for (const code of [20279, 20277, 20278, 20450, 20272, 20274, 20261, 104604]) {
      const error = normalizeQqFailure({ source: 'business', upstreamCode: code }, { operation });
      expect(error.kind).toBe('upstream-business');
      expect(error.errorKey).toBe('upstream.unknown');
      expect(error.upstreamCode).toBe(code);
      expect(error.evidence).toBeUndefined();
    }
  });

  it.each(
    LOGIN_EXCHANGE,
  )('keeps 104604 on %s as a rate limit without inventing a cooldown', (operation) => {
    const error = normalizeQqFailure(
      { source: 'business', upstreamCode: 104604 },
      { operation, readOnly: true },
    );
    expect(error.kind).toBe('rate-limited');
    expect(error.errorKey).toBe('auth.rate-limited');
    expect(error.retryable).toBe(false);
    expect(toNewRouteErrorResponse(error)).toMatchObject({ status: 429, headers: {} });
    expect(error.retryAfterMs).toBeUndefined();
  });

  // 2001 不再一律当成限流：网页实测删歌单里的歌时回过 2001（retCode 0），意思还没确定。
  it.each([
    undefined,
    'recommend.guess-you-like',
    'recommend.playlists',
    'session.authenticated-read',
    'login.wechat.credential-exchange',
  ] as const)('does not treat 2001 as a rate limit for call %p', (operation) => {
    const error = normalizeQqFailure(
      { source: 'business', upstreamCode: 2001 },
      { operation, readOnly: true },
    );
    expect(error.kind).toBe('upstream-business');
    expect(error.upstreamCode).toBe(2001);
    expect(error.retryable).toBe(false);
    expect(toNewRouteErrorResponse(error)).toMatchObject({ status: 502, headers: {} });
  });

  it('records 2001 on a playlist song removal as observed but unclassified', () => {
    expect(lookupUpstreamCode('playlist.del-songs', 'business', 2001)).toMatchObject({
      kind: 'upstream-business',
      errorKey: 'upstream.unknown',
      evidence: 'observed-response',
    });
    const error = normalizeQqFailure(
      { source: 'business', upstreamCode: 2001 },
      { operation: 'playlist.del-songs', readOnly: false },
    );
    expect(error).toMatchObject({
      kind: 'upstream-business',
      errorKey: 'upstream.unknown',
      evidence: 'observed-response',
      retryable: false,
    });
    expect(toNewRouteErrorResponse(error)).toMatchObject({ status: 502, headers: {} });
  });

  it('keeps playlist not-found distinct from an absent route', () => {
    const error = normalizeQqFailure(
      { source: 'business', upstreamCode: 10004 },
      { operation: 'playlist.authenticated-detail' },
    );
    expect(error.kind).toBe('not-found');
    expect(toNewRouteErrorResponse(error)).toMatchObject({
      status: 422,
      body: { code: 422, errorKey: 'playlist.not-found' },
    });
    expect(lookupUpstreamCode('session.authenticated-read', 'business', 10004)).toBeUndefined();
  });

  it.each([
    [10, 'playlist.anonymous-detail', 'playlist.anonymous-unreadable', 'observed-response'],
    [
      80120,
      'playlist.authenticated-detail',
      'playlist.authentication-unverified',
      'observed-response',
    ],
    [50006, 'login.qq.credential-exchange', 'upstream.unknown', 'observed-response'],
    [1000, 'login.qq.fallback-validation', 'upstream.unknown', 'observed-response'],
    [22006, 'recommend.guess-you-like', 'recommendation.rejected', 'observed-response'],
    [500003, 'recommend.web-daily-candidate', 'upstream.unknown', 'observed-response'],
    [80000, 'library.favorite-albums', 'album.endpoint-unavailable', 'observed-response'],
    [40000, 'library.favorite-albums', 'album.endpoint-unavailable', 'observed-response'],
    [80105, 'playlist.add-songs', 'playlist.write-rejected', 'third-party-report'],
  ] as const)('keeps scoped observed code %i conservative', (code, operation, key, evidence) => {
    const error = normalizeQqFailure({ source: 'business', upstreamCode: code }, { operation });
    expect(error.kind).toBe('upstream-business');
    expect(error.errorKey).toBe(key);
    expect(error.evidence).toBe(evidence);
    expect(toNewRouteErrorResponse(error).status).toBe(502);
    expect(error.retryable).toBe(false);
  });

  it('does not reuse the guess-you-like rejection for other recommendations', () => {
    expect(lookupUpstreamCode('recommend.playlists', 'business', 22006)).toBeUndefined();
  });

  it.each([
    'playlist.add-songs',
    'playlist.del-songs',
  ] as const)('records an idempotency candidate on %s without treating a failed write as success', (operation) => {
    expect(lookupUpstreamCode(operation, 'business', 80092)).toMatchObject({
      disposition: 'idempotent-candidate',
      evidence: 'protocol-reference',
    });
    const error = normalizeQqFailure({ source: 'business', upstreamCode: 80092 }, { operation });
    expect(toNewRouteErrorResponse(error).status).toBe(502);
    expect(error.retryable).toBe(false);
  });

  it('keeps the write idempotency candidate out of reads', () => {
    expect(lookupUpstreamCode('playlist.authenticated-detail', 'business', 80092)).toBeUndefined();
  });

  it('only knows subcode and song-entry numbers at their own layer', () => {
    expect(
      lookupUpstreamCode('recommend.web-daily-candidate', 'business-subcode', 860100005)?.evidence,
    ).toBe('observed-response');
    expect(
      lookupUpstreamCode('recommend.web-daily-candidate', 'business', 860100005),
    ).toBeUndefined();
    expect(lookupUpstreamCode('playback.authenticated-url', 'song-entry', 104003)?.evidence).toBe(
      'observed-response',
    );
    expect(lookupUpstreamCode('playback.authenticated-url', 'business', 104003)).toBeUndefined();
  });

  it('does not promote a gateway code into credential rejection or a global meaning', () => {
    for (const code of [1000, 500003, -30002]) {
      for (const operation of [undefined, 'recommend.playlists'] as const) {
        const error = normalizeQqFailure(
          { source: 'gateway', upstreamGlobalCode: code },
          { operation },
        );
        expect(error.kind).toBe('upstream-gateway');
        expect(error.upstreamGlobalCode).toBe(code);
        expect(error.evidence).toBeUndefined();
        expect(toNewRouteErrorResponse(error).status).toBe(502);
      }
    }
    expect(lookupUpstreamCode('recommend.playlists', 'gateway', 500003)).toBeUndefined();
  });

  it('registers every meaning against exactly one call and one layer', () => {
    const seen = new Set<string>();
    for (const entry of UPSTREAM_CODES) {
      expect(UPSTREAM_OPERATIONS).toContain(entry.operation);
      expect(['gateway', 'business', 'business-subcode', 'song-entry']).toContain(
        entry.sourceLayer,
      );
      expect(Number.isSafeInteger(entry.upstreamCode) && entry.upstreamCode !== 0).toBe(true);
      expect(entry.note.length).toBeGreaterThan(0);
      const id = `${entry.operation}|${entry.sourceLayer}|${entry.upstreamCode}`;
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
  });

  it('only lets registered credential codes invalidate a session', () => {
    for (const entry of UPSTREAM_CODES) {
      const invalidates = entry.kind === 'credential-invalid';
      if (invalidates) {
        expect(CREDENTIAL_CODES).toContain(entry.upstreamCode);
        expect(entry.sourceLayer).toBe('business');
      }
      expect(entry.invalidatesSession === true).toBe(invalidates);
    }
  });

  it('hands out a copy that cannot change the registry', () => {
    const entry = lookupUpstreamCode('session.authenticated-read', 'business', 1000);
    expect(entry).toBeDefined();
    if (entry) (entry as { kind: string }).kind = 'upstream-business';
    expect(lookupUpstreamCode('session.authenticated-read', 'business', 1000)?.kind).toBe(
      'credential-invalid',
    );
  });

  it.each([987654, -30002])('preserves unknown business code %i as an opaque number', (code) => {
    const error = normalizeQqFailure(
      { source: 'business', upstreamCode: code },
      { operation: 'login.wechat.credential-exchange' },
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
      { operation: 'playlist.authenticated-detail' },
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
