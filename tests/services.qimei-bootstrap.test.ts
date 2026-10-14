import type { AxiosResponse } from 'axios';
import { createAndroidDevice } from '../src/services/auth/androidDevice';
import { ensureQimei } from '../src/services/auth/bootstrap';
import type { AuthHttpClient } from '../src/services/auth/httpClient';
import { QqDeviceBootstrapError } from '../src/services/auth/musicuProtocol';
import { logger } from '../src/util/logger';

// QIMEI signs its request with the local clock and rejects anything more than about five
// minutes off the server's (HTTP 200, outer -30000). These tests stand in for that upstream:
// the fake accepts a request only when its signed `timestamp` header is within the window.

const SERVER_NOW = Date.parse('2026-10-14T16:14:45.000Z');
const UPSTREAM_WINDOW_SEC = 300;

// Distinct enough that finding either one in a log line means a raw identifier leaked.
const Q16 = 'raw-q16-identifier';
const Q36 = 'raw-q36-identifier';
const accepted = { code: 0, data: JSON.stringify({ code: 0, data: { q16: Q16, q36: Q36 } }) };
const rejected = { code: -30000 };

/** A QIMEI endpoint whose clock reads `SERVER_NOW`; records the timestamp each request signed. */
const fakeQimeiUpstream = ({ date = true, window = UPSTREAM_WINDOW_SEC } = {}) => {
  const signed: number[] = [];
  const http: AuthHttpClient = {
    getCookieHeader: () => '',
    request: () => Promise.reject(new Error('unexpected request')),
    post: async <T>(_url: string, _data?: unknown, config?: { headers?: unknown }) => {
      const timestamp = Number((config?.headers as Record<string, string>).timestamp);
      signed.push(timestamp);
      const ok = Math.abs(timestamp - SERVER_NOW / 1000) <= window;
      return {
        data: ok ? accepted : rejected,
        status: 200,
        statusText: 'OK',
        headers: date ? { date: new Date(SERVER_NOW).toUTCString() } : {},
        config: {},
      } as unknown as AxiosResponse<T>;
    },
  };
  return { http, signed };
};

describe('ensureQimei clock skew', () => {
  it('should sign with the local clock when it is accurate', async () => {
    const { http, signed } = fakeQimeiUpstream();
    const device = createAndroidDevice();

    await expect(ensureQimei(http, device, SERVER_NOW + 20_000)).resolves.toBe(true);

    expect(signed).toEqual([Math.floor((SERVER_NOW + 20_000) / 1000)]);
    expect(device).toMatchObject({
      qimei: Q16,
      qimei36: Q36,
      qimeiSavedAt: SERVER_NOW + 20_000,
    });
  });

  it.each([
    ['slow', -345_000],
    ['fast', 345_000],
  ])('should retry once with the server time when the local clock is %s', async (_label, skew) => {
    const { http, signed } = fakeQimeiUpstream();
    const device = createAndroidDevice();
    const localNow = SERVER_NOW + skew;

    await expect(ensureQimei(http, device, localNow)).resolves.toBe(true);

    expect(signed).toEqual([Math.floor(localNow / 1000), SERVER_NOW / 1000]);
    // The TTL keeps running on the local clock, the one the next freshness check reads.
    expect(device).toMatchObject({ qimei: Q16, qimei36: Q36, qimeiSavedAt: localNow });
  });

  it('should log which clock each attempt signed with, without the raw QIMEI', async () => {
    const info = jest.spyOn(logger, 'info').mockImplementation(() => undefined);
    try {
      const { http } = fakeQimeiUpstream();

      await ensureQimei(http, createAndroidDevice(), SERVER_NOW - 345_000);

      const results = info.mock.calls.filter(([event]) => event === 'qq-auth.qimei-result');
      expect(results.map(([, fields]) => fields)).toEqual([
        {
          source: 'upstream',
          httpStatus: 200,
          outerCode: -30000,
          outerDataType: 'undefined',
          innerCode: undefined,
          q16Length: 0,
          q36Length: 0,
          signedWith: 'local-clock',
          clockSkewSec: 345,
        },
        {
          source: 'upstream',
          httpStatus: 200,
          outerCode: 0,
          outerDataType: 'string',
          innerCode: 0,
          q16Length: Q16.length,
          q36Length: Q36.length,
          signedWith: 'server-clock',
          clockSkewSec: 345,
        },
      ]);
      const logged = JSON.stringify(info.mock.calls);
      expect(logged).not.toContain(Q16);
      expect(logged).not.toContain(Q36);
    } finally {
      info.mockRestore();
    }
  });

  it('should not retry a rejection when the clock is within a minute', async () => {
    const { http, signed } = fakeQimeiUpstream({ window: 0 });

    await expect(ensureQimei(http, createAndroidDevice(), SERVER_NOW - 30_000)).rejects.toThrow(
      QqDeviceBootstrapError,
    );
    expect(signed).toHaveLength(1);
  });

  it('should not retry when the response carries no Date header', async () => {
    const { http, signed } = fakeQimeiUpstream({ date: false });

    await expect(ensureQimei(http, createAndroidDevice(), SERVER_NOW - 345_000)).rejects.toThrow(
      'QIMEI bootstrap failed (HTTP 200, outer=-30000, inner=unknown)',
    );
    expect(signed).toHaveLength(1);
  });

  it('should give up after the one retry', async () => {
    const { http, signed } = fakeQimeiUpstream({ window: -1 });
    const device = createAndroidDevice();

    await expect(ensureQimei(http, device, SERVER_NOW - 345_000)).rejects.toThrow(
      QqDeviceBootstrapError,
    );
    expect(signed).toHaveLength(2);
    expect(device.qimei).toBeUndefined();
  });
});
