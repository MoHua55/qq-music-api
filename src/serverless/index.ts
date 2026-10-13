import { getAlbumInfo } from '../routes/operations/getAlbumInfo';
import { getMusicPlay } from '../routes/operations/getMusicPlay';
import { getOwnedPlaylistSongs } from '../routes/operations/getOwnedPlaylistSongs';
import { getSingerAlbum } from '../routes/operations/getSingerAlbum';
import { getSingerHotsong } from '../routes/operations/getSingerHotsong';
import { getSongInfo } from '../routes/operations/getSongInfo';
import { getSongListDetail } from '../routes/operations/getSongListDetail';
import { getUserAlbums } from '../routes/operations/getUserAlbums';
import { getUserLikedSongs } from '../routes/operations/getUserLikedSongs';
import { getUserPlaylist } from '../routes/operations/getUserPlaylist';
import { loginStatus } from '../routes/operations/loginStatus';
import { logout } from '../routes/operations/logout';
import { qrCancel } from '../routes/operations/qrCancel';
import { qrCheck } from '../routes/operations/qrCheck';
import { qrCreate } from '../routes/operations/qrCreate';
import { qrKey } from '../routes/operations/qrKey';
import { userDetail } from '../routes/operations/userDetail';
import { createMemoryDeviceContextRepository } from '../services/auth/deviceContextStore';
import {
  createQrLoginService,
  type QqQrRelay,
  type QrLoginService,
} from '../services/auth/qrLogin';
import { setLegacyHttpTransport } from '../services/httpTransport';
import { guessYouLikeResult } from '../services/recommend/guessYouLike';
import type { NewRouteResult } from '../services/recommend/newRouteResult';
import {
  recommendPlaylistsLimitOf,
  recommendPlaylistsResult,
} from '../services/recommend/recommendPlaylists';
import { deriveAndroidDevice } from './derivedDevice';
import { createFetchAuthHttpClient } from './fetchAuthHttpClient';
import { createFetchLegacyTransport } from './fetchLegacyTransport';
import { legacyRoutes } from './legacyRoutes';
import { operationRoute } from './operationRoute';
import { CHECK_BUDGET_MS, capabilitiesFor, secretsOf } from './qrRuntime';
import { AUTH_COOKIE_NAME, failureResponse, json } from './response';
import { createRouter } from './router';
import { createSealedSessionResolver } from './sealedResolver';

/**
 * The serverless entry point: one Web-standard `handleRequest(request, env)` and nothing else.
 *
 * 🔴 This module must never import `src/app.ts`. Requiring the package root starts a Koa server as
 * an import side effect, which is correct for Node and fatal for a Worker. The dependency-closure
 * test asserts the whole graph, because "it does not import Koa" has been wrong before — `colors`
 * and the config barrel both arrived indirectly (M0 0.2).
 *
 * What this runtime can serve differs from Node, and says so rather than failing later:
 * - `wechat` always; `qq` only when the host injects a `QqQrRelay`. The QQ App channel is MQTT over
 *   WebSocket with a connection that must outlive one invocation — the CONNECT asks for a clean
 *   session and the subscription is unicast, so nothing published while disconnected is replayed.
 *   A host that can hold that connection (a Cloudflare Durable Object) passes a relay in; one that
 *   cannot (Vercel Functions) passes nothing and the channel is simply not advertised.
 *   🔴 A missing relay is a capability statement, not an error: `/login/channels` answers `wechat`.
 * - `sealed` sessions only. There is no process to keep a credential in.
 * - Without `QQ_SESSION_SECRET` the login routes answer 501 and the catalog routes still work.
 *   🔴 A secret is never generated: a process-local one would put back exactly the "restart loses
 *   every login" bug this whole workstream exists to remove.
 */

/**
 * Re-exported so a host can implement the relay without importing the package root, which starts a
 * Koa server as an import side effect and is therefore unusable from a Worker.
 */
export type { QqQrRelay, QrEvent } from '../services/auth/qrLogin';

