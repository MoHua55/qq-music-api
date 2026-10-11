import fs from 'node:fs';
import path from 'node:path';
import type { Context } from 'koa';
import { clearLegacyHttpTransport, getLegacyHttpTransport } from '../src/services/httpTransport';
import { logger } from '../src/util/logger';
import { withControllerLogging } from '../src/util/observability';
import { summarizeError, toLegacyErrorBody, toLegacyErrorMessage } from '../src/util/safeError';

// 对外回应只给一般化的文案；开发日志另外保留具体原因 `reason`。
// 原因只来自程序自己抛出的固定文字，任何夹带外部内容的文字都不会进日志。

const GENERIC = 'Service request failed';

const reasonOf = (error: unknown): string | undefined =>
  (summarizeError(error) as { reason?: string }).reason;

const errorNamed = (name: string, message: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(message), { name }, extra);

describe('specific reasons stay in developer logs only', () => {
  it.each([
    'Login credential is missing encryptUin',
    'MQTT handshake timeout',
    'MQTT cookies missing login credential',
    'QQ auth redirect limit exceeded',
    'GetSession response missing uid/sid',
  ])('logs "%s" as the reason but answers the generic message', (message) => {
    const error = new Error(message);

    expect(summarizeError(error)).toEqual({ name: 'Error', message: GENERIC, reason: message });
    expect(toLegacyErrorMessage(error)).toBe(GENERIC);
    expect(toLegacyErrorBody(error)).toEqual({ name: 'Error', message: GENERIC });
  });

  it.each([
    'MQTT CONNACK rejected: 0x87',
    'MQTT SUBACK rejected: 0x80',
    'Unsupported MQTT property 0x26',
    'Token field iv is not base64url',
    'Envelope field tag is missing',
    'Envelope field iv has an unusable length',
  ])('accepts the fixed template "%s"', (message) => {
    expect(reasonOf(new Error(message))).toBe(message);
  });

  it('keeps the reason next to the upstream status of a failed auth request', () => {
    const error = Object.assign(new Error('QQ auth request failed with status 503'), {
      httpStatus: 503,
    });

    expect(summarizeError(error)).toEqual({
      name: 'Error',
      message: 'Upstream request failed (HTTP 503)',
      status: 503,
      reason: 'QQ auth request failed with status 503',
    });
  });

  it('logs the fixed part of a long configuration message', () => {
    clearLegacyHttpTransport();
    let thrown: unknown;
    try {
      getLegacyHttpTransport();
    } catch (error) {
      thrown = error;
    }

    expect(reasonOf(thrown)).toBe('Legacy QQ HTTP transport is not registered');
  });

  it('keeps the class name and safe number of known login errors', () => {
    expect(
      summarizeError(
        errorNamed('WechatQrError', 'Unrecognised WeChat QR status', { upstreamCode: 408 }),
      ),
    ).toEqual({
      name: 'WechatQrError',
      message: GENERIC,
      upstreamCode: 408,
      reason: 'Unrecognised WeChat QR status',
    });
    expect(summarizeError(errorNamed('SealedSessionError', 'Token failed authentication'))).toEqual(
      {
        name: 'SealedSessionError',
        message: GENERIC,
        reason: 'Token failed authentication',
      },
    );
    expect(summarizeError(errorNamed('SessionCryptoError', 'State failed authentication'))).toEqual(
      {
        name: 'SessionCryptoError',
        message: GENERIC,
        reason: 'State failed authentication',
      },
    );
  });

  it.each([
    ['text appended to a fixed template', 'MQTT CONNACK rejected: 0x87 decoy-music-key'],
    ['a template that echoes caller input', 'Unsupported QR login channel: decoy-music-key'],
    ['arbitrary text wrapped into an Error', 'decoy-cookie-value'],
    ['a fixed message with a suffix', 'Login credential is missing encryptUin: decoy-uin'],
  ])('does not log %s', (_label, message) => {
    const summary = summarizeError(new Error(message));

    expect(summary).not.toHaveProperty('reason');
    expect(JSON.stringify(summary)).not.toContain('decoy');
  });

  it('carries the reason into the controller log while the response stays generic', async () => {
    const calls: unknown[][] = [];
    const spy = jest.spyOn(logger, 'error').mockImplementation((...args: unknown[]) => {
      calls.push(args);
    });
    const ctx = {
      path: '/user/playlist',
      method: 'GET',
      query: {},
      params: {},
      request: {},
      status: 404,
      body: undefined,
    } as unknown as Context;

    await withControllerLogging('getUserPlaylist', () => {
      throw new Error('Login credential is missing encryptUin');
    })(ctx);
    spy.mockRestore();

    expect(ctx.status).toBe(500);
    expect(ctx.body).toEqual({ error: GENERIC });
    expect(calls).toContainEqual([
      'request.failed',
      expect.objectContaining({
        error: {
          name: 'Error',
          message: GENERIC,
          reason: 'Login credential is missing encryptUin',
        },
      }),
    ]);
  });
});

