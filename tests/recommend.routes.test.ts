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

// 新的推荐路由：Node 与 serverless 跑同一份案例，只替换对外的 fetch。
// 上游结构按 2026-10 实测整理（键名、类型、层级），歌名、歌单名与 id 都是假数据。

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
  { id: 101, mid: 'fixture-fm-a', name: 'Fixture FM A', file: { media_mid: 'fixture-media-a' } },
  { id: 102, mid: 'fixture-fm-b', name: 'Fixture FM B', file: { media_mid: 'fixture-media-b' } },
];
const EXTRAS = [{ reason: 'Fixture reason A' }, { reason: 'Fixture reason B' }];

const feedEntry = (tid: unknown, overrides: Record<string, unknown> = {}) => ({
  Playlist: {
    basic: {
      tid,
      dirid: 3,
      title: `Fixture recommended ${String(tid)}`,
      desc: 'Fixture description',
      cover: {
        small_url: 'https://y.gtimg.cn/fixture-small.jpg',
        medium_url: 'https://y.gtimg.cn/fixture-medium.jpg',
        big_url: 'https://y.gtimg.cn/fixture-big.jpg',
        default_url: 'https://y.gtimg.cn/fixture-default.jpg',
      },
      creator: {
        uin: '30001',
        encrypt_uin: 'fixture-creator-encrypted',
        nick: 'Fixture creator',
        avatar: 'https://y.gtimg.cn/fixture-avatar.jpg',
        identity: 0,
      },
      play_cnt: 4321,
      song_cnt: 30,
      fav_cnt: 12,
      is_official: false,
      ...overrides,
    },
    content: { v_item: [] },
  },
  WhereFrom: 'fixture',
});

const flattened = (tid: number) => ({
  tid,
  title: `Fixture recommended ${tid}`,
  desc: 'Fixture description',
  picurl: 'https://y.gtimg.cn/fixture-default.jpg',
  songnum: 30,
  play_cnt: 4321,
  creator: {
    uin: '30001',
    encrypt_uin: 'fixture-creator-encrypted',
    nick: 'Fixture creator',
    avatar: 'https://y.gtimg.cn/fixture-avatar.jpg',
  },
});

