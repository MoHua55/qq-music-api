import type { QqQrRelay, ServerlessEnv } from '../src/serverless';
import { handleRequest } from '../src/serverless';
import { deriveAndroidDevice } from '../src/serverless/derivedDevice';
import { createSealedSessionResolver } from '../src/serverless/sealedResolver';
import { createMemoryDeviceContextRepository } from '../src/services/auth/deviceContextStore';
import type { AuthHttpClient } from '../src/services/auth/httpClient';
import { PtloginError } from '../src/services/auth/ptlogin';
import { qrFailureReasonOf, upstreamCodeOf } from '../src/services/auth/qrFailures';
import { createQrLoginService, type QrChannelDriver } from '../src/services/auth/qrLogin';
import { summarizeError } from '../src/util/safeError';

// 没有 MQTT relay 的 Serverless 上，手机 QQ（`qq` 通道）改走纯 HTTP 扫码。
// 三次请求（key、create、check）都是全新的 handleRequest，中间什么都不留在内存里；
// 假上游代替 QQ 的每个端点，不出网。

const SECRET = 'ptlogin-flow-secret';
const ENV: ServerlessEnv = { QQ_SESSION_SECRET: SECRET };
const QIMEI_URL = 'https://api.tencentmusic.com/tme/trpc/proxy';
const MUSICU_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
const QRSHOW_URL = 'https://xui.ptlogin2.qq.com/ssl/ptqrshow';
const QRLOGIN_URL = 'https://xui.ptlogin2.qq.com/ssl/ptqrlogin';
const CHECK_SIG_URL = 'https://ssl.ptlogin2.graph.qq.com/check_sig';
const LOGIN_JUMP_URL = 'https://graph.qq.com/oauth2.0/login_jump';
const AUTHORIZE_URL = 'https://graph.qq.com/oauth2.0/authorize';
const QRSIG = 'fixture-qrsig-value';
const P_SKEY = 'fixture-p-skey';
const CODE = '0123456789ABCDEF0123456789ABCDEF';
const MUSIC_KEY = 'fixture-ptlogin-musickey';
const CHECK_SIG = `${CHECK_SIG_URL}?pttype=1&uin=10001&service=ptqrlogin&ptsigx=fixture`;

const pngBytes = (): Uint8Array => {
  const bytes = new Uint8Array(64);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  view.setUint32(12, 0x49484452);
  view.setUint32(16, 37);
  view.setUint32(20, 37);
  return bytes;
};
const PNG_DATA_URL = `data:image/png;base64,${Buffer.from(pngBytes()).toString('base64')}`;

const ptui = (code: string, url = ''): string => `ptuiCB('${code}','0','${url}','0','m', 'n')`;

interface Upstream {
  poll: string;
  qqLogin: unknown;
  refresh?: unknown;
  calls: Array<{ url: string; cookie: string | null; body: string }>;
}

let upstream: Upstream;
let originalFetch: typeof fetch;

const call = async (path: string, env: ServerlessEnv = ENV, relay?: QqQrRelay) => {
  const response = await handleRequest(new Request(`https://worker.invalid${path}`), env, {
    qqRelay: relay,
  });
  return { status: response.status, body: (await response.json()) as Record<string, any> };
};

