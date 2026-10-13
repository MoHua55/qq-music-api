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

// 电台路由：一律要先登录。清单摊平成分组＋电台；取歌时 99 走猜你喜欢的接口、其他电台走网页电台接口，
// 回包和猜你喜欢同形。Node 与 serverless 跑同一份案例；结构按 2026-10 网页实测整理，名称与 id 都是假数据。

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
  httpStatus?: number;
  globalCode?: number;
  code?: number;
  data?: unknown;
}
interface HttpResult {
  status: number;
  body: Record<string, any>;
  headers: Record<string, string>;
}

const TRACKS = [
  { id: 101, mid: 'fixture-radio-a', name: 'Fixture radio song A' },
  { id: 102, mid: 'fixture-radio-b', name: 'Fixture radio song B' },
];
const EXTRAS = [{ reason: 'Fixture reason A' }, { reason: 'Fixture reason B' }];

const radio = (id: unknown, overrides: Record<string, unknown> = {}) => ({
  id,
  title: `Fixture radio ${String(id)}`,
  listenDesc: 'Fixture listeners',
  listenNum: 1234,
  tjreport: 'fixture-report',
  pic_url: 'https://y.gtimg.cn/fixture-radio.jpg',
  rec_type: 0,
  subscript_picurl: '',
  abt: '',
  ...overrides,
});

const RADIO_LIST = {
  radio_list: [
    { id: 48, title: 'Fixture hot', group_type: 0, list: [radio(99), radio(101)], tjreport: '' },
    { id: 44, title: 'Fixture recent', group_type: 0, list: [], tjreport: '' },
  ],
  title: 'Fixture all',
  freshtime: 0,
};

