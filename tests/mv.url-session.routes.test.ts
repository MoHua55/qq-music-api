import type { QrLoginService } from '../src/services/auth/qrLogin';

let mockNodeService: QrLoginService;

jest.mock('../src/services/auth/qrLogin.node', () => ({
  __esModule: true,
  get default() {
    return mockNodeService;
  },
  get qrLoginService() {
    return mockNodeService;
  },
  configureAuthSessionRepository: (
    repository: Parameters<QrLoginService['configureAuthSessionRepository']>[0],
  ) => mockNodeService.configureAuthSessionRepository(repository),
}));

import request from 'supertest';
import app from '../src/app';
import { handleRequest, type ServerlessEnv } from '../src/serverless';
import { deriveAndroidDevice } from '../src/serverless/derivedDevice';
import { createSealedSessionResolver } from '../src/serverless/sealedResolver';
import { createMemoryDeviceContextRepository } from '../src/services/auth/deviceContext';
import createAuthHttpClient from '../src/services/auth/httpClient';
import {
  createMemoryAuthSessionRepository,
  createQrLoginService,
} from '../src/services/auth/qrLogin';
import { logger } from '../src/util/logger';
import deviceFixture from './fixtures/contracts/device-v1.json';
import { CONTRACT_CREDENTIAL, CONTRACT_NOW, CONTRACT_SECRET } from './helpers/contractUpstream';

// MV 播放链接的会话：有会话就带凭证读，没有就照旧匿名。Node 与 serverless 跑同一份案例，只替换对外的 fetch。
// 2026-10 实测：匿名时高的几档单档码 1000、没有链接；带凭证时 MP4 各档都有链接，HLS 也有。
// 回包照旧只交出有链接的 MP4。vid 与链接都是假数据。

interface Rpc {
  module: string;
  method: string;
  param: Record<string, unknown>;
}
interface Recorded {
  comm: Record<string, unknown>;
  cookie: string | null;
  rpcs: Rpc[];
}
interface Reply {
  code?: number;
  data?: unknown;
}
interface HttpResult {
  status: number;
  body: Record<string, any>;
}

const VID = 'fixturevid1';

const file = (filetype: number, code: number, urls: string[]) => ({
  url: urls,
  freeflow_url: [],
  code,
  filetype,
  fileSize: filetype * 1000,
});
const linked = (filetype: number) => file(filetype, 0, [`https://fixture.invalid/${filetype}.mp4`]);

const ANONYMOUS_URLS = {
  [VID]: {
    mp4: [file(0, 2000, []), linked(10), linked(20), linked(30), file(40, 1000, [])],
    hls: [file(10, 2050, [])],
  },
};
const SIGNED_IN_URLS = {
  [VID]: {
    mp4: [file(0, 2000, []), linked(10), linked(20), linked(30), linked(40), linked(50)],
    hls: [file(50, 0, ['https://fixture.invalid/50.m3u8'])],
  },
};

const filesOf = (...qualities: number[]) =>
  qualities.map((quality) => ({
    quality,
    size: quality * 1000,
    urls: [`https://fixture.invalid/${quality}.mp4`],
  }));

