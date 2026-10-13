import getAlbumInfoService from '../services/album/getAlbumInfo';
import type { AuthHttpClient } from '../services/auth/httpClient';
import type { QrLoginService } from '../services/auth/qrLogin';
import { createQrLoginService, QrLoginServiceError } from '../services/auth/qrLogin';
import { describeRuntimeCapabilities } from '../services/runtimeCapabilities';
import songListDetailService from '../services/songLists/songListDetail';
import u_common from '../services/u_common';
import { toUserPlaylistBody, userPlaylistOptionsOf } from '../services/user/userPlaylistResponse';
import { deriveAndroidDevice } from './derivedDevice';
import { createFetchAuthHttpClient } from './fetchAuthHttpClient';
import type { ServerlessEnv, ServerlessOptions } from './index';
import {
  CHECK_BUDGET_MS,
  capabilitiesFor,
  capturingQrSessionRepository,
  driversFor,
  qrDeviceRepositoryFor,
  replayedRecord,
  replayQrSessionRepository,
  secretsOf,
  tokenFromCookieString,
} from './qrRuntime';
import { AUTH_COOKIE_NAME, json, LOGIN_REQUIRED } from './response';
import { openQrState, sealQrState } from './sealedQrState';
import { createSealedSessionResolver } from './sealedResolver';

// src/serverless/legacyRoutes.ts
//
// 正在换成共用实现的 serverless 旧路由，原样搬到这里。换过去之前入口照常用它们；换过去之后留着
// 给新旧比对测试当基准，等所有路由都换完、测试全过，再和 Node 的旧 controller 一起删掉。
// 这里的代码只搬不改：要改行为就改新的共用实现。

interface LegacyRouteContext {
  env?: ServerlessEnv;
  options?: ServerlessOptions;
  url: URL;
  params: Record<string, string>;
  token: string | undefined;
  service: () => Promise<QrLoginService>;
}

type LegacyRouteHandler = (context: LegacyRouteContext) => Promise<Response>;

/** Mirrors `setServiceError` in the Koa controller, including the `Retry-After` header. */
const serviceErrorResponse = (error: unknown): Response => {
  if (error instanceof QrLoginServiceError) {
    return json(
      {
        code: error.httpStatus,
        message: error.message,
        retryAfterMs: error.retryAfterMs,
        ...(error.upstreamCode === undefined ? {} : { upstreamCode: error.upstreamCode }),
        ...error.diagnostics,
      },
      error.httpStatus,
      error.retryAfterMs
        ? { 'retry-after': String(Math.ceil(error.retryAfterMs / 1000)) }
        : undefined,
    );
  }
  throw error;
};

