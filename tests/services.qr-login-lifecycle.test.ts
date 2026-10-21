import type { AxiosResponse } from 'axios';
import { createMemoryDeviceContextRepository } from '../src/services/auth/deviceContext';
import type { AuthHttpClient } from '../src/services/auth/httpClient';
import {
  createMemoryAuthSessionRepository,
  createQrLoginService,
  type SessionResolver,
} from '../src/services/auth/qrLogin';
import { logger } from '../src/util/logger';

// 手机上已经确认、上游也发了登录，客户端却拿不到：取消、登出、过期清理各自怎么收尾。
// 原则：已经换到的凭证要么交给客户端，要么撤销，不能留成没人拿得到的会话；
// 取消、登出、过期清理分开处理，不能共用一个「直接删掉」。

type Ev = { type: string; payload: unknown };
const dict = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
const ok = <T>(data: T): AxiosResponse<T> =>
  ({ data, status: 200, statusText: 'OK', headers: {}, config: { headers: {} } }) as never;
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

const QR_TTL_MS = 180_000;

const harness = (
  opts: { gateLogin?: boolean; loginUserCode?: number; sessionResolver?: SessionResolver } = {},
) => {
  let now = 1_000_000;
  let releaseLogin: () => void = () => undefined;
  const loginGate = new Promise<void>((resolve) => {
    releaseLogin = resolve;
  });
  const calls: string[] = [];
  const post = jest.fn(async (_url: string, sent?: unknown) => {
    const payload = typeof sent === 'string' ? JSON.parse(sent) : sent;
    const req = dict(dict(payload).req_0);
    if (!dict(payload).req_0) {
      calls.push('GetQimei');
      return ok({
        data: JSON.stringify({ code: 0, data: { q16: 'q'.repeat(36), q36: 'r'.repeat(36) } }),
      });
    }
    const method = String(req.method ?? '');
    calls.push(method);
    if (method === 'GetSession')
      return ok({ code: 0, req_0: { code: 0, data: { session: { uid: 1, sid: 'sid' } } } });
    if (method === 'CreateQRCode')
      return ok({
        code: 0,
        req_0: {
          code: 0,
          data: {
            qrcodeID: 'fixture-qr',
            qrcode: Buffer.from('89504e470d0a1a0a01020304', 'hex').toString('base64'),
            expiresIn: 180,
          },
        },
      });
    if (method === 'Login') {
      if (opts.gateLogin) await loginGate;
      return ok({
        code: 0,
        req_0: { code: 0, data: { musicid: 10000, musickey: 'k'.repeat(40), loginType: 2 } },
      });
    }
    if (method === 'GetLoginUserInfo') {
      if (opts.loginUserCode !== undefined)
        return ok({ code: 0, req_0: { code: opts.loginUserCode, data: {} } });
      return ok({ code: 0, req_0: { code: 0, data: { info: { nick: 'fixture-nick' } } } });
    }
    throw new Error(`unexpected ${method}`);
  });
  const http: AuthHttpClient = {
    getCookieHeader: () => '',
    request: jest.fn() as never,
    post: post as never,
  };
  let emit: (event: Ev) => void = () => {
    throw new Error('listener not started');
  };
  const authRepo = createMemoryAuthSessionRepository();
  const service = createQrLoginService({
    http,
    deviceRepository: createMemoryDeviceContextRepository(),
    authSessionRepository: authRepo,
    sessionResolver: opts.sessionResolver,
    now: () => now,
    randomBytes: (n) => Buffer.alloc(n, 7),
    listen: (_id, onEvent) => {
      emit = onEvent as never;
      onEvent({ type: 'waiting', payload: null });
      return {
        ready: Promise.resolve(),
        done: new Promise<void>(() => undefined),
        close: () => undefined,
      };
    },
  });
  const scan = () => emit({ type: 'scanned', payload: {} });
  const confirm = () =>
    emit({
      type: 'cookies',
      payload: {
        cookies: { qqmusic_uin: { value: '10000' }, qqmusic_key: { value: 'fixture-ticket' } },
      },
    });
  const storedSessions = () => (authRepo.load() as unknown[] | null) ?? [];
  const advance = (ms: number) => {
    now += ms;
  };
  return { service, scan, confirm, releaseLogin, calls, storedSessions, advance };
};

const tokenOf = (cookie: unknown) => String(cookie).replace(/^qqmusic_session=/, '');