describe.each(['node', 'serverless'] as const)('/mv/url session: %s', (runtime) => {
  let token: string;
  let recorded: Recorded[];
  let reply: Reply;
  let call: (
    path: string,
    options?: { token?: string; env?: ServerlessEnv },
  ) => Promise<HttpResult>;

  const upstream = async (input: string | URL | Request, init?: RequestInit) => {
    const fetched = new Request(input, init);
    const url = new URL(fetched.url);
    if (url.hostname !== 'u.y.qq.com' || url.pathname !== '/cgi-bin/musicu.fcg')
      throw new Error(`Unstubbed request: ${url.origin}${url.pathname}`);
    const payload = JSON.parse(await fetched.text());
    const rpcs: Rpc[] = Object.entries(payload)
      .filter(([key]) => key.startsWith('req_'))
      .map(([, value]) => value as Rpc);
    recorded.push({ comm: payload.comm, cookie: fetched.headers.get('cookie'), rpcs });
    const signedIn = typeof payload.comm?.authst === 'string';
    return Response.json({
      code: 0,
      req_0: {
        code: reply.code ?? 0,
        data: reply.data ?? (signedIn ? SIGNED_IN_URLS : ANONYMOUS_URLS),
      },
    });
  };

  beforeEach(async () => {
    jest.spyOn(Date, 'now').mockReturnValue(CONTRACT_NOW);
    for (const level of ['debug', 'warn', 'error'] as const)
      jest.spyOn(logger, level).mockImplementation(() => undefined);
    jest.spyOn(global, 'fetch').mockImplementation(upstream);
    recorded = [];
    reply = {};
    const session = {
      token: 'b'.repeat(64),
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
    });
    token =
      runtime === 'node'
        ? session.token
        : await createSealedSessionResolver({ secrets: { current: CONTRACT_SECRET } }).issue(
            session,
          );
    app.silent = true;
    call = async (path, options = {}) => {
      const headers: Record<string, string> = {};
      if (options.token) headers['X-QQ-Session'] = options.token;
      if (runtime === 'node') {
        const result = await request(app.callback()).get(path).set(headers);
        return { status: result.status, body: result.body };
      }
      const result = await handleRequest(
        new Request(`https://mv.invalid${path}`, { headers }),
        options.env ?? { QQ_SESSION_SECRET: CONTRACT_SECRET },
      );
      return { status: result.status, body: (await result.json()) as HttpResult['body'] };
    };
  });

  afterEach(async () => {
    await mockNodeService.logout();
    jest.restoreAllMocks();
  });

  const expectAnonymousRequest = () => {
    expect(recorded).toHaveLength(1);
    expect(recorded[0].comm).toEqual({ ct: 24, cv: 0 });
    expect(recorded[0].cookie).toBeNull();
  };

  it('reads anonymously without a session, as before', async () => {
    const result = await call(`/mv/url?vid=${VID}`);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ code: 200, vid: VID, files: filesOf(10, 20, 30) });
    expectAnonymousRequest();
  });

  it('uses the credential when the session resolves and gives the extra MP4 files', async () => {
    const result = await call(`/mv/url?vid=${VID}`, { token });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ code: 200, vid: VID, files: filesOf(10, 20, 30, 40, 50) });
    expect(recorded).toHaveLength(1);
    expect(recorded[0].comm).toMatchObject({
      ct: 11,
      authst: CONTRACT_CREDENTIAL.musickey,
      tmeLoginType: CONTRACT_CREDENTIAL.loginType,
    });
    expect(recorded[0].cookie).toContain(`qqmusic_key=${CONTRACT_CREDENTIAL.musickey}`);
    expect(recorded[0].rpcs).toHaveLength(1);
    expect(recorded[0].rpcs[0]).toMatchObject({
      module: 'music.stream.MvUrlProxy',
      method: 'GetMvUrls',
      param: { vids: [VID], request_type: 10003 },
    });
    expect(recorded[0].rpcs[0].param.guid).toMatch(/^[0-9a-f]{32}$/);
  });

  it('falls back to anonymous when the token does not resolve', async () => {
    const result = await call(`/mv/url?vid=${VID}`, { token: 'c'.repeat(64) });

    expect(result.status).toBe(200);
    expect(result.body.files).toEqual(filesOf(10, 20, 30));
    expectAnonymousRequest();
  });

  it('still drops signed-in files that came without links', async () => {
    reply.data = { [VID]: { mp4: [linked(10), file(50, 1000, [])], hls: [] } };

    const result = await call(`/mv/url?vid=${VID}`, { token });

    expect(result.body.files).toEqual(filesOf(10));
    expect(recorded[0].comm).toHaveProperty('authst');
  });

  it.each([
    1000, 104400,
  ])('code %s with a session stays 502 and keeps the session', async (code) => {
    reply.code = code;

    const result = await call(`/mv/url?vid=${VID}`, { token });

    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({ errorKey: 'upstream.unknown', upstreamCode: code });
    expect(recorded[0].comm).toHaveProperty('authst');
  });

  if (runtime === 'serverless') {
    it('reads anonymously without a session secret even when a token is sent', async () => {
      const result = await call(`/mv/url?vid=${VID}`, { token, env: {} });

      expect(result.status).toBe(200);
      expect(result.body.files).toEqual(filesOf(10, 20, 30));
      expectAnonymousRequest();
    });
  }
});
