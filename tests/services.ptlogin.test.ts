import {
  createPtloginQr,
  exchangePtloginCredential,
  PtloginError,
  type PtloginFetch,
  pollPtloginQr,
} from '../src/services/auth/ptlogin';

// 手机 QQ 纯 HTTP 扫码（QQ 互联网页登录）的协议层：出码、查状态、换凭证。
// 假上游只回固定的假值，不出网；每一步都要求不自动跟随转址、不带客户端 Cookie。

interface Call {
  url: URL;
  init: RequestInit;
}

type Reply = (call: Call) => Response;

const fakeFetch = (replies: Reply[]): { fetch: PtloginFetch; calls: Call[] } => {
  const calls: Call[] = [];
  const queue = [...replies];
  return {
    calls,
    fetch: async (url, init) => {
      const call = { url: new URL(url), init };
      calls.push(call);
      const next = queue.shift();
      if (!next) throw new Error(`没有准备的回应：${url}`);
      return next(call);
    },
  };
};

const headers = (entries: Array<[string, string]>): Headers => {
  const result = new Headers();
  for (const [name, value] of entries) result.append(name, value);
  return result;
};

/** 最小的合法 PNG 头：签名＋IHDR，宽高 37。 */
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

const QRSIG = 'fake-qrsig-value_01';

const qrShowReply =
  (
    cookie = `qrsig=${QRSIG}; Path=/; Domain=ptlogin2.qq.com`,
    body: ConstructorParameters<typeof Response>[0] = pngBytes(),
  ) =>
  (): Response =>
    new Response(body, { status: 200, headers: headers([['set-cookie', cookie]]) });

const pollReply = (body: string) => (): Response => new Response(body, { status: 200 });

const CHECK_SIG =
  'https://ssl.ptlogin2.graph.qq.com/check_sig?pttype=1&uin=10001&service=ptqrlogin&ptsigx=fake';

const hash33 = (value: string, initial: number): number => {
  let result = initial;
  for (const character of value) result += (result << 5) + character.charCodeAt(0);
  return result & 0x7fffffff;
};

const STATE = 'a'.repeat(32);
const CODE = 'ABCDEF0123456789ABCDEF0123456789';

const credentialData = (overrides: Record<string, unknown> = {}) => ({
  loginType: 2,
  musicid: 10001,
  musickey: 'fake-musickey',
  musickeyCreateTime: Math.floor(Date.now() / 1000),
  keyExpiresIn: 259200,
  encryptUin: 'fake-encrypt-uin',
  openid: 'fake-openid',
  access_token: 'fake-access-token',
  refresh_key: '',
  ...overrides,
});

const checkSigReply =
  (
    cookies: Array<[string, string]> = [
      ['set-cookie', 'p_uin=o0010001; Domain=graph.qq.com; Path=/'],
      ['set-cookie', 'p_skey=fake-pskey; Domain=graph.qq.com; Path=/'],
      ['set-cookie', 'pt_oauth_token=fake-oauth; Domain=graph.qq.com; Path=/'],
    ],
    status = 302,
  ) =>
  (): Response =>
    new Response(null, {
      status,
      headers: headers([['location', 'https://graph.qq.com/oauth2.0/login_jump'], ...cookies]),
    });

const loginJumpReply = () => (): Response => new Response('<html></html>', { status: 200 });

const authorizeReply =
  (
    location = `https://y.qq.com/portal/wx_redirect.html?login_type=1&code=${CODE}&state=${STATE}`,
  ) =>
  (): Response =>
    new Response(null, { status: 302, headers: headers([['location', location]]) });

const qqLoginReply =
  (body: unknown = { code: 0, req: { code: 0, data: credentialData() } }, status = 200) =>
  (): Response =>
    new Response(JSON.stringify(body), { status });

