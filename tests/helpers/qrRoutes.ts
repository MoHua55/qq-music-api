import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import type { QrEvent, QrLoginService, QrSessionRecord } from '../../src/services/auth/qrLogin';
import type { createContractUpstream } from './contractUpstream';

let mockUpstream: ReturnType<typeof createContractUpstream>;
let mockNodeService: QrLoginService;
let mockExecute: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

// 保留真实 controller、服务和加密，只替换上游执行器与 Node 实例。
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
          headers: outgoing.headers as Record<string, string>,
        });
        if (!response.ok)
          throw Object.assign(new Error('Fixture HTTP failure'), {
            response: { status: response.status },
          });
        const headers: Record<string, unknown> = Object.fromEntries(response.headers);
        if (response.headers.getSetCookie().length)
          headers['set-cookie'] = response.headers.getSetCookie();
        return {
          data:
            outgoing.responseType === 'arraybuffer'
              ? await response.arrayBuffer()
              : outgoing.responseType === 'text'
                ? await response.text()
                : await response.json(),
          status: response.status,
          statusText: 'OK',
          headers,
          config: outgoing,
        } as AxiosResponse;
      },
    });
  return actual;
});
jest.mock('../../src/services/auth/qrLogin.node', () => ({
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

import { deriveAndroidDevice } from '../../src/serverless/derivedDevice';
import { sealQrState } from '../../src/serverless/sealedQrState';
import { createMemoryDeviceContextRepository } from '../../src/services/auth/deviceContext';
import createAuthHttpClient from '../../src/services/auth/httpClient';
import {
  createMemoryQrSessionRepository,
  createQrLoginService,
} from '../../src/services/auth/qrLogin';
import { logger } from '../../src/util/logger';
import type { CatalogRuntimeName } from './catalogRoutes';
import {
  CONTRACT_NOW,
  CONTRACT_SECRET,
  createContractUpstream as makeUpstream,
} from './contractUpstream';
import type { ParityCallOptions } from './operationParity';

type Purpose = 'key' | 'create' | 'check' | 'cancel' | 'channels';
interface Setup {
  channel?: 'qq' | 'wechat';
  mode?: 'valid' | 'invalid' | 'expired';
  relay?: boolean;
  previous?: boolean;
  busy?: boolean;
  backoff?: boolean;
}

export const useQrUpstream = (runtime: CatalogRuntimeName) => {
  const calls: Array<Record<string, unknown>> = [];
  const state: {
    failPhase?: 'bootstrap' | 'session' | 'qr' | 'exchange' | 'profile';
    network?: boolean;
    httpStatus?: number;
    businessCode?: number;
    globalCode?: number;
    wechatCode?: number;
    events?: QrEvent[];
    relayCloseError?: boolean;
  } = {};

  beforeEach(() => {
    calls.length = 0;
    for (const key of Object.keys(state)) delete state[key as keyof typeof state];
    jest.useFakeTimers({
      now: CONTRACT_NOW,
      doNotFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'setImmediate',
        'clearImmediate',
        'nextTick',
        'queueMicrotask',
        'performance',
        'hrtime',
      ],
    });
    jest.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation((array) => {
      new Uint8Array(array!.buffer, array!.byteOffset, array!.byteLength).fill(7);
      return array;
    });
    jest.spyOn(logger, 'error').mockImplementation(() => undefined);
    jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    mockUpstream = makeUpstream();
    mockExecute = async (input, init) => {
      const request = new Request(input, init),
        url = new URL(request.url);
      const musicu = url.pathname === '/cgi-bin/musicu.fcg';
      const payload = musicu
        ? JSON.parse(url.searchParams.get('data') ?? (await request.clone().text()))
        : undefined;
      const rpc = musicu ? Object.entries(payload).filter(([key]) => key !== 'comm') : [];
      const method = (rpc[0]?.[1] as { method?: string } | undefined)?.method;
      const phase =
        url.hostname === 'api.tencentmusic.com'
          ? 'bootstrap'
          : method === 'GetSession'
            ? 'session'
            : method === 'CreateQRCode' || url.pathname.includes('/connect/qr')
              ? 'qr'
              : method === 'Login'
                ? 'exchange'
                : method === 'GetLoginUserInfo'
                  ? 'profile'
                  : undefined;
      calls.push({
        kind: 'http',
        endpoint: url.pathname,
        method: request.method,
        params: Object.fromEntries([...url.searchParams].filter(([key]) => key !== 'data')),
        ...(payload === undefined ? {} : { payload }),
        cookie: request.headers.get('cookie') ?? '',
      });
      const fail = state.failPhase === phase;
      if (fail && state.network)
        throw Object.assign(new Error('fixture-private-message'), { code: 'ECONNRESET' });
      if (fail && state.httpStatus)
        return new Response('fixture-private-body', { status: state.httpStatus });
      mockUpstream.state.wechatCode = state.wechatCode ?? 408;
      const response = await mockUpstream.fetch(request);
      if (!musicu) return response;
      const body = (await response.json()) as Record<string, any>;
      if (fail && state.globalCode !== undefined) body.code = state.globalCode;
      if (fail && state.businessCode !== undefined)
        for (const [key] of rpc) body[key].code = state.businessCode;
      return Response.json(body);
    };
    jest.spyOn(global, 'fetch').mockImplementation((input, init) => mockExecute(input, init));
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  return {
    calls,
    state,
    nodeService: () => mockNodeService,
    options: async (
      purpose: Purpose,
      setup: Setup = {},
    ): Promise<ParityCallOptions & { key: string }> => {
      const channel = setup.channel ?? 'qq',
        mode = setup.mode ?? 'valid';
      const expiresAt = mode === 'expired' ? CONTRACT_NOW - 1 : CONTRACT_NOW + 180000;
      const identifier = channel === 'qq' ? 'fixture-qr-id' : 'fixture-wx-id';
      const payload = {
        channel,
        createdAt: CONTRACT_NOW,
        expiresAt,
        identifier,
        cookies: '',
        device: {},
      };
      const key =
        mode === 'invalid'
          ? 'fixture-invalid-key'
          : runtime === 'node'
            ? 'fixture-qr-key'
            : await sealQrState(payload, CONTRACT_SECRET);
      const env = setup.previous
        ? {
            QQ_SESSION_SECRET: 'fixture-rotated-secret',
            QQ_SESSION_SECRET_PREVIOUS: CONTRACT_SECRET,
          }
        : { QQ_SESSION_SECRET: CONTRACT_SECRET };
      const relay = {
        open: async (id: string, _image: string, ttl: number) => {
          calls.push({ kind: 'relay', method: 'open', id, ttl });
        },
        image: async (id: string) => {
          calls.push({ kind: 'relay', method: 'image', id });
          return 'data:image/png;base64,iVBORw0KGgoBAgME';
        },
        poll: async (id: string, budget: number) => {
          calls.push({ kind: 'relay', method: 'poll', id, budget });
          return state.events ?? [];
        },
        close: async (id: string) => {
          calls.push({ kind: 'relay', method: 'close', id });
          if (state.relayCloseError) throw new Error('fixture-private-close');
        },
      };
      return {
        key,
        env,
        options: { qqRelay: setup.relay === false ? undefined : relay },
        service: async () => mockNodeService,
        responseHeaders: ['set-cookie', 'retry-after'],
        beforeEachLeg: async () => {
          // 每条腿重建真实服务，避免取消、回退计数或授权改变下一次的状态。
          mockUpstream = makeUpstream();
          const record: QrSessionRecord = {
            key,
            channel,
            state: setup.busy ? 'exchanging' : 'created',
            createdAt: CONTRACT_NOW,
            expiresAt,
            ...(channel === 'wechat' ? { identifier } : {}),
          };
          mockNodeService = createQrLoginService({
            http: createAuthHttpClient(),
            createSessionHttp: createAuthHttpClient,
            deviceRepository: createMemoryDeviceContextRepository(
              await deriveAndroidDevice(env.QQ_SESSION_SECRET),
            ),
            qrSessionRepository: createMemoryQrSessionRepository(
              purpose === 'key' ? (setup.busy ? [record] : []) : mode === 'invalid' ? [] : [record],
            ),
            randomBytes: (size) => Buffer.alloc(size, 7),
            listen: (id, callback, ttl) => {
              calls.push({ kind: 'listener', method: 'open', id, ttl });
              const listener = mockUpstream.listen(id, callback, ttl);
              return {
                ...listener,
                close: () => {
                  calls.push({ kind: 'listener', method: 'close', id });
                  listener.close();
                },
              };
            },
          });
          if (runtime === 'node') {
            const createSession = mockNodeService.createSession.bind(mockNodeService);
            jest.spyOn(mockNodeService, 'createSession').mockImplementation((channel) => {
              calls.push({ kind: 'service', method: 'createSession', channel });
              return createSession(channel);
            });
          }
          if (setup.backoff)
            (
              mockNodeService as QrLoginService & {
                failBootstrap(error: unknown, stage: string): unknown;
              }
            ).failBootstrap(
              Object.assign(new Error('fixture-private-message'), { code: 'ECONNRESET' }),
              'device-bootstrap',
            );
          if (runtime === 'node' && ['check', 'cancel'].includes(purpose) && mode === 'valid') {
            const failPhase = state.failPhase;
            delete state.failPhase;
            try {
              await mockNodeService.createQr(key);
            } finally {
              state.failPhase = failPhase;
            }
            if (purpose === 'check' && channel === 'qq' && state.events)
              await mockUpstream.observe(...state.events);
          }
        },
      };
    },
  };
};
