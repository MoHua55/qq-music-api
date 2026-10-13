import type { AxiosRequestConfig } from 'axios';
import logoutOperationController from '../src/controllers/logoutOperation';
import { getOwnedPlaylistSongs } from '../src/routes/operations/getOwnedPlaylistSongs';
import { getUserAlbums } from '../src/routes/operations/getUserAlbums';
import { getUserLikedSongs } from '../src/routes/operations/getUserLikedSongs';
import { getUserPlaylist } from '../src/routes/operations/getUserPlaylist';
import { loginStatus } from '../src/routes/operations/loginStatus';
import { logout as logoutOperation } from '../src/routes/operations/logout';
import { userDetail as userDetailOperation } from '../src/routes/operations/userDetail';
import { operationRoute } from '../src/serverless/operationRoute';
import type { QrLoginService } from '../src/services/auth/qrLogin';
import type { createContractUpstream } from './helpers/contractUpstream';

let mockUpstream: ReturnType<typeof createContractUpstream>;
let mockSessionService: QrLoginService;

// 所有宿主都走真实服务，只替换 HTTP 执行器与 Node 的服务实例。
jest.mock('axios', () => {
  const actual = jest.requireActual('axios');
  const create = actual.default.create.bind(actual.default);
  actual.default.create = (config: AxiosRequestConfig) =>
    create({ ...config, adapter: (request: AxiosRequestConfig) => mockUpstream.axios(request) });
  return actual;
});
jest.mock('../src/services/auth/qrLogin.node', () => ({
  __esModule: true,
  get default() {
    return mockSessionService;
  },
  get qrLoginService() {
    return mockSessionService;
  },
  configureAuthSessionRepository: (
    repository: Parameters<QrLoginService['configureAuthSessionRepository']>[0],
  ) => mockSessionService.configureAuthSessionRepository(repository),
}));

import type { OperationHandler } from '../src/routes/operations/types';
import { handleRequest } from '../src/serverless';
import { createFetchLegacyTransport } from '../src/serverless/fetchLegacyTransport';
import { failureResponse } from '../src/serverless/response';
import { createSealedSessionResolver } from '../src/serverless/sealedResolver';
import { createMemoryDeviceContextRepository } from '../src/services/auth/deviceContext';
import createAuthHttpClient from '../src/services/auth/httpClient';
import {
  createMemoryAuthSessionRepository,
  createQrLoginService,
} from '../src/services/auth/qrLogin';
import { setLegacyHttpTransport } from '../src/services/httpTransport';
import { logger } from '../src/util/logger';
import deviceFixture from './fixtures/contracts/device-v1.json';
import { CATALOG_RUNTIMES, type CatalogRuntimeName } from './helpers/catalogRoutes';
import {
  CONTRACT_ALBUMS,
  CONTRACT_CREDENTIAL,
  CONTRACT_NOW,
  CONTRACT_PLAYLISTS,
  CONTRACT_PROFILE,
  CONTRACT_SECRET,
  CONTRACT_SONGS,
  createContractUpstream as makeUpstream,
} from './helpers/contractUpstream';
import { createParityRunner } from './helpers/operationParity';

const preparedRoutes: Record<string, OperationHandler> = {
  '/login/status': loginStatus,
  '/user/detail': userDetailOperation,
  '/user/playlist': getUserPlaylist,
  '/user/albums': getUserAlbums,
  '/user/liked-songs': getUserLikedSongs,
  '/user/playlist-detail': getOwnedPlaylistSongs,
  '/logout': logoutOperation,
};

const STORED_TOKEN = 'a'.repeat(64);
const session = {
  token: STORED_TOKEN,
  credential: CONTRACT_CREDENTIAL,
  device: deviceFixture.device,
  expiresAt: CONTRACT_NOW + 3600000,
};

const resetService = (runtime: CatalogRuntimeName) => {
  mockSessionService = createQrLoginService({
    http: createAuthHttpClient(),
    createSessionHttp: createAuthHttpClient,
    deviceRepository: createMemoryDeviceContextRepository(deviceFixture.device),
    ...(runtime === 'node'
      ? { authSessionRepository: createMemoryAuthSessionRepository([session]) }
      : {
          sessionResolver: createSealedSessionResolver({ secrets: { current: CONTRACT_SECRET } }),
        }),
  });
};

// 测试专用消费者：证明转接后的 token 和 service 真正能取到登录资料。
const detailOperation: OperationHandler = async (request) => {
  const profile = await (await request.service()).getUserDetail(request.token);
  return {
    status: profile ? 200 : 401,
    headers: {},
    body: profile ? { code: 200, profile } : { code: 401, message: 'Login required' },
  };
};
const detailParity = createParityRunner(
  { name: 'userDetail', node: '/user/detail', serverless: '/user/detail' },
  {
    operation: detailOperation,
  },
);

const logoutParity = createParityRunner(
  { name: 'logout', node: '/logout', serverless: '/logout' },
  {
    operation: logoutOperation,
    operationNode: logoutOperationController,
  },
);