beforeEach(() => {
  upstream = {
    poll: ptui('66'),
    qqLogin: {
      code: 0,
      req: {
        code: 0,
        data: {
          loginType: 2,
          musicid: 10001,
          musickey: MUSIC_KEY,
          musickeyCreateTime: Math.floor(Date.now() / 1000),
          keyExpiresIn: 259200,
          encryptUin: 'fixture-encrypt-uin',
          refresh_key: '',
        },
      },
    },
    calls: [],
  };
  originalFetch = global.fetch;
  global.fetch = jest.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const key = `${url.origin}${url.pathname}`;
    const body = init?.body === undefined ? '' : String(init.body);
    upstream.calls.push({ url: key, cookie: request.headers.get('cookie'), body });
    if (init?.redirect !== 'manual') throw new Error(`没有用 manual 转址：${key}`);
    if (key === QIMEI_URL)
      return new Response(
        JSON.stringify({
          data: JSON.stringify({ code: 0, data: { q16: 'q'.repeat(36), q36: 'r'.repeat(36) } }),
        }),
      );
    if (key === QRSHOW_URL) {
      const headers = new Headers();
      headers.append('set-cookie', `qrsig=${QRSIG}; Path=/; Domain=ptlogin2.qq.com`);
      return new Response(pngBytes(), { headers });
    }
    if (key === QRLOGIN_URL) return new Response(upstream.poll);
    if (key === CHECK_SIG_URL) {
      const headers = new Headers({ location: LOGIN_JUMP_URL });
      headers.append('set-cookie', 'p_uin=o0010001; Domain=graph.qq.com; Path=/');
      headers.append('set-cookie', `p_skey=${P_SKEY}; Domain=graph.qq.com; Path=/`);
      headers.append('set-cookie', 'pt_oauth_token=fixture-oauth; Domain=graph.qq.com; Path=/');
      return new Response(null, { status: 302, headers });
    }
    if (key === LOGIN_JUMP_URL) return new Response('<html></html>');
    if (key === AUTHORIZE_URL) {
      const state = new URLSearchParams(body).get('state');
      return new Response(null, {
        status: 302,
        headers: {
          location: `https://y.qq.com/portal/wx_redirect.html?code=${CODE}&state=${state}`,
        },
      });
    }
    if (key === MUSICU_URL) {
      const payload = JSON.parse(body || '{}');
      if (payload?.req?.method === 'QQLogin') return new Response(JSON.stringify(upstream.qqLogin));
      const method = payload?.req_0?.method;
      if (method === 'Login' && upstream.refresh)
        return new Response(JSON.stringify(upstream.refresh));
      if (method === 'GetSession')
        return new Response(
          JSON.stringify({
            code: 0,
            req_0: { code: 0, data: { session: { uid: 1234567890, sid: 'session-sid' } } },
          }),
        );
      if (method === 'GetLoginUserInfo')
        return new Response(
          JSON.stringify({ code: 0, req_0: { code: 0, data: { info: { nick: 'Fixture' } } } }),
        );
      throw new Error(`没有准备的 musicu 方法：${method}`);
    }
    throw new Error(`没有准备的上游：${key}`);
  }) as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

const startQr = async (env: ServerlessEnv = ENV) => {
  const key = await call('/login/qr/key?channel=qq', env);
  expect(key.status).toBe(200);
  return key.body.data.unikey as string;
};

const check = (unikey: string) => call(`/login/qr/check?key=${encodeURIComponent(unikey)}`);