describe.each(['node', 'serverless'] as const)('recommendation routes: %s', (runtime) => {
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
    jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn(logger, 'error').mockImplementation(() => undefined);
    jest.spyOn(global, 'fetch').mockImplementation(upstream);
    recorded = [];
    replies = {
      get_radio_track: { data: { id: 99, name: 'Fixture radio', tracks: TRACKS, extras: EXTRAS } },
      GetRecommendFeed: {
        data: {
          Msg: '',
          List: [feedEntry(80001), feedEntry(80002)],
          HasMore: true,
          FromLimit: 400,
        },
      },
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
        new Request(`https://recommend.invalid${path}`, { headers }),
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

  describe('/user/guess-you-like', () => {
    it('answers 401 without a session and never reaches the upstream', async () => {
      const result = await call('/user/guess-you-like');

      expect(result.status).toBe(401);
      expect(result.body).toMatchObject({
        code: 401,
        errorKey: 'auth.required',
        message: 'Login required',
      });
      expect(recorded).toEqual([]);
    });

    it('treats a token that does not resolve as no session', async () => {
      const result = await call('/user/guess-you-like', { token: 'c'.repeat(64) });

      expect(result.status).toBe(401);
      expect(result.body.errorKey).toBe('auth.required');
      expect(recorded).toEqual([]);
    });

    it('returns the upstream tracks unchanged, with the reasons beside them', async () => {
      const result = await call('/user/guess-you-like', { token });

      expect(result.status).toBe(200);
      expect(result.body).toEqual({ code: 200, songs: TRACKS, extras: EXTRAS });
      expect(recorded).toHaveLength(1);
      expect(recorded[0].rpcs).toEqual([
        {
          module: 'music.radioProxy.MbTrackRadioSvr',
          method: 'get_radio_track',
          param: { id: 99, firstplay: 1, num: 15 },
        },
      ]);
      expect(recorded[0].comm).toMatchObject({
        ct: 11,
        qq: CONTRACT_CREDENTIAL.str_musicid,
        authst: CONTRACT_CREDENTIAL.musickey,
        tmeLoginType: CONTRACT_CREDENTIAL.loginType,
      });
      expect(recorded[0].cookie).toContain(`qqmusic_key=${CONTRACT_CREDENTIAL.musickey}`);
    });

    it('leaves extras out when the upstream gives none', async () => {
      replies.get_radio_track = { data: { id: 99, tracks: TRACKS, extras: null } };

      const result = await call('/user/guess-you-like', { token });

      expect(result.status).toBe(200);
      expect(result.body).toEqual({ code: 200, songs: TRACKS });
    });

    it.each([
      ['an empty list', []],
      ['a null list', null],
    ])('answers 422 not-found when the upstream succeeds with %s', async (_label, tracks) => {
      replies.get_radio_track = { data: { id: 99, tracks } };

      const result = await call('/user/guess-you-like', { token });

      expect(result.status).toBe(422);
      expect(result.body).toMatchObject({
        code: 422,
        kind: 'not-found',
        errorKey: 'resource.not-found',
      });
    });

    it('answers 401 when the upstream rejects the credential', async () => {
      replies.get_radio_track = { code: 1000 };

      const result = await call('/user/guess-you-like', { token });

      expect(result.status).toBe(401);
      expect(result.body).toMatchObject({
        code: 401,
        errorKey: 'auth.credential-invalid',
        upstreamCode: 1000,
      });
    });

    it('answers 429 for the upstream rate-limit code without inventing a cooldown', async () => {
      replies.get_radio_track = { code: 2001 };

      const result = await call('/user/guess-you-like', { token });

      expect(result.status).toBe(429);
      expect(result.body).toMatchObject({ code: 429, errorKey: 'upstream.rate-limited' });
      expect(result.body).not.toHaveProperty('retryAfterMs');
      expect(result.headers['retry-after']).toBeUndefined();
    });

    it('answers 502 for an unknown business code and keeps the number', async () => {
      replies.get_radio_track = { code: 22006 };

      const result = await call('/user/guess-you-like', { token });

      expect(result.status).toBe(502);
      expect(result.body).toMatchObject({
        code: 502,
        errorKey: 'upstream.unknown',
        upstreamCode: 22006,
      });
    });

    it('answers 502 without the error page when the upstream HTTP request fails', async () => {
      replies.get_radio_track = { httpStatus: 403 };

      const result = await call('/user/guess-you-like', { token });

      expect(result.status).toBe(502);
      expect(result.body).toMatchObject({ errorKey: 'upstream.http', upstreamHttpStatus: 403 });
      expect(JSON.stringify(result.body)).not.toContain('fixture-private-error-page');
    });

    it('answers 502 invalid-response when tracks is not a list', async () => {
      replies.get_radio_track = { data: { id: 99, tracks: { 0: TRACKS[0] } } };

      const result = await call('/user/guess-you-like', { token });

      expect(result.status).toBe(502);
      expect(result.body.errorKey).toBe('upstream.invalid-response');
    });

    it('never echoes the credential in a failure', async () => {
      replies.get_radio_track = { code: 1000 };

      const result = await call('/user/guess-you-like', { token });

      expect(JSON.stringify(result.body)).not.toContain(CONTRACT_CREDENTIAL.musickey);
    });
  });

  describe('/recommend/playlists', () => {
    it('reads anonymously without a session, with the web comm and no cookie', async () => {
      const result = await call('/recommend/playlists');

      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        code: 200,
        playlists: [flattened(80001), flattened(80002)],
        more: true,
      });
      expect(recorded).toHaveLength(1);
      expect(recorded[0].rpcs).toEqual([
        {
          module: 'music.playlist.PlaylistSquare',
          method: 'GetRecommendFeed',
          param: { From: 0, Size: 25 },
        },
      ]);
      expect(recorded[0].comm).toEqual({ ct: 24, cv: 0 });
      expect(recorded[0].cookie).toBeNull();
    });

    it('uses the credential when the session resolves', async () => {
      const result = await call('/recommend/playlists', { token });

      expect(result.status).toBe(200);
      expect(recorded[0].comm).toMatchObject({
        ct: 11,
        authst: CONTRACT_CREDENTIAL.musickey,
        tmeLoginType: CONTRACT_CREDENTIAL.loginType,
      });
      expect(recorded[0].cookie).toContain(`qqmusic_key=${CONTRACT_CREDENTIAL.musickey}`);
    });

    it('falls back to anonymous when the token does not resolve', async () => {
      const result = await call('/recommend/playlists', { token: 'c'.repeat(64) });

      expect(result.status).toBe(200);
      expect(recorded[0].comm).toEqual({ ct: 24, cv: 0 });
      expect(recorded[0].cookie).toBeNull();
    });

    it('answers 401 when a resolved credential is rejected', async () => {
      replies.GetRecommendFeed = { code: 1000 };

      const result = await call('/recommend/playlists', { token });

      expect(result.status).toBe(401);
      expect(result.body).toMatchObject({ code: 401, errorKey: 'auth.credential-invalid' });
      expect(recorded).toHaveLength(1);
    });

    it.each([
      ['5', 5],
      ['60', 60],
      ['61', 60],
      ['1000', 60],
      ['0', 25],
      ['-3', 25],
      ['abc', 25],
    ])('reads limit=%s as Size %d', async (limit, size) => {
      await call(`/recommend/playlists?limit=${limit}`);

      expect(recorded[0].rpcs[0].param).toEqual({ From: 0, Size: size });
    });

    it('passes HasMore through as more', async () => {
      replies.GetRecommendFeed = { data: { List: [feedEntry(80001)], HasMore: false } };

      const result = await call('/recommend/playlists');

      expect(result.body.more).toBe(false);
    });

    it('skips entries without a usable tid and leaves missing numbers out', async () => {
      replies.GetRecommendFeed = {
        data: {
          List: [
            feedEntry(0),
            feedEntry('not-a-number'),
            { WhereFrom: 'fixture' },
            null,
            feedEntry(80003, { play_cnt: undefined, song_cnt: null, cover: { big_url: 'b.jpg' } }),
          ],
          HasMore: true,
        },
      };

      const result = await call('/recommend/playlists');

      expect(result.status).toBe(200);
      expect(result.body.playlists).toHaveLength(1);
      expect(result.body.playlists[0]).toMatchObject({ tid: 80003, picurl: 'b.jpg' });
      expect(result.body.playlists[0]).not.toHaveProperty('play_cnt');
      expect(result.body.playlists[0]).not.toHaveProperty('songnum');
    });

    it('answers 422 not-found when no playlist is usable', async () => {
      replies.GetRecommendFeed = { data: { List: [], HasMore: false } };

      const result = await call('/recommend/playlists');

      expect(result.status).toBe(422);
      expect(result.body).toMatchObject({ code: 422, errorKey: 'resource.not-found' });
    });

    it('answers 502 invalid-response when List is not a list', async () => {
      replies.GetRecommendFeed = { data: { List: { 0: feedEntry(80001) }, HasMore: true } };

      const result = await call('/recommend/playlists');

      expect(result.status).toBe(502);
      expect(result.body.errorKey).toBe('upstream.invalid-response');
    });

    it('answers 502 with the number for a parameter rejection', async () => {
      replies.GetRecommendFeed = { code: 1101, data: { Msg: '', List: null } };

      const result = await call('/recommend/playlists');

      expect(result.status).toBe(502);
      expect(result.body).toMatchObject({ errorKey: 'upstream.unknown', upstreamCode: 1101 });
    });
  });

  if (runtime === 'serverless') {
    it('still serves anonymous recommended playlists without a session secret', async () => {
      const result = await call('/recommend/playlists', { token, env: {} });

      expect(result.status).toBe(200);
      expect(recorded[0].comm).toEqual({ ct: 24, cv: 0 });
      expect(recorded[0].cookie).toBeNull();
    });

    it('treats guess-you-like as a login route that needs the session secret', async () => {
      const result = await call('/user/guess-you-like', { token, env: {} });

      expect(result.status).toBe(501);
      // 和其他登录路由同一句；没有实现的路由回的是另一句
      expect(result.body.message).toContain('QQ_SESSION_SECRET is not set');
      expect(recorded).toEqual([]);
    });
  }
});