const fullExchange = (
  overrides: Partial<Record<'check' | 'jump' | 'auth' | 'login', Reply>> = {},
) =>
  fakeFetch([
    overrides.check ?? checkSigReply(),
    overrides.jump ?? loginJumpReply(),
    overrides.auth ?? authorizeReply(),
    overrides.login ?? qqLoginReply(),
  ]);

const expectNoAutoRedirect = (calls: Call[]) => {
  for (const call of calls) {
    expect(call.init.redirect).toBe('manual');
    expect(call.init).not.toHaveProperty('credentials');
  }
};

describe('ptlogin：出码', () => {
  it('从 ptqrshow 取 qrsig 和 PNG，交回 data URL 与 120 秒寿命', async () => {
    const upstream = fakeFetch([qrShowReply()]);
    const qr = await createPtloginQr({ fetch: upstream.fetch });

    expect(qr.qrsig).toBe(QRSIG);
    expect(qr.imageUrl).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/);
    expect(qr.expiresIn).toBe(120);
    const [call] = upstream.calls;
    expect(call.url.origin + call.url.pathname).toBe('https://xui.ptlogin2.qq.com/ssl/ptqrshow');
    expect(call.url.searchParams.get('appid')).toBe('716027609');
    expect(call.url.searchParams.get('daid')).toBe('383');
    expect(call.url.searchParams.get('pt_3rd_aid')).toBe('100497308');
    expect(call.url.searchParams.get('u1')).toBe('https://graph.qq.com/oauth2.0/login_jump');
    expectNoAutoRedirect(upstream.calls);
  });

  it.each([
    ['qrsig 不在 ptlogin2.qq.com 网域', qrShowReply(`qrsig=${QRSIG}; Domain=qq.com`)],
    ['没有 qrsig', qrShowReply('other=1; Domain=ptlogin2.qq.com')],
    ['图片不是 PNG', qrShowReply(undefined, new Uint8Array(64))],
    ['qrsig 里有不该有的字符', qrShowReply('qrsig=bad"quote; Domain=ptlogin2.qq.com')],
  ])('%s时出码失败', async (_label, reply) => {
    const upstream = fakeFetch([reply]);
    await expect(createPtloginQr({ fetch: upstream.fetch })).rejects.toBeInstanceOf(PtloginError);
  });

  it('上游回 HTTP 500 时带着状态码失败', async () => {
    const upstream = fakeFetch([() => new Response('x', { status: 500 })]);
    await expect(createPtloginQr({ fetch: upstream.fetch })).rejects.toMatchObject({
      step: 'qr-show',
      httpStatus: 500,
    });
  });

  it('把调用方的 signal 交给 fetch', async () => {
    const upstream = fakeFetch([qrShowReply()]);
    const controller = new AbortController();
    await createPtloginQr({ fetch: upstream.fetch, signal: controller.signal });
    expect(upstream.calls[0].init.signal).toBe(controller.signal);
  });
});