export interface ServerlessEnv {
  QQ_SESSION_SECRET?: string;
  QQ_SESSION_SECRET_PREVIOUS?: string;
}

/**
 * Host capabilities that are not environment strings.
 *
 * Kept out of `ServerlessEnv` on purpose: `env` is a plain string map every platform can produce,
 * and a platform binding is not a string. Passing this separately is also what keeps the two-argument
 * `handleRequest(request, env)` signature — and therefore the Vercel entry — unchanged.
 */
export interface ServerlessOptions {
  /** Supplied only by a host that can hold an MQTT connection across invocations. */
  qqRelay?: QqQrRelay;
}

const AUTH_HEADER_NAME = 'x-qq-session';
/** A single invocation may observe a pull channel this long before it has to answer. */

const tokenFromCookieString = (cookie: string): string | undefined => {
  for (const entry of cookie.split(';')) {
    const separator = entry.indexOf('=');
    if (separator <= 0) continue;
    if (entry.slice(0, separator).trim() === AUTH_COOKIE_NAME)
      return entry.slice(separator + 1).trim() || undefined;
  }
  return undefined;
};

/** Header > query > cookie, the same order the Koa controller applies (§5.3 #2). */
const authTokenOf = (request: Request, url: URL): string | undefined => {
  const header = request.headers.get(AUTH_HEADER_NAME)?.trim();
  if (header) return header;
  const queried = tokenFromCookieString(url.searchParams.get('cookie') ?? '');
  if (queried) return queried;
  return tokenFromCookieString(request.headers.get('cookie') ?? '');
};

interface RouteContext {
  request: Request;
  url: URL;
  params: Record<string, string>;
  /**
   * Lazy on purpose. Building the service derives the device identity from the session secret,
   * and the catalog routes are required to work on a deployment that has no secret at all — so
   * constructing it eagerly would make anonymous catalog requests fail on a missing secret.
   */
  service: () => Promise<QrLoginService>;
  token: string | undefined;
  /**
   * The QR routes below build their own per-call `QrLoginService` (§ sealed QR state) instead of
   * using `service()`, because each of the three calls needs different wiring — `/key` captures
   * what it creates, `/create` and `/check` replay a session reconstructed from the `unikey`.
   */
  env: ServerlessEnv;
  options: ServerlessOptions;
}

type RouteHandler = (context: RouteContext) => Promise<Response>;

/** 新路由的结果已经带好状态码与 header，这里只负责写成 Response。 */
const fromResult = (result: NewRouteResult): Response =>
  json(result.body, result.status, result.headers);

const routes: Record<string, RouteHandler> = {
  '/login/qr/key': operationRoute(qrKey),
  '/login/qr/create': operationRoute(qrCreate),
  '/login/qr/check': operationRoute(qrCheck),
  '/login/qr/cancel': operationRoute(qrCancel),

  // ---- Session ----------------------------------------------------------------------------
  '/login/status': operationRoute(loginStatus),

  '/logout': operationRoute(logout),

  '/user/detail': operationRoute(userDetail),

  '/user/guess-you-like': async ({ service: getService, token }) =>
    fromResult(await guessYouLikeResult(await (await getService()).resolveSession(token))),

  // 有会话就带凭证，没有就匿名。没设密钥时解不开任何会话，也不建服务，直接匿名读。
  '/recommend/playlists': async ({ url, env, service: getService, token }) => {
    const session =
      env.QQ_SESSION_SECRET && token ? await (await getService()).resolveSession(token) : null;
    return fromResult(
      await recommendPlaylistsResult(
        session,
        recommendPlaylistsLimitOf(url.searchParams.get('limit')),
      ),
    );
  },

  '/user/playlist': operationRoute(getUserPlaylist),

  '/user/albums': operationRoute(getUserAlbums),

  '/user/liked-songs': operationRoute(getUserLikedSongs),

  // A playlist the user owns, read with their credential. It must stay in this section: the
  // anonymous `/getSongListDetail` below answers an empty shell for a 不公开 playlist.
  '/user/playlist-detail': operationRoute(getOwnedPlaylistSongs),

  '/getMusicPlay/:songmid?': operationRoute(getMusicPlay),
  // ---- Catalog (no credential) ------------------------------------------------------------
  // Anonymous by default, so it stays usable without a secret. Only when the anonymous CGI cannot
  // read the playlist at all (`code: 10`, QQ's own algorithmic playlists) does a session get used,
  // and only on a deployment that can open one; any failure there keeps the anonymous answer.
  '/getSongListDetail/:disstid': operationRoute(getSongListDetail),
  '/getSongInfo/:songmid/:songid?': operationRoute(getSongInfo),

  '/getAlbumInfo': operationRoute(getAlbumInfo),

  '/getSingerAlbum': operationRoute(getSingerAlbum),

  '/getSingerHotsong': operationRoute(getSingerHotsong),
};