describe('Serverless 的 qq 通道走纯 HTTP 扫码', () => {
  it('key、create、check 三次独立请求走完登录，交出能用的会话', async () => {
    const unikey = await startQr();
    expect(unikey.split('.')[1]).toBe('q');
    expect(unikey.length).toBeLessThan(2000);
    expect(upstream.calls.filter((entry) => entry.url === QRSHOW_URL)).toHaveLength(1);

    // create 不能再出一张新码（会换掉 qrsig），图片要从 unikey 里原样拿回来。
    upstream.calls.length = 0;
    const created = await call(`/login/qr/create?key=${encodeURIComponent(unikey)}`);
    expect(created).toEqual({ status: 200, body: { code: 200, data: { qrimg: PNG_DATA_URL } } });
    expect(upstream.calls).toEqual([]);

    expect((await check(unikey)).body).toEqual({ code: 801, message: 'Waiting for QR scan' });
    upstream.poll = ptui('67');
    expect((await check(unikey)).body).toEqual({ code: 802, message: 'QR code scanned' });

    upstream.poll = ptui('0', CHECK_SIG);
    upstream.calls.length = 0;
    const confirmed = await check(unikey);
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.code).toBe(803);
    expect(confirmed.body.cookie).toMatch(/^qqmusic_session=qq1\.a\./);
    expect(upstream.calls.map((entry) => entry.url)).toEqual([
      QRLOGIN_URL,
      CHECK_SIG_URL,
      LOGIN_JUMP_URL,
      AUTHORIZE_URL,
      MUSICU_URL,
    ]);
    const qrPoll = upstream.calls[0];
    expect(qrPoll.cookie).toBe(`qrsig=${QRSIG}`);
    // QQ 全局 Cookie 只送 graph.qq.com；QQLogin 不带 Cookie。
    expect(upstream.calls[3].cookie).toContain(`p_skey=${P_SKEY}`);
    expect(upstream.calls[4].cookie).toBeNull();
    expect(JSON.stringify(confirmed.body)).not.toContain(P_SKEY);
    expect(JSON.stringify(confirmed.body)).not.toContain(QRSIG);

    const token = String(confirmed.body.cookie).slice('qqmusic_session='.length);
    const status = await handleRequest(
      new Request('https://worker.invalid/login/status', { headers: { 'X-QQ-Session': token } }),
      ENV,
    );
    expect(status.status).toBe(200);
    expect(((await status.json()) as Record<string, any>).data.profile).toBeDefined();
  });

  it('快到期时 POST /login/refresh 用 openid、refresh_token 续期，交出新 token', async () => {
    // 实测 QQLogin 回的 refresh_key 是空的，续期靠 openid、refresh_token 这几项（真账号验过这组参数）。
    const data = (upstream.qqLogin as { req: { data: Record<string, unknown> } }).req.data;
    Object.assign(data, {
      openid: 'fixture-openid',
      access_token: 'fixture-access-token',
      refresh_token: 'fixture-refresh-token',
      unionid: 'fixture-unionid',
    });
    const unikey = await startQr();
    upstream.poll = ptui('0', CHECK_SIG);
    const confirmed = await check(unikey);
    expect(confirmed.body.code).toBe(803);
    const token = String(confirmed.body.cookie).slice('qqmusic_session='.length);

    // 凭证 72 小时，快进到第 70 小时，进了最后 6 小时的续期窗口。
    const later = Date.now() + 70 * 60 * 60 * 1000;
    const clock = jest.spyOn(Date, 'now').mockReturnValue(later);
    try {
      const createdAt = Math.floor(later / 1000);
      upstream.refresh = {
        code: 0,
        req_0: {
          code: 0,
          data: {
            loginType: 2,
            musicid: 10001,
            musickey: 'fixture-ptlogin-new-musickey',
            musickeyCreateTime: createdAt,
            keyExpiresIn: 259200,
            encryptUin: 'fixture-encrypt-uin',
            refresh_key: '',
          },
        },
      };
      upstream.calls.length = 0;
      const refreshed = await handleRequest(
        new Request('https://worker.invalid/login/refresh', {
          method: 'POST',
          headers: { 'X-QQ-Session': token },
        }),
        ENV,
      );
      expect(refreshed.status).toBe(200);
      const body = (await refreshed.json()) as { data: Record<string, unknown> };
      expect(body).toEqual({
        code: 200,
        data: {
          token: expect.any(String),
          rotated: true,
          expiresAt: (createdAt + 259200) * 1000,
        },
      });
      expect(body.data.token).not.toBe(token);
      expect(JSON.stringify(body)).not.toContain('fixture-ptlogin-new-musickey');

      const logins = upstream.calls
        .filter((entry) => entry.url === MUSICU_URL)
        .map((entry) => JSON.parse(entry.body))
        .filter((payload) => payload?.req_0?.method === 'Login');
      expect(logins).toHaveLength(1);
      expect(logins[0].comm.tmeLoginType).toBe(2);
      expect(logins[0].req_0).toMatchObject({
        module: 'music.login.LoginServer',
        param: {
          openid: 'fixture-openid',
          refresh_token: 'fixture-refresh-token',
          unionid: 'fixture-unionid',
          musickey: MUSIC_KEY,
          refresh_key: '',
          loginMode: 2,
        },
      });

      // 新 token 带着新的 musickey 去读。
      upstream.calls.length = 0;
      const status = await handleRequest(
        new Request('https://worker.invalid/login/status', {
          headers: { 'X-QQ-Session': String(body.data.token) },
        }),
        ENV,
      );
      expect(status.status).toBe(200);
      const read = upstream.calls.find((entry) => entry.body.includes('GetLoginUserInfo'));
      expect(read?.body).toContain('fixture-ptlogin-new-musickey');
    } finally {
      clock.mockRestore();
    }
  });

  it('旧写法 channel=mobile 一样走纯 HTTP 扫码', async () => {
    const key = await call('/login/qr/key?channel=mobile');
    expect(key.status).toBe(200);
    expect(upstream.calls.some((entry) => entry.url === QRSHOW_URL)).toBe(true);
  });

  it('上游说二维码失效（65）时照二维码超时回 800', async () => {
    const unikey = await startQr();
    upstream.poll = ptui('65');
    const result = await check(unikey);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      code: 800,
      message: 'QR code expired',
      failureStage: 'qr-event',
      failureReason: 'qr-timeout',
    });
  });

  it('没见过的状态码不当成失败，照旧等待', async () => {
    const unikey = await startQr();
    upstream.poll = ptui('68');
    expect((await check(unikey)).body).toEqual({ code: 801, message: 'Waiting for QR scan' });
  });

  it('QQLogin 被拒时回 QR login failed，带换凭证阶段和上游码', async () => {
    const unikey = await startQr();
    upstream.poll = ptui('0', CHECK_SIG);
    upstream.qqLogin = { code: 0, req: { code: 1000 } };
    const result = await check(unikey);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      code: 800,
      message: 'QR login failed',
      failureStage: 'credential-exchange',
      failureReason: 'upstream-rejected',
      upstreamCode: 1000,
    });
    expect(JSON.stringify(result.body)).not.toContain(P_SKEY);
  });

  // 网页登录换凭证（QQLogin）沿用手机 QQ 换凭证那一组登录码：错误键和提示与 MQTT 通道一致。
  it.each([
    [20279, 'auth.device-limit', 'login.device-limit'],
    [104604, 'auth.rate-limited', 'login.rate-limited'],
    [20277, 'auth.account-restricted', 'login.account-restricted'],
    [20450, 'auth.account-banned', 'login.account-banned'],
    [20272, 'auth.account-binding', 'login.account-binding'],
    [20261, 'auth.login-rejected', 'login.rejected'],
  ])('QQLogin 回 %d 时带错误键 %s 和提示 %s', async (code, errorKey, hintKey) => {
    const unikey = await startQr();
    upstream.poll = ptui('0', CHECK_SIG);
    upstream.qqLogin = { code: 0, req: { code } };
    const result = await check(unikey);
    expect(result.body).toMatchObject({
      code: 800,
      failureStage: 'credential-exchange',
      upstreamCode: code,
      upstreamErrorKey: errorKey,
      failureHint: { key: hintKey },
    });
  });

  it.each([
    ['没登记的码', { code: 0, req: { code: 1000 } }],
    ['网关不是 0', { code: 500001, req: { code: 20277 } }],
  ])('QQLogin %s时不给错误键', async (_label, reply) => {
    const unikey = await startQr();
    upstream.poll = ptui('0', CHECK_SIG);
    upstream.qqLogin = reply;
    const result = await check(unikey);
    expect(result.body).toMatchObject({ code: 800, failureStage: 'credential-exchange' });
    expect(result.body).not.toHaveProperty('upstreamErrorKey');
    expect(result.body).not.toHaveProperty('failureHint');
  });

  it('取消永远回 200，也不打上游', async () => {
    const unikey = await startQr();
    upstream.calls.length = 0;
    const result = await call(`/login/qr/cancel?key=${encodeURIComponent(unikey)}`);
    expect(result.status).toBe(200);
    expect(upstream.calls).toEqual([]);
  });

  it.each(['0', 'false'])('QQ_PTLOGIN_HTTP_ENABLED=%s 时不提供 qq', async (value) => {
    const result = await call('/login/qr/key?channel=qq', {
      ...ENV,
      QQ_PTLOGIN_HTTP_ENABLED: value,
    });
    expect(result.status).toBe(400);
    expect(upstream.calls.some((entry) => entry.url === QRSHOW_URL)).toBe(false);
  });

  it('有 relay 时 qq 照旧走 MQTT，不碰纯 HTTP 扫码', async () => {
    const relay: QqQrRelay = {
      open: jest.fn(async () => undefined),
      image: jest.fn(async () => PNG_DATA_URL),
      poll: jest.fn(async () => []),
      close: jest.fn(async () => undefined),
    };
    // 这里只看有没有碰 ptqrshow；其余上游一律当连不上，建 App 二维码成不成功不在这里比。
    global.fetch = jest.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = new URL(new Request(input, init).url);
      upstream.calls.push({ url: `${url.origin}${url.pathname}`, cookie: null, body: '' });
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await call('/login/qr/key?channel=qq', ENV, relay);
    expect(upstream.calls.some((entry) => entry.url === QRSHOW_URL)).toBe(false);
  });
});