describe('ptlogin：查状态', () => {
  it.each([
    ["ptuiCB('66','0','','0','二维码未失效。', '')", { status: 'waiting' }],
    ["ptuiCB('67','0','','0','二维码认证中。', '')", { status: 'scanned' }],
    ["ptuiCB('65','0','','0','二维码已失效。', '')", { status: 'expired' }],
    [
      `ptuiCB('0','0','${CHECK_SIG}','0','登录成功！', 'nick')`,
      { status: 'confirmed', checkSigUrl: CHECK_SIG },
    ],
  ])('%s', async (body, expected) => {
    const upstream = fakeFetch([pollReply(body)]);
    await expect(pollPtloginQr(QRSIG, { fetch: upstream.fetch })).resolves.toEqual(expected);
    const [call] = upstream.calls;
    expect(call.url.origin + call.url.pathname).toBe('https://xui.ptlogin2.qq.com/ssl/ptqrlogin');
    expect(call.url.searchParams.get('ptqrtoken')).toBe(String(hash33(QRSIG, 0)));
    expect(call.url.searchParams.get('aid')).toBe('716027609');
    expect(new Headers(call.init.headers).get('cookie')).toBe(`qrsig=${QRSIG}`);
    expectNoAutoRedirect(upstream.calls);
  });

  it('没见过的状态码带着码失败，不猜意思', async () => {
    const upstream = fakeFetch([pollReply("ptuiCB('68','0','','0','x', '')")]);
    await expect(pollPtloginQr(QRSIG, { fetch: upstream.fetch })).rejects.toMatchObject({
      step: 'qr-poll',
      upstreamCode: 68,
    });
  });

  it.each([
    ['不是 ptuiCB', 'alert(1)'],
    ['参数个数不对', "ptuiCB('66')"],
    ['状态码不是数字', "ptuiCB('x','0','','0','m', '')"],
    ['成功时的网址不是 check_sig', "ptuiCB('0','0','https://evil.test/check_sig','0','m', '')"],
    [
      '成功时的网址不是 https',
      "ptuiCB('0','0','http://ssl.ptlogin2.graph.qq.com/check_sig','0','m', '')",
    ],
  ])('%s时失败', async (_label, body) => {
    const upstream = fakeFetch([pollReply(body)]);
    await expect(pollPtloginQr(QRSIG, { fetch: upstream.fetch })).rejects.toBeInstanceOf(
      PtloginError,
    );
  });
});