export const legacyRoutes = {
  // ---- QR login ---------------------------------------------------------------------------
  /**
   * D1′: the whole upstream QR round trip — `createSession` (QIMEI + Android session bootstrap)
   * and `createQr` (the WeChat web QR itself) — happens right here, inside the one invocation
   * that gets to return a `unikey`. That is what lets everything a later `/create` or `/check`
   * needs be sealed into that same token: there is no second invocation in which to discover the
   * WeChat `identifier` and then hand out a *different* key carrying it.
   */
  '/login/qr/key': async ({ url, env = {}, options = {} }) => {
    // An explicit `channel` is validated against this runtime's capabilities rather than against
    // the Node channel list, so `qq` is accepted exactly when a relay was injected.
    const channel = url.searchParams.get('channel') ?? 'wechat';
    const secrets = secretsOf(env);
    const { repository: deviceRepository, base } = await qrDeviceRepositoryFor(secrets);
    const qrSessions = capturingQrSessionRepository();
    let qrSessionHttp: AuthHttpClient | undefined;
    const http = createFetchAuthHttpClient();
    const service = createQrLoginService({
      http,
      createSessionHttp: () => (qrSessionHttp = createFetchAuthHttpClient()),
      deviceRepository,
      sessionResolver: createSealedSessionResolver({ secrets }),
      qrSessionRepository: qrSessions.repository,
      capabilities: capabilitiesFor(options),
      drivers: driversFor(options, http, deviceRepository, base),
      checkBudgetMs: CHECK_BUDGET_MS,
    });
    try {
      const key = await service.createSession(channel as 'qq' | 'wechat');
      await service.createQr(key);
      const record = qrSessions.latest().find((session) => session.key === key);
      // `createQr` either finished with an `identifier` on this exact record or threw —
      // reaching here without one would be a bug in this function, not a caller error.
      if (!record?.identifier) {
        throw new Error('QR session has no upstream QR after createQr()');
      }
      const device = deviceRepository.load() ?? (await deriveAndroidDevice(secrets.current));
      const unikey = await sealQrState(
        {
          channel: record.channel,
          createdAt: record.createdAt,
          expiresAt: record.expiresAt,
          identifier: record.identifier,
          // The WeChat web flow's cookie jar at the moment the QR was created — see the module
          // doc on `sealedQrState.ts` for why a fresh isolate cannot rebuild this on its own.
          // 🔴 The image itself is deliberately not sealed here; see the same module doc.
          cookies: qrSessionHttp?.getCookieHeader() ?? '',
          device: {
            qimei: device.qimei,
            qimei36: device.qimei36,
            qimeiSavedAt: device.qimeiSavedAt,
            sessionUid: device.sessionUid,
            sessionSid: device.sessionSid,
            sessionVkey: device.sessionVkey,
          },
        },
        secrets.current,
      );
      return json({ code: 200, data: { unikey } });
    } catch (error) {
      return serviceErrorResponse(error);
    }
  },

  /**
   * Re-fetches the QR image from the `identifier` sealed into the `unikey` — never a fresh
   * `qrconnect` call, which would mint a second, different WeChat QR under the same `unikey`. The
   * reconstructed session's `state` is seeded back to `'created'` (not `'waiting'`) specifically so
   * `QrLoginService.createQr()`'s own guard lets this call through: see its `session.state !==
   * 'created'` check. `createWechatQrDriver` then sees `session.identifier` already set and fetches
   * only the image — the same branch documented on that driver.
   */
  '/login/qr/create': async ({ url, env = {}, options = {} }) => {
    const key = url.searchParams.get('key');
    if (!key) return json({ code: 400, message: 'key is required' }, 400);
    const secrets = secretsOf(env);
    const payload = await openQrState(key, secrets, Date.now());
    if (!payload) {
      return serviceErrorResponse(new QrLoginServiceError('QR session not found or expired', 404));
    }
    const { repository: deviceRepository, base } = await qrDeviceRepositoryFor(
      secrets,
      payload.device,
    );
    const http = createFetchAuthHttpClient();
    const service = createQrLoginService({
      http,
      createSessionHttp: () => createFetchAuthHttpClient({ initialCookies: payload.cookies }),
      deviceRepository,
      sessionResolver: createSealedSessionResolver({ secrets }),
      qrSessionRepository: replayQrSessionRepository([replayedRecord(key, payload, 'created')]),
      capabilities: capabilitiesFor(options),
      drivers: driversFor(options, http, deviceRepository, base),
      checkBudgetMs: CHECK_BUDGET_MS,
    });
    try {
      return json({ code: 200, data: { qrimg: await service.createQr(key) } });
    } catch (error) {
      return serviceErrorResponse(error);
    }
  },

  '/login/qr/check': async ({ url, env = {}, options = {} }) => {
    const key = url.searchParams.get('key');
    if (!key) return json({ code: 400, message: 'key is required' }, 400);
    const secrets = secretsOf(env);
    const payload = await openQrState(key, secrets, Date.now());
    const { repository: deviceRepository, base } = await qrDeviceRepositoryFor(
      secrets,
      payload?.device,
    );
    const http = createFetchAuthHttpClient();
    // A missing, tampered or expired `unikey` leaves the replay repository empty. `checkQr`'s own
    // catch-all then answers `{code:800}` for "session not found" exactly as it does for the
    // in-memory store it replaces — no special case needed here.
    const service = createQrLoginService({
      http,
      createSessionHttp: () =>
        createFetchAuthHttpClient({ initialCookies: payload?.cookies ?? '' }),
      deviceRepository,
      sessionResolver: createSealedSessionResolver({ secrets }),
      // 🔴 Seeded as `waiting` on every invocation, because there is nowhere to remember that a
      // previous one already saw `scanned`. That is why `QqQrRelay.poll` is specified to answer
      // with the whole event list rather than a delta: a relay that only reported new events would
      // leave this record stuck at `waiting`, and `checkQr` would answer 801 for a scanned code.
      qrSessionRepository: replayQrSessionRepository(
        payload ? [replayedRecord(key, payload, 'waiting')] : [],
      ),
      capabilities: capabilitiesFor(options),
      drivers: driversFor(options, http, deviceRepository, base),
      checkBudgetMs: CHECK_BUDGET_MS,
    });
    const result = await service.checkQr(key, CHECK_BUDGET_MS);
    // §5.3 #1: the body keeps `{ code, message, cookie }`. The Set-Cookie mirrors what the Koa
    // route does, but the client reads `body.cookie` — it has never parsed the token.
    const token =
      result.code === 803 && result.cookie ? tokenFromCookieString(result.cookie) : null;
    return json(
      result,
      200,
      token
        ? {
            'set-cookie': `${AUTH_COOKIE_NAME}=${token}; HttpOnly; Max-Age=86400; SameSite=Lax; Path=/`,
          }
        : undefined,
    );
  },

  '/login/qr/cancel': async ({ url, env = {}, options = {}, service: getService }) => {
    const key = url.searchParams.get('key');
    if (!key) return json({ code: 400, message: 'key is required' }, 400);
    // 🔴 The relay is released here rather than through `cancelSession`. That call operates on the
    // service's QR store, which under `sealed` is empty on a fresh invocation, so it has always
    // been a no-op on this runtime — harmless for `wechat`, which owns nothing between calls, and
    // wrong for `qq`, where the relay would otherwise hold an MQTT connection (and be billed for
    // it) until the code expires. Awaited, not fire-and-forget: an unawaited promise in a Worker
    // can be cancelled the moment the response is returned.
    const relay = options.qqRelay;
    if (relay) {
      const payload = await openQrState(key, secretsOf(env), Date.now()).catch(() => null);
      // Best effort by contract: an unknown, tampered or already-released key is still a success.
      if (payload?.channel === 'qq') await relay.close(payload.identifier).catch(() => undefined);
    }
    // §5.3 #5: always 200. Callers cancel fire-and-forget on dialog close.
    (await getService()).cancelSession(key);
    return json({ code: 200 });
  },

  '/login/channels': async ({ env = {}, options = {} }) => {
    const configured = Boolean(env.QQ_SESSION_SECRET);
    const capabilities = capabilitiesFor(options);
    return json({
      code: 200,
      data: describeRuntimeCapabilities('serverless', capabilities, configured),
    });
  },

  '/getSongListDetail/:disstid': async ({ url, params, service: getService, token, env = {} }) => {
    const disstid = params.disstid ?? url.searchParams.get('disstid') ?? undefined;
    const { status, body } = await songListDetailService({
      method: 'get',
      params: { disstid },
      option: {},
      ...(token && env.QQ_SESSION_SECRET
        ? {
            readWithCredential: async (id: string) =>
              (await getService()).getAuthenticatedSongListDetail(token, id),
          }
        : {}),
    });
    return json(body, status);
  },

  '/getMusicPlay/:songmid?': async ({ url, params, service: getService, token }) => {
    const songmid = (params.songmid ?? url.searchParams.get('songmid') ?? '').trim();
    if (!songmid) return json({ data: { message: 'no songmid' } }, 400);
    // Only the authenticated branch is served here. The Node controller also has an anonymous
    // fallback that builds a guessed URL from `config.user`, which a serverless deployment has
    // no configuration file for; without a session there is nothing honest to answer.
    if (!token) return json(LOGIN_REQUIRED, 401);
    const playUrl = await (await getService()).getMusicPlay(
      token,
      songmid,
      url.searchParams.get('quality') ?? '128',
      url.searchParams.get('mediaId') ?? undefined,
    );
    return playUrl ? json({ data: { playUrl } }) : json(LOGIN_REQUIRED, 401);
  },

  '/getAlbumInfo': async ({ url }) => {
    const albummid = url.searchParams.get('albummid');
    if (!albummid) return json({ data: { message: 'no albummid' } }, 400);
    const { status, body } = await getAlbumInfoService({
      method: 'get',
      params: { albummid },
      options: {},
    });
    return json(body, status);
  },

  '/getSongInfo/:songmid/:songid?': async ({ url, params }) => {
    const song_mid = params.songmid ?? url.searchParams.get('songmid') ?? undefined;
    const song_id = params.songid ?? url.searchParams.get('songid') ?? '';
    const response = await u_common({
      method: 'get',
      options: {
        params: {
          format: 'json',
          data: JSON.stringify({
            comm: { ct: 24, cv: 0 },
            songinfo: {
              method: 'get_song_detail_yqq',
              param: { song_type: 0, song_mid, song_id },
              module: 'music.pf_song_detail_svr',
            },
          }),
        },
      },
    });
    return json({ response: response.data });
  },

  '/getSingerAlbum': async ({ url }) => {
    const singermid = url.searchParams.get('singermid');
    if (!singermid) return json({ data: { message: 'no singermid' } }, 400);
    const num = +(url.searchParams.get('limit') || 5);
    const begin = +(url.searchParams.get('page') || 0);
    const response = await u_common({
      method: 'get',
      options: {
        params: {
          format: 'json',
          singermid,
          data: JSON.stringify({
            comm: { ct: 24, cv: 0 },
            singer: {
              method: 'GetAlbumList',
              param: { sort: 5, singermid, begin, num },
              module: 'music.musichallAlbum.AlbumListServer',
            },
          }),
        },
      },
    });
    return json({ response: response.data });
  },

  '/getSingerHotsong': async ({ url }) => {
    const singermid = url.searchParams.get('singermid');
    if (!singermid) return json({ data: { message: 'no singermid' } }, 400);
    const num = +(url.searchParams.get('limit') || 5);
    const page = +(url.searchParams.get('page') || 0);
    const response = await u_common({
      method: 'get',
      options: {
        params: {
          format: 'json',
          singermid,
          data: JSON.stringify({
            comm: { ct: 24, cv: 0 },
            singer: {
              method: 'get_singer_detail_info',
              param: { sort: 5, singermid, sin: (page - 1) * num, num },
              module: 'music.web_singer_info_svr',
            },
          }),
        },
      },
    });
    return json({ response: response.data });
  },
  '/login/status': async ({ service: getService, token }) => {
    // §5.3 #3: never 401 here. Folia decides by whether `data.profile` exists.
    const profile = await (await getService()).getLoginStatus(token);
    return json({ code: 200, data: profile ? { profile } : {} });
  },

  '/logout': async ({ service: getService, token }) => {
    // 🔴 Under `sealed` this cannot delete anything: the session lives in the token the client
    // holds. `revoke()` is a documented no-op and logout means the client discarding it. The
    // expired cookie below is what actually ends the session for a same-origin caller.
    await (await getService()).logout(token);
    return json({ code: 200 }, 200, { 'set-cookie': `${AUTH_COOKIE_NAME}=; Max-Age=0; Path=/` });
  },

  '/user/detail': async ({ service: getService, token }) => {
    const profile = await (await getService()).getUserDetail(token);
    return profile ? json({ code: 200, profile }) : json(LOGIN_REQUIRED, 401);
  },

  '/user/playlist': async ({ url, service: getService, token }) => {
    const data = await (await getService()).getUserPlaylists(
      token,
      url.searchParams.get('uid') ?? undefined,
      userPlaylistOptionsOf(url.searchParams.get('favoriteOffset')),
    );
    if (!data) return json(LOGIN_REQUIRED, 401);
    return json(toUserPlaylistBody(data));
  },

  '/user/albums': async ({ url, service: getService, token }) => {
    const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset') ?? '0', 10) || 0);
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '20', 10) || 20),
    );
    const data = await (await getService()).getUserAlbums(token, offset, limit);
    if (!data) return json(LOGIN_REQUIRED, 401);
    const albums = Array.isArray(data.albumlist) ? data.albumlist : [];
    const total = typeof data.totalalbum === 'number' ? data.totalalbum : albums.length;
    return json({
      code: 200,
      albums,
      total,
      more: Number(data.has_more) === 1 || offset + albums.length < total,
    });
  },

  '/user/liked-songs': async ({ url, service: getService, token }) => {
    const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset') ?? '0', 10) || 0);
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '100', 10) || 100),
    );
    const data = await (await getService()).getUserLikedSongs(token, offset, limit);
    if (!data) return json(LOGIN_REQUIRED, 401);
    const songs = Array.isArray(data.songlist) ? data.songlist : [];
    const total = typeof data.total_song_num === 'number' ? data.total_song_num : songs.length;
    return json({
      code: 200,
      songs,
      total,
      more: data.hasmore === true || Number(data.hasmore) === 1 || offset + songs.length < total,
    });
  },

  '/user/playlist-detail': async ({ url, service: getService, token }) => {
    const idOf = (name: string): number => {
      const value = url.searchParams.get(name) ?? '';
      return /^\d+$/.test(value) ? Number(value) : 0;
    };
    const disstid = idOf('tid');
    const dirid = idOf('dirid');
    if (!disstid && !dirid) return json({ code: 400, message: 'tid or dirid is required' }, 400);
    const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset') ?? '0', 10) || 0);
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '100', 10) || 100),
    );
    const data = await (await getService()).getOwnedPlaylistSongs(token, {
      disstid,
      dirid,
      offset,
      limit,
    });
    if (!data) return json(LOGIN_REQUIRED, 401);
    const songs = Array.isArray(data.songlist) ? data.songlist : [];
    const total = typeof data.total_song_num === 'number' ? data.total_song_num : songs.length;
    return json({
      code: 200,
      songs,
      total,
      more: data.hasmore === true || Number(data.hasmore) === 1 || offset + songs.length < total,
    });
  },
} satisfies Record<string, LegacyRouteHandler>;