/** The routes that need a session secret to mean anything. Catalog routes work without one. */
const LOGIN_ROUTES = new Set([
  '/login/qr/key',
  '/login/qr/create',
  '/login/qr/check',
  '/login/qr/cancel',
  '/login/status',
  '/logout',
  '/user/detail',
  '/user/playlist',
  '/user/albums',
  '/user/liked-songs',
  '/user/playlist-detail',
  '/user/guess-you-like',
  '/getMusicPlay/:songmid?',
]);

const match = createRouter(routes);

/**
 * Built per invocation. A Worker may reuse an isolate across requests, and a service holding a
 * cookie jar and QR state from someone else's request is a cross-request leak, not a cache.
 */
const createServiceFor = async (
  env: ServerlessEnv,
  options: ServerlessOptions,
): Promise<QrLoginService> => {
  const secrets = secretsOf(env);
  return createQrLoginService({
    http: createFetchAuthHttpClient(),
    createSessionHttp: () => createFetchAuthHttpClient(),
    deviceRepository: createMemoryDeviceContextRepository(
      await deriveAndroidDevice(secrets.current),
    ),
    sessionResolver: createSealedSessionResolver({ secrets }),
    capabilities: capabilitiesFor(options),
    checkBudgetMs: CHECK_BUDGET_MS,
  });
};

export const handleRequest = async (
  request: Request,
  env: ServerlessEnv = {},
  options: ServerlessOptions = {},
): Promise<Response> => {
  const url = new URL(request.url);
  const configured = Boolean(env.QQ_SESSION_SECRET);

  if (url.pathname === '/login/channels' || url.pathname === '/login/channels/') {
    return legacyRoutes['/login/channels']({
      url,
      env,
      options,
      params: {},
      token: undefined,
      service: () => createServiceFor(env, options),
    });
  }

  const matched = match(url.pathname);
  if (!matched) {
    return json(
      {
        code: 501,
        message: `${url.pathname} is not implemented by the serverless runtime. See /login/channels for what this deployment serves.`,
      },
      501,
    );
  }

  // 🔴 Explicit, never a silent downgrade. Without a secret there is no key to seal a session
  // with, and generating one per isolate would make every login vanish on the next cold start.
  if (!configured && LOGIN_ROUTES.has(matched.route)) {
    return json(
      {
        code: 501,
        message:
          'QQ_SESSION_SECRET is not set, so this deployment cannot hold a session. Catalog routes still work.',
      },
      501,
    );
  }

  // The legacy catalog transport is a module-level registration, so it is set before any catalog
  // service can run. Re-registering an equivalent transport is idempotent.
  setLegacyHttpTransport(createFetchLegacyTransport());

  // Memoised per invocation: a handler may reach for it more than once, and a Worker isolate is
  // shared across requests, so the service (with its cookie jar and QR state) must not outlive one.
  let pending: Promise<QrLoginService> | null = null;
  const service = () => {
    pending ??= createServiceFor(env, options);
    return pending;
  };

  try {
    return await matched.handler({
      request,
      url,
      params: matched.params,
      service,
      token: authTokenOf(request, url),
      env,
      options,
    });
  } catch (error) {
    return failureResponse(error);
  }
};

export default handleRequest;
