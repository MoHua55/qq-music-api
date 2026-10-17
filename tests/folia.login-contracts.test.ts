import type { AxiosRequestConfig } from 'axios';
import type { QrLoginService } from '../src/services/auth/qrLogin';
import type { createContractUpstream } from './helpers/contractUpstream';

let mockUpstream: ReturnType<typeof createContractUpstream>;
let mockNodeService: QrLoginService;
/** 不为 undefined 时，喜欢列表（CgiGetDiss、dirid 201）的单项 data 换成它。 */
let mockLikedData: Record<string, unknown> | undefined;

const mockFetch = async (input: string | URL | Request, init?: RequestInit) => {
  const outgoing = new Request(input, init);
  const url = new URL(outgoing.url);
  if (mockLikedData && url.pathname === '/cgi-bin/musicu.fcg') {
    const payload = JSON.parse(url.searchParams.get('data') ?? (await outgoing.clone().text()));
    const entries = Object.entries(payload).filter(
      ([key, rpc]) =>
        key !== 'comm' &&
        (rpc as { method?: string }).method === 'CgiGetDiss' &&
        (rpc as { param?: { dirid?: number } }).param?.dirid === 201,
    );
    if (entries.length) {
      await mockUpstream.fetch(outgoing);
      return Response.json({
        code: 0,
        ...Object.fromEntries(entries.map(([key]) => [key, { code: 0, data: mockLikedData }])),
      });
    }
  }
  return mockUpstream.fetch(outgoing);
};

