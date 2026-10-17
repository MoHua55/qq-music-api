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

// 相似歌曲与包含这首歌的歌单：都要登录（匿名时上游只给空清单）。Node 与 serverless 跑同一份案例。
// 结构按 2026-10 带会话实测整理：相似歌曲在 `vecSongNew[].songs[].track`，相关歌单在
// `vecPlaylistNew[].playlists[]`，旧的 `vecSong`／`vecPlaylist` 是空的。名称与 id 都是假数据。

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
}

const track = (id: number) => ({
  id,
  mid: `fixture-similar-${id}`,
  name: `Fixture similar song ${id}`,
  file: { media_mid: `fixture-media-${id}` },
});
const songRow = (value: unknown) => ({ track: value, tf: '', abt: '', trace: '' });
const SIMILAR = {
  retcode: 0,
  msg: '',
  vecSong: [],
  songTagInfoList: [],
  vecSongNew: [
    {
      title_template: 'Fixture template',
      title_content: 'Fixture title',
      extra_info: {},
      songs: [songRow(track(801)), songRow(track(802))],
    },
  ],
};

const playlistRow = (tid: unknown, overrides: Record<string, unknown> = {}) => ({
  tid,
  title: `Fixture related ${String(tid)}`,
  cover: 'https://y.gtimg.cn/fixture-related.jpg',
  creator: 'Fixture creator',
  songNum: 30,
  playCnt: '4321',
  ...overrides,
});
const RELATED = {
  retcode: 0,
  vecPlaylist: [],
  vecPlaylistNew: [
    {
      title_template: 'Fixture template',
      title_content: 'Fixture title',
      extra_info: {},
      playlists: [playlistRow(90001), playlistRow(90002)],
    },
  ],
};
const flattenedPlaylist = (tid: number) => ({
  tid,
  title: `Fixture related ${tid}`,
  picurl: 'https://y.gtimg.cn/fixture-related.jpg',
  songnum: 30,
  play_cnt: 4321,
  creator: { nick: 'Fixture creator' },
});