describe.each(CATALOG_RUNTIMES)('会话路由比对工具准备（%s）', (runtime) => {
  let token: string;
  beforeEach(async () => {
    jest.spyOn(Date, 'now').mockReturnValue(CONTRACT_NOW);
    jest.spyOn(logger, 'error').mockImplementation(() => undefined);
    mockUpstream = makeUpstream();
    jest.spyOn(global, 'fetch').mockImplementation(mockUpstream.fetch);
    resetService(runtime);
    token =
      runtime === 'node'
        ? STORED_TOKEN
        : await createSealedSessionResolver({ secrets: { current: CONTRACT_SECRET } }).issue(
            session,
          );
  });
  afterEach(() => jest.restoreAllMocks());

  const options = (sentToken: string | undefined = token) => ({
    token: sentToken,
    env: { QQ_SESSION_SECRET: CONTRACT_SECRET },
    service: async () => mockSessionService,
    beforeEachLeg: () => resetService(runtime),
  });

  it('同一会话跑旧实现、测试消费者和真实宿主，每条腿都能读资料', async () => {
    const legs = await detailParity(runtime, '/user/detail', mockUpstream.calls, options());
    expect(legs.operation.status).toBe(200);
    expect(legs.operation.body).toEqual({ code: 200, profile: CONTRACT_PROFILE });
    expect(legs.operation.calls.map((call) => call.method)).toEqual(['GetLoginUserInfo']);
    expect(legs.host).toEqual(legs.operation);
  });

  it('同一个 runner 的下一次请求不沿用上次 token', async () => {
    await detailParity(runtime, '/user/detail', mockUpstream.calls, options());
    const legs = await detailParity(runtime, '/user/detail', mockUpstream.calls, {
      ...options(),
      token: undefined,
    });
    expect(legs.operation).toEqual({
      status: 401,
      body: { code: 401, message: 'Login required' },
      calls: [],
    });
    expect(legs.host).toEqual(legs.operation);
  });

  it('上游拒绝凭证的 401 在共用处理与真实宿主里一致', async () => {
    mockUpstream.state.credentialCode = 1000;
    const legs = await detailParity(runtime, '/user/detail', mockUpstream.calls, options());
    expect(legs.operation.status).toBe(401);
    expect(legs.operation.calls.map((call) => call.method)).toEqual(['GetLoginUserInfo']);
    expect(legs.host).toEqual(legs.operation);
  });

  if (runtime === 'serverless')
    it('没有提供密钥时真实宿主仍回配置 501，不被测试服务绕过', async () => {
      const legs = await detailParity(runtime, '/user/detail', mockUpstream.calls, {
        ...options(),
        env: {},
      });
      expect(legs.operation.status).toBe(200);
      expect(legs.host.status).toBe(501);
      expect(legs.host.calls).toEqual([]);
      expect(legs.host.body).toEqual({
        code: 501,
        message:
          'QQ_SESSION_SECRET is not set, so this deployment cannot hold a session. Catalog routes still work.',
      });
    });

  it('登出前每条腿重建会话，并比较实际清除 Cookie 的标头', async () => {
    const logoutSpy = jest.fn();
    const legs = await logoutParity(runtime, '/logout', mockUpstream.calls, {
      ...options(),
      responseHeaders: ['set-cookie'],
      beforeEachLeg: () => {
        resetService(runtime);
        const original = mockSessionService.logout.bind(mockSessionService);
        jest.spyOn(mockSessionService, 'logout').mockImplementation(async (value) => {
          expect(await mockSessionService.resolveSession(value)).not.toBeNull();
          logoutSpy(value);
          return original(value);
        });
      },
    });
    expect(legs.operation.status).toBe(200);
    expect(legs.operation.body).toEqual({ code: 200 });
    expect(legs.operation.headers?.['set-cookie']).toHaveLength(1);
    expect(legs.host).toEqual(legs.operation);
    expect(logoutSpy).toHaveBeenCalledTimes(runtime === 'node' ? 2 : 1);
  });

  const movedCases = [
    {
      route: '/login/status',
      path: '/login/status',
      body: { code: 200, data: { profile: CONTRACT_PROFILE } },
    },
    { route: '/user/detail', path: '/user/detail', body: { code: 200, profile: CONTRACT_PROFILE } },
    {
      route: '/user/playlist',
      path: '/user/playlist',
      body: { code: 200, playlist: CONTRACT_PLAYLISTS, total: 1, more: false },
    },
    {
      route: '/user/albums',
      path: '/user/albums?offset=0&limit=1',
      body: { code: 200, albums: CONTRACT_ALBUMS, total: 1, more: false },
    },
    {
      route: '/user/liked-songs',
      path: '/user/liked-songs?offset=1&limit=1',
      body: { code: 200, songs: [CONTRACT_SONGS[1]], total: 3, more: true },
    },
    {
      route: '/user/playlist-detail',
      path: '/user/playlist-detail?tid=70001&dirid=10&offset=1&limit=1',
      body: { code: 200, songs: [CONTRACT_SONGS[1]], total: 3, more: true },
    },
    { route: '/logout', path: '/logout', body: { code: 200 } },
  ] as const;

  if (runtime === 'serverless')
    it.each(movedCases)('共用的 $route 与真实入口回包及上游请求一致', async (fixture) => {
      resetService(runtime);
      setLegacyHttpTransport(createFetchLegacyTransport());
      mockUpstream.calls.length = 0;
      let common: Response;
      try {
        common = await operationRoute(preparedRoutes[fixture.route])({
          url: new URL(`https://fixture.invalid${fixture.path}`),
          params: {},
          token,
          service: async () => mockSessionService,
        });
      } catch (error) {
        common = failureResponse(error);
      }
      const commonBody = await common.json();
      const calls = mockUpstream.calls.slice();
      mockUpstream.calls.length = 0;
      const host = await handleRequest(
        new Request(`https://fixture.invalid${fixture.path}`, {
          headers: { 'X-QQ-Session': token },
        }),
        { QQ_SESSION_SECRET: CONTRACT_SECRET },
      );
      expect(common.status).toBe(200);
      expect(commonBody).toEqual(fixture.body);
      expect(host.status).toBe(common.status);
      expect(await host.json()).toEqual(commonBody);
      expect(host.headers.get('set-cookie')).toBe(common.headers.get('set-cookie'));
      expect(mockUpstream.calls).toEqual(calls);
    });
});