describe.each(['qq', 'qqmusic'] as const)('扫码登录的收尾（%s）', (channel) => {
  let info: jest.SpyInstance;
  let warn: jest.SpyInstance;
  const events = () => [...info.mock.calls, ...warn.mock.calls];
  const event = (name: string) => events().find(([message]) => message === name)?.[1];

  beforeEach(() => {
    info = jest.spyOn(logger, 'info');
    warn = jest.spyOn(logger, 'warn');
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const loggedIn = async (h: ReturnType<typeof harness>) => {
    const key = await h.service.createSession(channel);
    await h.service.createQr(key);
    h.scan();
    h.confirm();
    await flush();
    return key;
  };

  it('换凭证时被取消：换完立刻撤销，不留没人拿得到的会话，并记下没交出去', async () => {
    const h = harness({ gateLogin: true });
    const key = await h.service.createSession(channel);
    await h.service.createQr(key);
    h.scan();
    h.confirm();
    await flush();
    expect(await h.service.checkQr(key)).toMatchObject({ code: 802 });

    h.service.cancelSession(key);
    h.releaseLogin();
    await flush();

    expect(h.calls).toContain('Login');
    expect(h.storedSessions()).toHaveLength(0);
    expect(event('qq-auth.login-undelivered')).toMatchObject({
      loginChannel: channel,
      reason: 'canceled',
    });
    expect(await h.service.checkQr(key)).toEqual({ code: 800, message: 'QR code expired' });
  });

  it('不带 token 的登出不碰正在换凭证的扫码，换完照样交出 803', async () => {
    const h = harness({ gateLogin: true });
    const key = await h.service.createSession(channel);
    await h.service.createQr(key);
    h.scan();
    h.confirm();
    await flush();

    await h.service.logout(undefined);
    h.releaseLogin();
    await flush();

    expect(await h.service.checkQr(key)).toMatchObject({ code: 803 });
    expect(h.storedSessions()).toHaveLength(1);
  });

  it('登出别的会话不影响已确认的扫码；登出这次的会话才把它一起收掉', async () => {
    const h = harness();
    const key = await loggedIn(h);
    const first = await h.service.checkQr(key);
    expect(first).toMatchObject({ code: 803 });

    await h.service.logout('fixture-other-token');
    expect(await h.service.checkQr(key)).toMatchObject({ code: 803 });

    await h.service.logout(tokenOf(first.cookie));
    expect(h.storedSessions()).toHaveLength(0);
    expect(await h.service.checkQr(key)).toEqual({ code: 800, message: 'QR code expired' });
  });

  it('登出不再丢掉别人还在等扫码的二维码', async () => {
    const h = harness();
    const signedIn = await loggedIn(h);
    const token = tokenOf((await h.service.checkQr(signedIn)).cookie);

    h.advance(1_000);
    const pending = await h.service.createSession(channel);
    await h.service.createQr(pending);
    await h.service.logout(token);

    expect(await h.service.checkQr(pending)).toMatchObject({ code: 801 });
  });

  it('最后几秒才确认：过了二维码有效期，领取期内照样拿得到 803', async () => {
    const h = harness();
    const key = await h.service.createSession(channel);
    await h.service.createQr(key);
    h.advance(QR_TTL_MS - 2_000);
    h.scan();
    h.confirm();
    await flush();
    h.advance(3_000);

    expect(await h.service.checkQr(key)).toMatchObject({ code: 803 });
    expect(await h.service.checkQr(key)).toMatchObject({ code: 803 });
  });

  it('确认后一直没人来拿：领取期过了才撤销，并记下没交出去', async () => {
    const h = harness();
    const key = await loggedIn(h);
    h.advance(QR_TTL_MS + 61_000);

    expect(await h.service.checkQr(key)).toEqual({ code: 800, message: 'QR code expired' });
    expect(h.storedSessions()).toHaveLength(0);
    expect(event('qq-auth.login-undelivered')).toMatchObject({
      loginChannel: channel,
      reason: 'unclaimed',
    });
  });

  it('803 交出去过的，领取期过了只清掉二维码，会话照样能用', async () => {
    const h = harness();
    const key = await loggedIn(h);
    expect(await h.service.checkQr(key)).toMatchObject({ code: 803 });
    h.advance(QR_TTL_MS + 61_000);

    expect(await h.service.checkQr(key)).toEqual({ code: 800, message: 'QR code expired' });
    expect(h.storedSessions()).toHaveLength(1);
    expect(event('qq-auth.login-undelivered')).toBeUndefined();
  });

  it('新凭证被上游拒绝：/login/status 照旧回空，但记下上游码', async () => {
    const h = harness({ loginUserCode: 1000 });
    const key = await loggedIn(h);
    const result = await h.service.checkQr(key);
    expect(result.code).toBe(803);

    await expect(h.service.getLoginStatus(tokenOf(result.cookie))).resolves.toBeNull();
    expect(event('qq-auth.login-status-rejected')).toMatchObject({ upstreamCode: 1000 });
  });

  it('意外的例外不再说成过期；找不到会话照旧回过期', async () => {
    let cleanupThrows = false;
    const resolver = {
      mode: 'stored',
      issue: async () => 'fixture-token',
      resolve: async () => null,
      revoke: async () => undefined,
      cleanup: () => {
        if (cleanupThrows) throw new Error('fixture failure');
      },
    } as unknown as SessionResolver;
    const h = harness({ sessionResolver: resolver });
    const key = await loggedIn(h);

    cleanupThrows = true;
    expect(await h.service.checkQr(key)).toEqual({
      code: 800,
      message: 'QR login failed',
      failureStage: 'qr-poll',
      failureReason: 'unexpected-error',
    });
    expect(event('qq-auth.qr-check-failed')).toMatchObject({ name: 'Error' });

    cleanupThrows = false;
    expect(await h.service.checkQr('fixture-missing-key')).toEqual({
      code: 800,
      message: 'QR code expired',
    });
  });
});