describe.each(['node', 'serverless'] as const)('song relation routes: %s', (runtime) => {
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
    replies = { GetSimilarSongs: { data: SIMILAR }, GetRelatedPlaylist: { data: RELATED } };
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
        new Request(`https://song.invalid${path}`, { headers }),
        options.env ?? { QQ_SESSION_SECRET: CONTRACT_SECRET },
      );
      return { status: result.status, body: (await result.json()) as HttpResult['body'] };
    };
  });

  afterEach(async () => {
    await mockNodeService.logout();
    jest.restoreAllMocks();
  });

  it.each([
    '/song/similar?id=801',
    '/song/related-playlists?id=801',
  ])('%s answers 401 without a session and never reaches the upstream', async (path) => {
    const result = await call(path);

    expect(result.status).toBe(401);
    expect(result.body).toMatchObject({ code: 401, errorKey: 'auth.required' });
    expect(recorded).toEqual([]);
  });

  it.each([
    '/song/similar?id=801',
    '/song/related-playlists?id=801',
  ])('%s treats a token that does not resolve as no session', async (path) => {
    const result = await call(path, { token: 'c'.repeat(64) });

    expect(result.status).toBe(401);
    expect(recorded).toEqual([]);
  });

  it.each([
    '/song/similar',
    '/song/similar?id=abc',
    '/song/similar?id=0',
    '/song/related-playlists?id=',
    '/song/related-playlists?id=1.5',
  ])('%s answers 400 for a missing or malformed id without reaching the upstream', async (path) => {
    const result = await call(path, { token });

    expect(result.status).toBe(400);
    expect(result.body.errorKey).toBe('input.invalid');
    expect(recorded).toEqual([]);
  });

  describe('/song/similar', () => {
    it('returns the similar tracks unchanged, read with the credential', async () => {
      const result = await call('/song/similar?id=801', { token });

      expect(result.status).toBe(200);
      expect(result.body).toEqual({ code: 200, songs: [track(801), track(802)] });
      expect(recorded).toHaveLength(1);
      expect(recorded[0].rpcs).toEqual([
        {
          module: 'music.recommend.TrackRelationServer',
          method: 'GetSimilarSongs',
          param: { songid: 801 },
        },
      ]);
      expect(recorded[0].comm).toMatchObject({
        ct: 11,
        authst: CONTRACT_CREDENTIAL.musickey,
        tmeLoginType: CONTRACT_CREDENTIAL.loginType,
      });
      expect(recorded[0].cookie).toContain(`qqmusic_key=${CONTRACT_CREDENTIAL.musickey}`);
    });

    it('joins every group and skips rows without a playable track', async () => {
      replies.GetSimilarSongs = {
        data: {
          ...SIMILAR,
          vecSongNew: [
            { songs: [songRow(null), songRow({ id: 803, mid: '' }), songRow(track(804))] },
            { songs: [songRow(track(805))] },
            { songs: 'x' },
          ],
        },
      };

      const result = await call('/song/similar?id=801', { token });

      expect(result.status).toBe(200);
      expect(result.body.songs).toEqual([track(804), track(805)]);
    });

    it.each([
      ['no group', { ...SIMILAR, vecSongNew: null }, 422, 'resource.not-found'],
      ['an empty group', { ...SIMILAR, vecSongNew: [{ songs: [] }] }, 422, 'resource.not-found'],
      ['a non-list', { ...SIMILAR, vecSongNew: {} }, 502, 'upstream.invalid-response'],
      [
        'no readable song',
        { ...SIMILAR, vecSongNew: [{ songs: [songRow(null)] }] },
        502,
        'upstream.invalid-response',
      ],
    ])('answers for %s', async (_label, data, status, errorKey) => {
      replies.GetSimilarSongs = { data };

      const result = await call('/song/similar?id=801', { token });

      expect(result.status).toBe(status);
      expect(result.body.errorKey).toBe(errorKey);
    });
  });

  describe('/song/related-playlists', () => {
    it('flattens the playlists like the recommended playlists, read with the credential', async () => {
      const result = await call('/song/related-playlists?id=801', { token });

      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        code: 200,
        playlists: [flattenedPlaylist(90001), flattenedPlaylist(90002)],
      });
      expect(recorded[0].rpcs).toEqual([
        {
          module: 'music.recommend.TrackRelationServer',
          method: 'GetRelatedPlaylist',
          param: { songid: 801, vecPlaylist: [] },
        },
      ]);
      expect(recorded[0].comm).toMatchObject({ ct: 11, authst: CONTRACT_CREDENTIAL.musickey });
    });

    it('skips playlists without a usable tid and leaves bad numbers out', async () => {
      replies.GetRelatedPlaylist = {
        data: {
          ...RELATED,
          vecPlaylistNew: [
            {
              playlists: [
                playlistRow(0),
                playlistRow('90003'),
                playlistRow(90004, { songNum: -1, playCnt: '12.5万', creator: 7, cover: 3 }),
              ],
            },
          ],
        },
      };

      const result = await call('/song/related-playlists?id=801', { token });

      expect(result.status).toBe(200);
      expect(result.body.playlists).toEqual([
        { tid: 90004, title: 'Fixture related 90004', picurl: '', creator: {} },
      ]);
    });

    it.each([
      ['no group', { ...RELATED, vecPlaylistNew: [] }, 422, 'resource.not-found'],
      ['a non-list', { ...RELATED, vecPlaylistNew: 'x' }, 502, 'upstream.invalid-response'],
      [
        'no readable playlist',
        { ...RELATED, vecPlaylistNew: [{ playlists: [playlistRow(-1)] }] },
        502,
        'upstream.invalid-response',
      ],
    ])('answers for %s', async (_label, data, status, errorKey) => {
      replies.GetRelatedPlaylist = { data };

      const result = await call('/song/related-playlists?id=801', { token });

      expect(result.status).toBe(status);
      expect(result.body.errorKey).toBe(errorKey);
    });
  });

  it.each([
    ['GetSimilarSongs', '/song/similar?id=801'],
    ['GetRelatedPlaylist', '/song/related-playlists?id=801'],
  ])('%s: a rejected credential answers 401', async (method, path) => {
    replies[method] = { code: 1000 };

    const result = await call(path, { token });

    expect(result.status).toBe(401);
    expect(result.body).toMatchObject({ code: 401, errorKey: 'auth.credential-invalid' });
  });

  it.each([
    ['GetSimilarSongs', '/song/similar?id=801'],
    ['GetRelatedPlaylist', '/song/related-playlists?id=801'],
  ])('%s: an unknown business code becomes 502 and keeps the number', async (method, path) => {
    replies[method] = { code: 1101 };

    const result = await call(path, { token });

    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({ errorKey: 'upstream.unknown', upstreamCode: 1101 });
  });

  it('answers 502 without the error page when the upstream HTTP request fails', async () => {
    replies.GetSimilarSongs = { httpStatus: 503 };

    const result = await call('/song/similar?id=801', { token });

    expect(result.status).toBe(502);
    expect(JSON.stringify(result.body)).not.toContain('fixture-private-error-page');
  });

  if (runtime === 'serverless') {
    it.each([
      '/song/similar?id=801',
      '/song/related-playlists?id=801',
    ])('%s needs the session secret like the other login routes', async (path) => {
      const result = await call(path, { token, env: {} });

      expect(result.status).toBe(501);
      expect(result.body.message).toContain('QQ_SESSION_SECRET is not set');
      expect(recorded).toEqual([]);
    });
  }
});
