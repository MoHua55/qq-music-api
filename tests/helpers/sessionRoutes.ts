import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import type { QrLoginService } from '../../src/services/auth/qrLogin';
import type { createContractUpstream } from './contractUpstream';

let mockUpstream: ReturnType<typeof createContractUpstream>;
let mockSessionService: QrLoginService;
let mockExecute: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

// 会话比对只替换执行器和 Node 的实例；所有 controller、服务、凭证映射都照真实路径运行。
jest.mock('axios', () => {
  const actual = jest.requireActual('axios');
  const create = actual.default.create.bind(actual.default);
  actual.default.create = (config: AxiosRequestConfig) =>
    create({
      ...config,
      adapter: async (outgoing: AxiosRequestConfig): Promise<AxiosResponse> => {
        const url = new URL(String(outgoing.url));
        for (const [key, value] of Object.entries(outgoing.params ?? {}))
          if (value != null) url.searchParams.set(key, String(value));
        const response = await mockExecute(url, {
          method: String(outgoing.method ?? 'GET').toUpperCase(),
          body: outgoing.data === undefined ? undefined : String(outgoing.data),
        });
        if (!response.ok)
          throw Object.assign(new Error('Fixture HTTP failure'), {
            response: { status: response.status },
          });
        return {
          data: await response.json(),
          status: response.status,
          statusText: 'OK',
          headers: {},
          config: outgoing,
        } as AxiosResponse;
      },
    });
  return actual;
});
jest.mock('../../src/services/auth/qrLogin.node', () => ({
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

import { createSealedSessionResolver } from '../../src/serverless/sealedResolver';
import { createMemoryDeviceContextRepository } from '../../src/services/auth/deviceContext';
import createAuthHttpClient from '../../src/services/auth/httpClient';
import {
  createMemoryAuthSessionRepository,
  createQrLoginService,
} from '../../src/services/auth/qrLogin';
import { logger } from '../../src/util/logger';
import deviceFixture from '../fixtures/contracts/device-v1.json';
import type { CatalogRuntimeName } from './catalogRoutes';
import {
  CONTRACT_CREDENTIAL,
  CONTRACT_NOW,
  CONTRACT_SECRET,
  createContractUpstream as makeUpstream,
} from './contractUpstream';
import type { ParityCallOptions } from './operationParity';

export interface SessionCall {
  endpoint: string;
  rpc: Array<{ module: string; method: string; param: Record<string, unknown> }>;
  params: Record<string, string>;
}

export const useSessionUpstream = (runtime: CatalogRuntimeName) => {
  const calls: SessionCall[] = [];
  const state: {
    businessCode?: number;
    globalCode?: number;
    data?: unknown;
    networkError?: Error;
    httpStatus?: number;
  } = {};

  const sessionOf = (expiresAt = CONTRACT_NOW + 3600000) => ({
    token: 'a'.repeat(64),
    credential: CONTRACT_CREDENTIAL,
    device: deviceFixture.device,
    expiresAt,
  });

  const resetService = (expiresAt: number) => {
    const session = sessionOf(expiresAt);
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

  beforeEach(() => {
    calls.length = 0;
    for (const key of Object.keys(state)) delete state[key as keyof typeof state];
    jest.spyOn(Date, 'now').mockReturnValue(CONTRACT_NOW);
    jest.spyOn(logger, 'error').mockImplementation(() => undefined);
    mockUpstream = makeUpstream();
    mockExecute = async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      const musicu = url.pathname === '/cgi-bin/musicu.fcg';
      const payload: Record<string, unknown> = musicu
        ? JSON.parse(url.searchParams.get('data') ?? (await request.clone().text()))
        : {};
      const descriptors = Object.entries(payload)
        .filter(([key]) => key !== 'comm')
        .map(
          ([key, value]) =>
            [
              key,
              value as { module: string; method: string; param: Record<string, unknown> },
            ] as const,
        );
      calls.push({
        endpoint: url.pathname,
        rpc: descriptors.map(([, value]) => value),
        params: Object.fromEntries([...url.searchParams].filter(([key]) => key !== 'data')),
      });
      if (state.networkError) throw state.networkError;
      if (state.httpStatus)
        return new Response('fixture-private-body', { status: state.httpStatus });
      const response = await mockUpstream.fetch(request);
      if (!musicu && !url.pathname.includes('fcg_get_profile_order_asset')) return response;
      const body = (await response.json()) as Record<string, unknown>;
      if (state.globalCode !== undefined) body.code = state.globalCode;
      if (musicu) {
        for (const [key] of descriptors) {
          const entry = body[key] as Record<string, unknown>;
          if (state.businessCode !== undefined) entry.code = state.businessCode;
          if (state.data !== undefined) entry.data = state.data;
        }
      } else {
        if (state.businessCode !== undefined) body.code = state.businessCode;
        if (state.data !== undefined) body.data = state.data;
      }
      return Response.json(body);
    };
    jest.spyOn(global, 'fetch').mockImplementation((input, init) => mockExecute(input, init));
    resetService(CONTRACT_NOW + 3600000);
  });
  afterEach(() => jest.restoreAllMocks());

  return {
    calls,
    state,
    options: async (
      mode: 'valid' | 'missing' | 'invalid' | 'expired' = 'valid',
    ): Promise<ParityCallOptions> => {
      const expiresAt = mode === 'expired' ? CONTRACT_NOW - 1 : CONTRACT_NOW + 3600000;
      const session = sessionOf(expiresAt);
      const token =
        mode === 'missing'
          ? undefined
          : mode === 'invalid'
            ? 'fixture-invalid-token'
            : runtime === 'node'
              ? session.token
              : await createSealedSessionResolver({ secrets: { current: CONTRACT_SECRET } }).issue(
                  session,
                );
      return {
        token,
        env: { QQ_SESSION_SECRET: CONTRACT_SECRET },
        service: async () => mockSessionService,
        beforeEachLeg: () => resetService(expiresAt),
      };
    },
  };
};
