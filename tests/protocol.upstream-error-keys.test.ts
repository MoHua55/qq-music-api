import path from 'node:path';
import {
  UPSTREAM_CODES,
  UPSTREAM_OPERATIONS,
  type UpstreamCodeLayer,
} from '../src/protocol/businessCodes';
import {
  EXPOSED_UPSTREAM_ERROR_KEYS,
  exposedUpstreamErrorKeyOf,
  isExposedUpstreamErrorKey,
} from '../src/protocol/upstreamErrorKeys';
import { inspectRuntimeClosure } from './helpers/runtimeClosure';

const LOGIN_EXCHANGE = [
  'login.qq.credential-exchange',
  'login.wechat.credential-exchange',
  'login.wechat.credential-refresh',
] as const;

const LOGIN_CODES = [
  [20279, 'auth.device-limit'],
  [20277, 'auth.account-restricted'],
  [20278, 'auth.account-restricted'],
  [20450, 'auth.account-banned'],
  [20272, 'auth.account-binding'],
  [20274, 'auth.account-binding'],
  [20261, 'auth.login-rejected'],
  [104604, 'auth.rate-limited'],
] as const;

describe('exposed upstream error keys', () => {
  it.each(LOGIN_EXCHANGE)('exposes registered login meanings on %s', (operation) => {
    for (const [code, key] of LOGIN_CODES) {
      expect(exposedUpstreamErrorKeyOf(operation, 'business', code)).toBe(key);
      expect(isExposedUpstreamErrorKey(key)).toBe(true);
      expect(EXPOSED_UPSTREAM_ERROR_KEYS.has(key)).toBe(true);
    }
  });

  it.each(
    UPSTREAM_OPERATIONS.filter((operation) => !LOGIN_EXCHANGE.some((item) => item === operation)),
  )('does not reuse login meanings on %s', (operation) => {
    for (const [code] of LOGIN_CODES) {
      expect(exposedUpstreamErrorKeyOf(operation, 'business', code)).toBeUndefined();
    }
  });

  it.each([
    'gateway',
    'business-subcode',
    'song-entry',
  ] as const)('does not reuse login meanings at the %s layer', (layer) => {
    for (const operation of LOGIN_EXCHANGE) {
      for (const [code] of LOGIN_CODES) {
        expect(exposedUpstreamErrorKeyOf(operation, layer, code)).toBeUndefined();
      }
    }
  });

  it.each([
    'session.authenticated-read',
    'recommend.guess-you-like',
    'recommend.playlists',
  ] as const)('preserves registered credential meanings on %s', (operation) => {
    for (const code of [1000, 104400, 104401]) {
      expect(exposedUpstreamErrorKeyOf(operation, 'business', code)).toBe(
        'auth.credential-invalid',
      );
    }
  });

  it('withholds every observed response even when its key has a readable name', () => {
    for (const entry of UPSTREAM_CODES.filter((item) => item.evidence === 'observed-response')) {
      expect(
        exposedUpstreamErrorKeyOf(entry.operation, entry.sourceLayer, entry.upstreamCode),
      ).toBeUndefined();
    }
    expect(
      exposedUpstreamErrorKeyOf('login.qq.credential-exchange', 'business', 50006),
    ).toBeUndefined();
    expect(
      exposedUpstreamErrorKeyOf('login.qq.fallback-validation', 'business', 1000),
    ).toBeUndefined();
  });

  it('uses the current registry for exposed non-login meanings', () => {
    expect(exposedUpstreamErrorKeyOf('playlist.add-songs', 'business', 80092)).toBe(
      'playlist.already-applied',
    );
    expect(exposedUpstreamErrorKeyOf('playlist.del-songs', 'business', 80092)).toBe(
      'playlist.already-applied',
    );
    expect(exposedUpstreamErrorKeyOf('playlist.add-songs', 'business', 80105)).toBe(
      'playlist.write-rejected',
    );
    expect(exposedUpstreamErrorKeyOf('playlist.del-songs', 'business', 80105)).toBeUndefined();
    expect(EXPOSED_UPSTREAM_ERROR_KEYS.size).toBe(9);
  });

  it.each([
    0,
    NaN,
    Infinity,
    -Infinity,
    1.5,
    987654,
    Number.MAX_SAFE_INTEGER + 1,
  ])('withholds unregistered or unusable code %p', (code) => {
    expect(
      exposedUpstreamErrorKeyOf('login.qq.credential-exchange', 'business', code),
    ).toBeUndefined();
  });

  it('does not guess an operation or coerce numbers', () => {
    for (const operation of ['', 'login.unknown', 'LOGIN.QQ.CREDENTIAL-EXCHANGE']) {
      expect(exposedUpstreamErrorKeyOf(operation, 'business', 20279)).toBeUndefined();
    }
    expect(
      exposedUpstreamErrorKeyOf('login.qq.credential-exchange', 'http' as UpstreamCodeLayer, 20279),
    ).toBeUndefined();
    expect(
      exposedUpstreamErrorKeyOf(
        'login.qq.credential-exchange',
        'business',
        '20279' as unknown as number,
      ),
    ).toBeUndefined();
  });

  it.each([
    undefined,
    null,
    20279,
    true,
    {},
    [],
    new String('auth.device-limit'),
    '',
    'upstream.unknown',
    'upstream.unclassified',
    'auth.unregistered',
    'auth.credential-rejected',
    'recommendation.rejected',
    'playlist.not-found',
    'playlist.anonymous-unreadable',
    'album.endpoint-unavailable',
  ])('rejects an unrecognized restored key %p', (value) => {
    expect(isExposedUpstreamErrorKey(value)).toBe(false);
  });

  it('filters restored values through the exposed-key guard', () => {
    const restored: unknown[] = [
      'auth.device-limit',
      'auth.unregistered',
      'upstream.unknown',
      null,
    ];
    expect(restored.filter(isExposedUpstreamErrorKey)).toEqual(['auth.device-limit']);
    for (const key of EXPOSED_UPSTREAM_ERROR_KEYS) {
      expect(isExposedUpstreamErrorKey(key)).toBe(true);
    }
  });

  it('withholds unknown evidence and unclassified meanings independently', () => {
    jest.isolateModules(() => {
      jest.doMock('../src/protocol/businessCodes', () => {
        const original = jest.requireActual<typeof import('../src/protocol/businessCodes')>(
          '../src/protocol/businessCodes',
        );
        const fixture = original.UPSTREAM_CODES[0];
        return {
          ...original,
          UPSTREAM_CODES: [
            {
              ...fixture,
              upstreamCode: 900001,
              errorKey: 'fixture.unknown-evidence',
              evidence: 'unknown',
            },
            { ...fixture, upstreamCode: 900002, errorKey: 'upstream.unknown' },
            { ...fixture, upstreamCode: 900003, errorKey: 'upstream.unclassified' },
            {
              ...fixture,
              upstreamCode: 900004,
              errorKey: 'fixture.observed',
              evidence: 'observed-response',
            },
            {
              ...fixture,
              upstreamCode: 900005,
              errorKey: 'fixture.controlled',
              evidence: 'verified-controlled',
            },
          ],
        };
      });
      try {
        const isolated =
          require('../src/protocol/upstreamErrorKeys') as typeof import('../src/protocol/upstreamErrorKeys');
        for (const code of [900001, 900002, 900003, 900004]) {
          expect(
            isolated.exposedUpstreamErrorKeyOf('login.qq.credential-exchange', 'business', code),
          ).toBeUndefined();
        }
        expect([...isolated.EXPOSED_UPSTREAM_ERROR_KEYS]).toEqual(['fixture.controlled']);
        expect(isolated.isExposedUpstreamErrorKey('fixture.unknown-evidence')).toBe(false);
        expect(
          isolated.exposedUpstreamErrorKeyOf('login.qq.credential-exchange', 'business', 900005),
        ).toBe('fixture.controlled');
      } finally {
        jest.dontMock('../src/protocol/businessCodes');
      }
    });
  });

  it('keeps the new module dependency closure runtime-neutral', () => {
    expect(
      inspectRuntimeClosure(path.join(__dirname, '../src/protocol/upstreamErrorKeys.ts')).forbidden,
    ).toEqual([]);
  });
});