jest.mock('axios', () => {
  const actual = jest.requireActual('axios');
  const create = actual.default.create.bind(actual.default);
  actual.default.create = (config: AxiosRequestConfig) =>
    create({
      ...config,
      adapter: async (outgoing: AxiosRequestConfig) => {
        const url = new URL(String(outgoing.url));
        for (const [key, value] of Object.entries(outgoing.params ?? {}))
          if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
        const result = await mockFetch(url, {
          method: String(outgoing.method ?? 'GET').toUpperCase(),
          body: outgoing.data === undefined ? undefined : String(outgoing.data),
        });
        if (!result.ok)
          throw Object.assign(new Error('Fixture HTTP failure'), {
            response: { status: result.status },
          });
        const data =
          outgoing.responseType === 'arraybuffer'
            ? await result.arrayBuffer()
            : outgoing.responseType === 'text'
              ? await result.text()
              : await result.json();
        return { data, status: result.status, statusText: 'OK', headers: {}, config: outgoing };
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
  CONTRACT_SONGS,
  createContractUpstream as makeUpstream,
} from './helpers/contractUpstream';

// Folia 登录重构后的读法：800 的 message 文字、liked-songs 的 songs／total／more 都成了契约。
// 这里只锁现在的行为，两个宿主跑同一份案例。
describe.each(['node', 'serverless'] as const)('Folia 登录重构依赖的契约：%s', (runtime) => {
  let token: string;
  let originalTransport: ReturnType<typeof getLegacyHttpTransport>;

  const call = async (path: string, authenticated = false) => {
    const headers: Record<string, string> = authenticated ? { 'X-QQ-Session': token } : {};
    if (runtime === 'node') {
      const result = await request(app.callback()).get(path).set(headers);
      return { status: result.status, body: result.body as Record<string, any> };
    }
    const result = await handleRequest(
      new Request(`https://contract.invalid${path}`, { headers }),
      { QQ_SESSION_SECRET: CONTRACT_SECRET },
      { qqRelay: mockUpstream.relay },
    );
    return { status: result.status, body: (await result.json()) as Record<string, any> };
  };

  const startQr = async () => {
    const key = (await call('/login/qr/key?channel=qq')).body.data.unikey as string;
    await call(`/login/qr/create?key=${encodeURIComponent(key)}`);
    return `/login/qr/check?key=${encodeURIComponent(key)}`;
  };

  /** Node 在推送回调里换凭证，要多等几轮微任务才落到终态。 */
  const checkUntilTerminal = async (path: string) => {
    let result = await call(path);
    for (let attempt = 0; attempt < 5 && result.body.code !== 800; attempt++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      result = await call(path);
    }
    return result;
  };

  beforeEach(async () => {
    jest.spyOn(Date, 'now').mockReturnValue(CONTRACT_NOW);
    for (const level of ['debug', 'info', 'warn', 'error'] as const)
      jest.spyOn(logger, level).mockImplementation(() => undefined);
    mockUpstream = makeUpstream();
    mockLikedData = undefined;
    jest.spyOn(global, 'fetch').mockImplementation(mockFetch);
    originalTransport = getLegacyHttpTransport();
    setLegacyHttpTransport(createAxiosLegacyTransport());
    const session = {
      token: 'c'.repeat(64),
      credential: CONTRACT_CREDENTIAL,
      device: deviceFixture.device,
      expiresAt: CONTRACT_NOW + 3600000,
    };
    mockNodeService = createQrLoginService({
      http: createAuthHttpClient(),
      createSessionHttp: createAuthHttpClient,
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

  describe('/login/qr/check 的 800', () => {
    // 手机上取消、二维码超时、上游拒绝登录：都是「过期」那句话，带退避和事件阶段，没有上游码。
    it.each([
      ['timeout', 'qr-timeout'],
      ['canceled', 'user-canceled'],
      ['loginFailed', 'login-rejected'],
    ] as const)('二维码事件 %s 回 QR code expired 和 %s', async (event, failureReason) => {
      const path = await startQr();
      await mockUpstream.observe({ type: event, payload: null });
      const result = await call(path);
      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        code: 800,
        message: 'QR code expired',
        retryAfterMs: 15000,
        failureStage: 'qr-event',
        failureReason,
      });
    });

    // 自然过期（不认识的 key、过了 180 秒）只有 code 和 message，由 folia.http-contracts 守护。

    // 扫过码但换不到凭证、上游也没给码：Folia 只能靠 message 判成「换凭证失败」。
    it('换凭证缺登录凭据时回 QR login failed，带退避、不带上游码', async () => {
      const path = await startQr();
      await mockUpstream.observe({ type: 'cookies', payload: { cookies: {} } });
      const result = await checkUntilTerminal(path);
      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        code: 800,
        message: 'QR login failed',
        retryAfterMs: 15000,
        failureStage: 'credential-payload',
        failureReason: 'missing-credential',
      });
    });

    // 上游给了码（这里不是 20279）：Folia 判成「稍后再试」。
    it('换凭证被上游拒绝时回 QR login failed 和上游码', async () => {
      mockUpstream.state.loginCode = 50006;
      mockUpstream.state.credentialCode = 1000;
      const path = await startQr();
      await mockUpstream.observe({
        type: 'cookies',
        payload: {
          cookies: { qqmusic_uin: { value: '10000' }, qqmusic_key: { value: 'fixture-exchange' } },
        },
      });
      const result = await checkUntilTerminal(path);
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({
        code: 800,
        message: 'QR login failed',
        retryAfterMs: 15000,
        failureStage: 'credential-validation',
        failureReason: 'upstream-rejected',
        upstreamCode: 1000,
      });
      expect(result.body.upstreamCode).not.toBe(20279);
    });
  });

  describe('/user/liked-songs', () => {
    const FOLIA_COUNT_PATH = '/user/liked-songs?limit=100&offset=0';

    const expectFoliaShape = (body: Record<string, any>) => {
      expect(Array.isArray(body.songs)).toBe(true);
      if (body.total !== undefined) expect(Number.isSafeInteger(body.total)).toBe(true);
      expect(typeof body.more).toBe('boolean');
    };

    // Folia 回到窗口、进首页都会问这一页拿 total。
    it('Folia 数数用的那页：从 0 读 100 首，回 songs、total、more', async () => {
      const result = await call(FOLIA_COUNT_PATH, true);
      expect(result.status).toBe(200);
      expect(result.body).toEqual({ code: 200, songs: CONTRACT_SONGS, total: 3, more: false });
      expectFoliaShape(result.body);
      expect(mockUpstream.calls).toContainEqual(
        expect.objectContaining({
          method: 'CgiGetDiss',
          param: expect.objectContaining({ dirid: 201, song_begin: 0, song_num: 100 }),
        }),
      );
    });

    it.each([
      { label: '空列表', data: { songlist: [], total_song_num: 0, hasmore: 0 }, total: 0 },
      { label: '没有 songlist', data: { total_song_num: 0 }, total: 0 },
      { label: 'songlist 不是数组', data: { songlist: null, hasmore: 0 }, total: 0 },
      { label: '整个 data 是空的', data: {}, total: 0 },
    ])('$label 时 songs 仍是数组', async ({ data, total }) => {
      mockLikedData = data;
      const result = await call(FOLIA_COUNT_PATH, true);
      expect(result.status).toBe(200);
      expect(result.body).toEqual({ code: 200, songs: [], total, more: false });
      expectFoliaShape(result.body);
    });

    it.each([
      { label: '上游总数是整数', data: { total_song_num: 7, hasmore: 1 }, total: 7, more: true },
      {
        label: '上游总数是字符串',
        data: { total_song_num: '7', hasmore: 0 },
        total: 2,
        more: false,
      },
      { label: '上游没给总数', data: { hasmore: 0 }, total: 2, more: false },
    ])('$label：total 是安全整数，more 是布尔值', async ({ data, total, more }) => {
      mockLikedData = { songlist: CONTRACT_SONGS.slice(0, 2), ...data };
      const result = await call(FOLIA_COUNT_PATH, true);
      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        code: 200,
        songs: CONTRACT_SONGS.slice(0, 2),
        total,
        more,
      });
      expectFoliaShape(result.body);
    });

    it('没有会话时照旧 401，不出网', async () => {
      const result = await call(FOLIA_COUNT_PATH);
      expect(result).toEqual({ status: 401, body: { code: 401, message: 'Login required' } });
      expect(mockUpstream.calls).toEqual([]);
    });
  });
});