describe.each(['node', 'serverless'] as const)('radio routes: %s', (runtime) => {
  let token: string;
  let recorded: Recorded[];
  let replies: Record<string, Reply>;
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
    const reply = replies[rpcs[0]?.method] ?? {};
    if (reply.httpStatus && reply.httpStatus >= 400)
      return new Response('fixture-private-error-page', { status: reply.httpStatus });
    return Response.json({
      code: reply.globalCode ?? 0,
      req_0: { code: reply.code ?? 0, data: reply.data ?? {} },
    });
  };

  beforeEach(async () => {
    jest.spyOn(Date, 'now').mockReturnValue(CONTRACT_NOW);
    for (const level of ['debug', 'warn', 'error'] as const)
      jest.spyOn(logger, level).mockImplementation(() => undefined);
    jest.spyOn(global, 'fetch').mockImplementation(upstream);
    recorded = [];
    replies = {
      GetRadiolist: { data: RADIO_LIST },
      get_radio_track: { data: { id: 99, tracks: TRACKS, extras: EXTRAS } },
      GetRadiosonglist: { data: { id: 101, track_list: TRACKS } },
    };
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
        return { status: result.status, body: result.body, headers: result.headers };
      }
      const result = await handleRequest(
        new Request(`https://radio.invalid${path}`, { headers }),
        options.env ?? { QQ_SESSION_SECRET: CONTRACT_SECRET },
      );
      return {
        status: result.status,
        body: (await result.json()) as HttpResult['body'],
        headers: Object.fromEntries(result.headers),
      };
    };
  });

  afterEach(async () => {
    await mockNodeService.logout();
    jest.restoreAllMocks();
  });

  it.each([
    '/radio/list',
    '/radio/tracks?id=99',
    '/radio/tracks?id=101',
  ])('%s answers 401 without a session and never reaches the upstream', async (path) => {
    for (const options of [{}, { token: 'c'.repeat(64) }]) {
      const result = await call(path, options);
      expect(result.status).toBe(401);
      expect(result.body).toMatchObject({ code: 401, errorKey: 'auth.required' });
    }
    expect(recorded).toEqual([]);
  });

  if (runtime === 'serverless')
    it.each([
      '/radio/list',
      '/radio/tracks?id=99',
    ])('%s answers 501 when the deployment has no session secret', async (path) => {
      const result = await call(path, { token, env: {} });
      expect(result.status).toBe(501);
      expect(recorded).toEqual([]);
    });

  describe('/radio/list', () => {
    it('flattens the groups with the credential and keeps an empty group', async () => {
      const result = await call('/radio/list', { token });

      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        code: 200,
        groups: [
          {
            id: 48,
            title: 'Fixture hot',
            radios: [
              {
                id: 99,
                title: 'Fixture radio 99',
                picurl: 'https://y.gtimg.cn/fixture-radio.jpg',
                listenNum: 1234,
              },
              {
                id: 101,
                title: 'Fixture radio 101',
                picurl: 'https://y.gtimg.cn/fixture-radio.jpg',
                listenNum: 1234,
              },
            ],
          },
          { id: 44, title: 'Fixture recent', radios: [] },
        ],
      });
      expect(recorded).toHaveLength(1);
      expect(recorded[0].rpcs).toEqual([
        {
          module: 'pf.radiosvr',
          method: 'GetRadiolist',
          param: { uin: CONTRACT_CREDENTIAL.str_musicid },
        },
      ]);
      expect(recorded[0].comm).toMatchObject({ ct: 11, authst: CONTRACT_CREDENTIAL.musickey });
      expect(recorded[0].cookie).toContain(`qqmusic_key=${CONTRACT_CREDENTIAL.musickey}`);
    });

    it('skips radios and groups without a usable id and leaves missing numbers out', async () => {
      replies.GetRadiolist = {
        data: {
          radio_list: [
            {
              id: 48,
              title: 'Fixture hot',
              list: [radio(0), radio('101'), radio(102, { listenNum: 'many', pic_url: null })],
            },
            { id: null, title: 'Fixture broken', list: [radio(103)] },
            { id: 49, title: 'Fixture no list', list: null },
          ],
        },
      };

      const result = await call('/radio/list', { token });

      expect(result.status).toBe(200);
      expect(result.body.groups).toEqual([
        {
          id: 48,
          title: 'Fixture hot',
          radios: [{ id: 102, title: 'Fixture radio 102', picurl: '' }],
        },
        { id: 49, title: 'Fixture no list', radios: [] },
      ]);
    });

    it.each([
      ['an empty list', { radio_list: [] }],
      ['a null list', { radio_list: null }],
    ])('answers 422 not-found when the upstream succeeds with %s', async (_label, data) => {
      replies.GetRadiolist = { data };

      const result = await call('/radio/list', { token });

      expect(result.status).toBe(422);
      expect(result.body).toMatchObject({ code: 422, errorKey: 'resource.not-found' });
    });

    it.each([
      ['radio_list is not a list', { radio_list: { 0: {} } }],
      ['no group has a usable id', { radio_list: [{ id: 'x', list: [] }] }],
    ])('answers 502 invalid-response when %s', async (_label, data) => {
      replies.GetRadiolist = { data };

      const result = await call('/radio/list', { token });

      expect(result.status).toBe(502);
      expect(result.body.errorKey).toBe('upstream.invalid-response');
    });

    it('answers 401 when the upstream rejects the credential', async () => {
      replies.GetRadiolist = { code: 1000 };

      const result = await call('/radio/list', { token });

      expect(result.status).toBe(401);
      expect(result.body).toMatchObject({
        errorKey: 'auth.credential-invalid',
        upstreamCode: 1000,
      });
      expect(JSON.stringify(result.body)).not.toContain(CONTRACT_CREDENTIAL.musickey);
    });

    it('answers 502 for an unregistered business code and keeps the number', async () => {
      replies.GetRadiolist = { code: 2001 };

      const result = await call('/radio/list', { token });

      expect(result.status).toBe(502);
      expect(result.body).toMatchObject({ errorKey: 'upstream.unknown', upstreamCode: 2001 });
    });
  });

  describe('/radio/tracks', () => {
    it('reads radio 99 through the guess-you-like call and keeps its reasons', async () => {
      const result = await call('/radio/tracks?id=99', { token });

      expect(result.status).toBe(200);
      expect(result.body).toEqual({ code: 200, songs: TRACKS, extras: EXTRAS });
      expect(recorded[0].rpcs).toEqual([
        {
          module: 'music.radioProxy.MbTrackRadioSvr',
          method: 'get_radio_track',
          param: { id: 99, firstplay: 1, num: 15 },
        },
      ]);
    });

    it('reads any other radio through the web radio call', async () => {
      const result = await call('/radio/tracks?id=101', { token });

      expect(result.status).toBe(200);
      expect(result.body).toEqual({ code: 200, songs: TRACKS });
      expect(recorded[0].rpcs).toEqual([
        {
          module: 'pf.radiosvr',
          method: 'GetRadiosonglist',
          param: { id: 101, firstplay: 0, num: 9 },
        },
      ]);
      expect(recorded[0].comm).toMatchObject({ ct: 11, authst: CONTRACT_CREDENTIAL.musickey });
    });

    it.each([
      '',
      '?id=',
      '?id=abc',
      '?id=0',
      '?id=-1',
      '?id=1.5',
      '?id=99abc',
    ])('answers 400 for a missing or malformed id %s without reaching the upstream', async (query) => {
      const result = await call(`/radio/tracks${query}`, { token });

      expect(result.status).toBe(400);
      expect(result.body).toMatchObject({ code: 400, errorKey: 'input.invalid' });
      expect(recorded).toEqual([]);
    });

    it.each([
      ['an empty list', []],
      ['a null list', null],
    ])('answers 422 when another radio succeeds with %s', async (_label, list) => {
      replies.GetRadiosonglist = { data: { id: 101, track_list: list } };

      const result = await call('/radio/tracks?id=101', { token });

      expect(result.status).toBe(422);
      expect(result.body.errorKey).toBe('resource.not-found');
    });

    it('answers 502 invalid-response when track_list is not a list', async () => {
      replies.GetRadiosonglist = { data: { track_list: 'x' } };

      const result = await call('/radio/tracks?id=101', { token });

      expect(result.status).toBe(502);
      expect(result.body.errorKey).toBe('upstream.invalid-response');
    });

    it.each([
      ['GetRadiosonglist', '/radio/tracks?id=101'],
      ['get_radio_track', '/radio/tracks?id=99'],
    ])('answers 401 when %s rejects the credential', async (method, path) => {
      replies[method] = { code: 1000 };

      const result = await call(path, { token });

      expect(result.status).toBe(401);
      expect(result.body.errorKey).toBe('auth.credential-invalid');
    });
  });
});