/** 只回应建立会话前的两次初始化调用（QIMEI、GetSession）。 */
const createBootstrapHttp = (): AuthHttpClient =>
  ({
    getCookieHeader: () => '',
    request: jest.fn(),
    post: jest.fn(async (_url: string, payload?: unknown) => {
      const record = (payload ?? {}) as Record<string, unknown>;
      const data = record.req_0
        ? { code: 0, req_0: { code: 0, data: { session: { uid: 1234567890, sid: 'sid' } } } }
        : { data: JSON.stringify({ code: 0, data: { q16: 'q'.repeat(36), q36: 'r'.repeat(36) } }) };
      return { data, status: 200, statusText: 'OK', headers: {}, config: { headers: {} } };
    }),
  }) as unknown as AuthHttpClient;

describe('确认之后的换凭证有时限', () => {
  it('超过本次 check 的预算就停下，回可以重试的失败', async () => {
    const secrets = { current: SECRET };
    let seenSignal: AbortSignal | undefined;
    const driver: QrChannelDriver = {
      mode: 'pull',
      createQr: async () => ({ identifier: QRSIG, imageUrl: PNG_DATA_URL, expiresIn: 120 }),
      advance: async () => [{ type: 'authorized', payload: { checkSigUrl: CHECK_SIG } }],
      exchange: (_session, _payload, signal) =>
        new Promise((_resolve, reject) => {
          seenSignal = signal;
          signal?.addEventListener('abort', () => reject(signal.reason));
        }),
      close: () => undefined,
    };
    const service = createQrLoginService({
      http: createBootstrapHttp(),
      deviceRepository: createMemoryDeviceContextRepository(await deriveAndroidDevice(SECRET)),
      sessionResolver: createSealedSessionResolver({ secrets }),
      capabilities: { channels: ['qq', 'wechat'], sessionMode: 'sealed' },
      drivers: { qq: driver },
      checkBudgetMs: 50,
    });
    const key = await service.createSession('qq');
    await service.createQr(key);
    const startedAt = Date.now();
    const result = await service.checkQr(key, 50);
    expect(Date.now() - startedAt).toBeLessThan(2000);
    expect(seenSignal?.aborted).toBe(true);
    expect(result).toMatchObject({
      code: 800,
      message: 'QR login failed',
      failureStage: 'credential-exchange',
      failureReason: 'network-timeout',
    });
  });
});