/**
 * Every fixed message the program throws must be recognised, so a new one cannot silently lose
 * its reason in the logs. Templates are listed one by one: a sample that must be accepted, or
 * `null` when the template can carry caller input and therefore must never be logged.
 */
describe('reason whitelist stays in step with the source', () => {
  const SRC = path.join(__dirname, '..', 'src');
  const ERROR_CLASSES =
    'Error|TypeError|WechatQrError|SealedSessionError|SessionCryptoError|QrLoginServiceError';
  // The new error core and transport build their own safe errors and are not part of this list.
  const SKIPPED_DIRS = [path.join(SRC, 'protocol'), path.join(SRC, 'transport')];

  const TEMPLATES: Record<string, string | null> = {
    'MQTT CONNACK rejected: 0x${reasonCode.toString(16)}': 'MQTT CONNACK rejected: 0x87',
    'MQTT SUBACK rejected: 0x${reasonCode.toString(16)}': 'MQTT SUBACK rejected: 0x80',
    'Unsupported MQTT property 0x${id.toString(16)}': 'Unsupported MQTT property 0x26',
    'QQ auth request failed with status ${response.status}':
      'QQ auth request failed with status 503',
    'Token field ${field} is not base64url': 'Token field ct is not base64url',
    'Envelope field ${field} is missing': 'Envelope field iv is missing',
    'Envelope field ${field} has an unusable length': 'Envelope field tag has an unusable length',
    'Unknown sealed purpose: ${purpose}': null,
    'Unsupported QR login channel: ${session.channel}': null,
    'Unsupported QR login channel: ${channel}': null,
  };

  const sources = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return SKIPPED_DIRS.includes(full) ? [] : sources(full);
      return entry.name.endsWith('.ts') ? [full] : [];
    });

  const collect = (quote: string) => {
    const pattern = new RegExp(
      `new (?:${ERROR_CLASSES})\\(\\s*${quote}([^${quote}]+)${quote}`,
      'g',
    );
    return [
      ...new Set(
        sources(SRC).flatMap((file) =>
          [...fs.readFileSync(file, 'utf8').matchAll(pattern)].map((match) => match[1]),
        ),
      ),
    ].sort();
  };

  it('recognises every fixed message thrown in src', () => {
    const literals = collect("'");
    const unrecognised = literals.filter((message) => reasonOf(new Error(message)) !== message);

    expect(literals.length).toBeGreaterThan(30);
    expect(unrecognised).toEqual([]);
  });

  it('classifies every message template thrown in src', () => {
    expect(collect('`')).toEqual(Object.keys(TEMPLATES).sort());
    for (const [template, sample] of Object.entries(TEMPLATES)) {
      if (sample === null) continue;
      expect([template, reasonOf(new Error(sample))]).toEqual([template, sample]);
    }
  });
});