describe('ptlogin：换凭证', () => {
  it('check_sig → login_jump → authorize → QQLogin，交回凭证', async () => {
    const upstream = fullExchange();
    const credential = await exchangePtloginCredential(CHECK_SIG, {
      fetch: upstream.fetch,
      state: STATE,
    });

    expect(credential).toMatchObject({ loginType: 2, musicid: 10001, musickey: 'fake-musickey' });
    const [check, jump, authorize, login] = upstream.calls;
    expect(check.url.toString()).toBe(CHECK_SIG);
    expect(jump.url.toString()).toBe('https://graph.qq.com/oauth2.0/login_jump');
    expect(authorize.url.toString()).toBe('https://graph.qq.com/oauth2.0/authorize');
    expect(authorize.init.method).toBe('POST');
    expect(new Headers(authorize.init.headers).get('cookie')).toBe(
      'p_uin=o0010001; p_skey=fake-pskey; pt_oauth_token=fake-oauth',
    );
    const form = new URLSearchParams(String(authorize.init.body));
    expect(form.get('scope')).toBe('get_user_info,get_app_friends');
    expect(form.get('state')).toBe(STATE);
    expect(form.get('client_id')).toBe('100497308');
    expect(form.get('response_type')).toBe('code');
    expect(form.get('g_tk')).toBe(String(hash33('fake-pskey', 5381)));
    expect(new URL(String(form.get('redirect_uri'))).pathname).toBe('/portal/wx_redirect.html');
    expect(login.url.toString()).toBe('https://u.y.qq.com/cgi-bin/musicu.fcg');
    expect(JSON.parse(String(login.init.body))).toEqual({
      comm: { g_tk: 5381, platform: 'yqq', ct: 24, cv: 0 },
      req: { module: 'QQConnectLogin.LoginServer', method: 'QQLogin', param: { code: CODE } },
    });
    // QQ 全局 Cookie 只送到 graph.qq.com，QQLogin 不带任何 Cookie。
    expect(new Headers(login.init.headers).get('cookie')).toBeNull();
    expectNoAutoRedirect(upstream.calls);
  });

  it('没给 state 时每次随机产生，并照样比对回跳带回来的值', async () => {
    const upstream = fakeFetch([
      checkSigReply(),
      loginJumpReply(),
      (call) => {
        const state = new URLSearchParams(String(call.init.body)).get('state') ?? '';
        expect(state).toMatch(/^[0-9a-f]{32}$/);
        return authorizeReply(
          `https://y.qq.com/portal/wx_redirect.html?code=${CODE}&state=${state}`,
        )();
      },
      qqLoginReply(),
    ]);
    await expect(
      exchangePtloginCredential(CHECK_SIG, { fetch: upstream.fetch }),
    ).resolves.toMatchObject({ loginType: 2 });
  });

  it.each<[string, Partial<Record<'check' | 'jump' | 'auth' | 'login', Reply>>, string]>([
    ['check_sig 没有转址', { check: checkSigReply(undefined, 200) }, 'check-sig'],
    [
      'graph.qq.com 的 Cookie 缺 p_skey',
      {
        check: checkSigReply([
          ['set-cookie', 'p_uin=o0010001; Domain=graph.qq.com'],
          ['set-cookie', 'pt_oauth_token=fake-oauth; Domain=graph.qq.com'],
        ]),
      },
      'check-sig',
    ],
    [
      'p_skey 来自别的网域',
      {
        check: checkSigReply([
          ['set-cookie', 'p_uin=o0010001; Domain=graph.qq.com'],
          ['set-cookie', 'p_skey=fake-pskey; Domain=qq.com'],
          ['set-cookie', 'pt_oauth_token=fake-oauth; Domain=graph.qq.com'],
        ]),
      },
      'check-sig',
    ],
    ['login_jump 不是 200', { jump: () => new Response('', { status: 500 }) }, 'login-jump'],
    [
      '回跳带回的 state 对不上',
      { auth: authorizeReply(`https://y.qq.com/portal/wx_redirect.html?code=${CODE}&state=other`) },
      'authorize',
    ],
    [
      '回跳没有 code',
      { auth: authorizeReply(`https://y.qq.com/portal/wx_redirect.html?state=${STATE}`) },
      'authorize',
    ],
    [
      '回跳到别的主机',
      {
        auth: authorizeReply(
          `https://evil.test/portal/wx_redirect.html?code=${CODE}&state=${STATE}`,
        ),
      },
      'authorize',
    ],
    [
      'QQLogin 的凭证不是手机 QQ 类型',
      {
        login: qqLoginReply({ code: 0, req: { code: 0, data: credentialData({ loginType: 1 }) } }),
      },
      'qq-login',
    ],
    [
      'QQLogin 没给 musickey',
      {
        login: qqLoginReply({ code: 0, req: { code: 0, data: credentialData({ musickey: '' }) } }),
      },
      'qq-login',
    ],
  ])('%s时失败', async (_label, overrides, step) => {
    const upstream = fullExchange(overrides);
    await expect(
      exchangePtloginCredential(CHECK_SIG, { fetch: upstream.fetch, state: STATE }),
    ).rejects.toMatchObject({ name: 'PtloginError', step });
  });

  it('QQLogin 被拒时带上游码', async () => {
    const upstream = fullExchange({ login: qqLoginReply({ code: 0, req: { code: 1000 } }) });
    await expect(
      exchangePtloginCredential(CHECK_SIG, { fetch: upstream.fetch, state: STATE }),
    ).rejects.toMatchObject({ step: 'qq-login', upstreamCode: 1000, globalCode: 0 });
  });

  it('check_sig 网址不在白名单时一个请求都不发', async () => {
    const upstream = fakeFetch([]);
    await expect(
      exchangePtloginCredential('https://evil.test/check_sig', { fetch: upstream.fetch }),
    ).rejects.toBeInstanceOf(PtloginError);
    expect(upstream.calls).toEqual([]);
  });

  it('每一步都用调用方的 signal', async () => {
    const upstream = fullExchange();
    const controller = new AbortController();
    await exchangePtloginCredential(CHECK_SIG, {
      fetch: upstream.fetch,
      state: STATE,
      signal: controller.signal,
    });
    expect(upstream.calls.map((call) => call.init.signal)).toEqual(
      upstream.calls.map(() => controller.signal),
    );
  });
});