describe('纯 HTTP 扫码的失败分类与日志', () => {
  it('HTTP 失败、业务拒绝都有固定的分类，上游码照样交出', () => {
    expect(
      qrFailureReasonOf(
        new PtloginError('Ptlogin upstream HTTP error', 'qr-show', { httpStatus: 500 }),
      ),
    ).toBe('upstream-http-error');
    const rejected = new PtloginError('Ptlogin QQLogin was rejected', 'qq-login', {
      upstreamCode: 1000,
      globalCode: 0,
    });
    expect(qrFailureReasonOf(rejected)).toBe('upstream-rejected');
    expect(upstreamCodeOf(rejected)).toBe(1000);
  });

  it.each([
    'Ptlogin upstream HTTP error',
    'Ptlogin response too large',
    'Ptlogin redirect is not allowed',
    'Ptlogin QR image is not a PNG',
    'Ptlogin QR has no qrsig',
    'Ptlogin poll response is malformed',
    'Ptlogin qrsig is invalid',
    'Ptlogin poll returned an unknown code',
    'Ptlogin credential is invalid',
    'Ptlogin check_sig did not redirect',
    'Ptlogin graph cookies are missing',
    'Ptlogin login_jump failed',
    'Ptlogin authorization code is missing',
    'Ptlogin state does not match',
    'Ptlogin QQLogin was rejected',
  ])('日志认得固定文字：%s', (message) => {
    expect(summarizeError(new PtloginError(message, 'qr-poll')).reason).toBe(message);
  });
});
