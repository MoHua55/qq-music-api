import { AuthCredentialRejectedError } from '../../util/authError';
import { logger } from '../../util/logger';
import { RequestRejectedError } from '../../util/requestError';
import type { UserPlaylistOptions } from '../user/userPlaylistResponse';
import {
  type AuthenticatedSongListDetailOptions,
  authSessionExpiryAt,
  getAuthenticatedSongListDetail,
  getFavoriteAlbums,
  getLikedSongs,
  getLoginProfile,
  getLoginUser,
  getOwnedPlaylistSongs,
  getPlaylists,
  isOwnAccountId,
  type OwnedPlaylistSongsParams,
  positiveIdOf,
  refreshLoginCredential,
  validateWechatCredential,
  withCredentialRejectionMapped,
} from './authenticatedReads';
import { ensureQimei, refreshAndroidSession } from './bootstrap';
import { exchangeCredential, exchangeWechatCredential, MOBILE_LOGIN_TYPE } from './credentialWire';
import {
  createDeviceContextStore,
  createMemoryDeviceContextRepository,
  type DeviceContextStore,
} from './deviceContextStore';
import type { AuthHttpClient } from './httpClient';
import { QqDeviceBootstrapError, QqProtocolError, QrLoginServiceError } from './musicuProtocol';
import { getAuthenticatedPlayUrls } from './playback';
import { createQqQrDriver, createWechatQrDriver } from './qrDrivers';
import {
  confirmingState,
  failureDetailsOf,
  primaryFailureOf,
  qrFailureDetailsOf,
  terminalState,
} from './qrFailures';
import {
  type AuthSession,
  type AuthSessionRepository,
  DEFAULT_LOGIN_CHANNEL,
  type LegacyQrLoginChannel,
  NODE_RUNTIME_CAPABILITIES,
  normalizeLoginChannel,
  type PlaybackOptions,
  type QqCredential,
  type QrChannelDriver,
  type QrCheckResult,
  type QrEvent,
  type QrFailureDetails,
  type QrFailureStage,
  type QrLoginChannel,
  type QrLoginDependencies,
  type QrLoginService,
  type QrSessionRecord,
  type QrSessionRuntime,
  type RuntimeCapabilities,
  type SessionResolver,
} from './qrTypes';
import {
  createMemoryAuthSessionRepository,
  createMemoryQrSessionRepository,
  createQrSessionStore,
  createStoredSessionResolver,
  type QrSessionStore,
  randomBytesNeutral,
  unavailableHttpClient,
  unavailableListen,
} from './sessionState';
import { createStreamUrlProbe, StreamCdnSelector } from './streamCdnSelector';
import { type Dictionary, dictionaryOf, stringOf } from './values';
import {
  MAX_CONSECUTIVE_POLL_ERRORS,
  WECHAT_DEFAULT_POLL_BUDGET_MS,
  WechatQrError,
} from './wechatLogin';

// src/services/auth/qrService.ts
// 从认证入口搬出的同一套实现；协议、状态与对外回包沿用原规则。

export const QR_TTL_MS = 3 * 60 * 1000;

/** Every failure cools the next QR down by the same amount; repeated failures never double it. */
export const QR_COOLDOWN_MS = 15 * 1000;

/** The upstream explicitly said "too frequent" (login 104604 or an upstream HTTP 429). */
export const QR_RATE_LIMITED_COOLDOWN_MS = 30 * 1000;

const LOGIN_RATE_LIMITED_CODE = 104604;

// A fallback's own result replaces the primary one on top, so "too frequent" is looked for in both.
const isRateLimitedFailure = (details: QrFailureDetails): boolean =>
  details.upstreamCode === LOGIN_RATE_LIMITED_CODE ||
  details.upstreamHttpStatus === 429 ||
  details.primaryFailure?.upstreamCode === LOGIN_RATE_LIMITED_CODE;

export class QrLoginServiceImpl implements QrLoginService {
  private readonly http: AuthHttpClient;
  private readonly playbackHintsEnabled: boolean;
  private readonly streamCdnSelector: StreamCdnSelector;
  private readonly createSessionHttp: () => AuthHttpClient;
  private readonly now: () => number;
  private readonly random: (size: number) => Buffer;
  private readonly capabilities: RuntimeCapabilities;
  private readonly checkBudgetMs: number;
  private readonly drivers: Partial<Record<QrLoginChannel, QrChannelDriver>>;
  private readonly qrSessionStore: QrSessionStore;
  private readonly qrRuntimes = new Map<string, QrSessionRuntime>();
  private readonly sessionResolver: SessionResolver;
  private readonly deviceStore: DeviceContextStore;
  private creatingSession = false;
  private nextQrAllowedAt = 0;
  private lastQrFailure?: QrFailureDetails;

  public constructor(dependencies: QrLoginDependencies) {
    this.http = dependencies.http ?? unavailableHttpClient();
    this.playbackHintsEnabled = dependencies.playbackHintsEnabled !== false;
    this.streamCdnSelector = new StreamCdnSelector(
      dependencies.streamUrlProbe ?? createStreamUrlProbe(this.http),
      dependencies.now ?? Date.now,
    );
    this.createSessionHttp = dependencies.createSessionHttp ?? unavailableHttpClient;
    this.now = dependencies.now ?? Date.now;
    this.random = dependencies.randomBytes ?? randomBytesNeutral;
    this.capabilities = dependencies.capabilities ?? NODE_RUNTIME_CAPABILITIES;
    this.checkBudgetMs = dependencies.checkBudgetMs ?? WECHAT_DEFAULT_POLL_BUDGET_MS;
    this.deviceStore = createDeviceContextStore(
      dependencies.deviceRepository ?? createMemoryDeviceContextRepository(),
    );
    this.sessionResolver =
      dependencies.sessionResolver ??
      createStoredSessionResolver({
        repository: dependencies.authSessionRepository ?? createMemoryAuthSessionRepository(),
        now: this.now,
        randomBytes: this.random,
        refreshCredential: (session) =>
          refreshLoginCredential(this.http, session.device, session.credential),
      });
    this.qrSessionStore = createQrSessionStore(
      dependencies.qrSessionRepository ?? createMemoryQrSessionRepository(),
    );
    this.drivers = {
      qq: createQqQrDriver({
        http: this.http,
        device: () => this.deviceStore.get(),
        listen: dependencies.listen ?? unavailableListen,
      }),
      wechat: createWechatQrDriver({ http: (session) => this.sessionHttp(session) }),
      ...dependencies.drivers,
    };
  }

  public getCapabilities(): RuntimeCapabilities {
    return this.capabilities;
  }

  private runtimeFor(session: QrSessionRecord): QrSessionRuntime {
    const existing = this.qrRuntimes.get(session.key);
    if (existing) return existing;
    const driver = this.drivers[session.channel];
    if (!driver)
      throw new QrLoginServiceError(`Unsupported QR login channel: ${session.channel}`, 400);
    const runtime: QrSessionRuntime = { driver, pollErrors: 0 };
    this.qrRuntimes.set(session.key, runtime);
    return runtime;
  }

  private dropSession(session: QrSessionRecord): void {
    // Closing MQTT rejects the listener's pending read. Retire the session first so its late
    // events and rejection cannot turn intentional teardown into another login failure.
    if (!terminalState(session.state)) session.state = 'expired';
    const runtime = this.qrRuntimes.get(session.key);
    runtime?.listener?.close();
    runtime?.driver.close(session);
    this.qrRuntimes.delete(session.key);
    this.qrSessionStore.delete(session.key);
  }

  private cleanup(): void {
    const current = this.now();
    for (const session of this.qrSessionStore.values()) {
      if (session.expiresAt > current) continue;
      // A pull channel has no background timer to raise `timeout` at expiry, so the expiry itself
      // has to keep counting as a failure. Both guards mirror when a push listener would have
      // raised it: only after a code exists to scan, and only if nothing terminal happened first.
      // A key that was issued and abandoned before `createQr` never backed anything off.
      if (!terminalState(session.state) && session.imageUrl !== undefined) this.backoff();
      this.dropSession(session);
    }
    this.sessionResolver.cleanup?.();
  }

  private backoff(
    details: QrFailureDetails = { failureStage: 'qr-event', failureReason: 'qr-timeout' },
  ): number {
    this.lastQrFailure = failureDetailsOf(details);
    const delay = isRateLimitedFailure(this.lastQrFailure)
      ? QR_RATE_LIMITED_COOLDOWN_MS
      : QR_COOLDOWN_MS;
    this.nextQrAllowedAt = this.now() + delay;
    return delay;
  }

  private confirmingQrExists(): boolean {
    return this.qrSessionStore.values().some((session) => confirmingState(session.state));
  }

  /**
   * Closes and drops the codes nobody is scanning. Without this a dialog that was opened and shut
   * without a scan would hold the slot for the whole QR TTL, so the next login attempt — including
   * the one after a hard app restart, where no cancel could ever be sent — got a 409 it could not
   * clear by retrying.
   */
  private discardPreemptibleSessions(): void {
    for (const session of this.qrSessionStore.values()) {
      if (terminalState(session.state) || confirmingState(session.state)) continue;
      this.dropSession(session);
      logger.info('qq-auth.qr-session-preempted', { loginChannel: session.channel });
    }
  }

  private sessionFor(key: string): QrSessionRecord {
    this.cleanup();
    const session = this.qrSessionStore.get(key);
    if (!session) throw new QrLoginServiceError('QR session not found or expired', 404);
    return session;
  }

  private async authFor(token?: string): Promise<AuthSession | null> {
    this.cleanup();
    return this.sessionResolver.resolve(token);
  }

  /**
   * Turns a pre-session bootstrap failure into a backed-off client error, so repeated clicks
   * get one 502 with Retry-After and then 429s instead of a stream of upstream calls.
   */
  private failBootstrap(error: unknown, stage: QrFailureStage): QrLoginServiceError {
    if (error instanceof QrLoginServiceError) return error;
    const bootstrap = error instanceof QqDeviceBootstrapError ? error : null;
    const protocol = error instanceof QqProtocolError ? error : null;
    const diagnostics = qrFailureDetailsOf(error, stage);
    const retryAfterMs = this.backoff(diagnostics);
    const upstreamCode = bootstrap?.outerCode ?? protocol?.upstreamCode;
    logger.warn('qq-auth.bootstrap-failed', {
      phase: bootstrap ? 'qimei' : (protocol?.phase ?? 'unknown'),
      outerCode: bootstrap?.outerCode,
      innerCode: bootstrap?.innerCode,
      upstreamCode: protocol?.upstreamCode,
      retryAfterMs,
      name: error instanceof Error ? error.name : 'Error',
      ...diagnostics,
    });
    return new QrLoginServiceError(
      'Unable to start QR login',
      502,
      retryAfterMs,
      upstreamCode,
      diagnostics,
    );
  }

  private failSession(session: QrSessionRecord, error: unknown, stage: QrFailureStage): void {
    if (terminalState(session.state)) return;
    session.state = 'failed';
    Object.assign(session, qrFailureDetailsOf(error, stage, session.channel));
    session.retryAfterMs = this.backoff(session);
    this.qrSessionStore.persist();
    logger.warn('qq-auth.session-failed', {
      loginChannel: session.channel,
      retryAfterMs: session.retryAfterMs,
      ...failureDetailsOf(session),
      name: error instanceof Error ? error.name : 'Error',
    });
  }

  /** QQ App channel: the MQTT payload carries an exchange token, never the final credential. */
  private async exchangeQqLogin(session: QrSessionRecord, payload: unknown): Promise<QqCredential> {
    session.failureStage = 'credential-payload';
    const cookies = dictionaryOf(dictionaryOf(payload).cookies);
    const musicid = stringOf(dictionaryOf(cookies.qqmusic_uin).value);
    const mqttToken = stringOf(dictionaryOf(cookies.qqmusic_key).value);
    if (!musicid || !mqttToken || !session.qrcodeId)
      throw new Error('MQTT cookies missing login credential');
    session.state = 'exchanging';
    const device = this.deviceStore.get();
    session.failureStage = 'credential-exchange';
    try {
      return await exchangeCredential(this.http, device, session.qrcodeId, musicid, mqttToken);
    } catch (error) {
      // The fallback below replaces this failure on top whatever it returns, so it is kept here.
      session.primaryFailure = primaryFailureOf(error, 'credential-exchange', session.channel);
      session.fallbackAttempted = true;
      session.failureStage = 'credential-validation';
      const direct = {
        musicid,
        str_musicid: musicid,
        musickey: mqttToken,
        loginType: MOBILE_LOGIN_TYPE,
      };
      await getLoginUser(this.http, {
        token: '',
        credential: direct,
        device,
        expiresAt: 0,
      });
      logger.warn('qq-auth.exchange-fallback', {
        upstreamCode: error instanceof QqProtocolError ? error.upstreamCode : undefined,
      });
      return direct;
    }
  }

  /** WeChat channel: the web flow yields an OAuth code, and there is no MQTT fallback. */
  private async exchangeWechatLogin(
    session: QrSessionRecord,
    payload: unknown,
  ): Promise<QqCredential> {
    session.failureStage = 'credential-payload';
    const code = stringOf(dictionaryOf(payload).code);
    if (!code) throw new WechatQrError('WeChat authorization missing code');
    session.state = 'exchanging';
    session.failureStage = 'credential-exchange';
    return exchangeWechatCredential(this.http, this.deviceStore.get(), code);
  }

  private async finalizeLogin(session: QrSessionRecord, payload: unknown): Promise<void> {
    let credential =
      session.channel === 'wechat'
        ? await this.exchangeWechatLogin(session, payload)
        : await this.exchangeQqLogin(session, payload);
    if (session.channel === 'wechat') {
      session.failureStage = 'credential-validation';
      credential = await validateWechatCredential(this.http, this.deviceStore.get(), credential);
    }
    session.failureStage = 'session-issue';
    const token = await this.sessionResolver.issue({
      credential,
      device: this.deviceStore.get(),
      expiresAt: authSessionExpiryAt(credential, this.now()),
    });
    session.authToken = token;
    session.failureStage = undefined;
    session.failureReason = undefined;
    session.primaryFailure = undefined;
    session.fallbackAttempted = undefined;
    session.state = 'confirmed';
    this.qrSessionStore.persist();
    this.nextQrAllowedAt = 0;
    this.lastQrFailure = undefined;
    logger.info('qq-auth.login-confirmed', {
      loginChannel: session.channel,
      hasCredential: true,
      credentialLoginType: credential.loginType,
      credentialKeys: Object.keys(credential).sort(),
      credentialKeyLength: credential.musickey.length,
    });
  }

  private onQrEvent(session: QrSessionRecord, event: QrEvent): void {
    if (terminalState(session.state)) return;
    if (event.type === 'waiting') session.state = 'waiting';
    else if (event.type === 'scanned') session.state = 'scanned';
    else if (event.type === 'cookies' || event.type === 'authorized') {
      const runtime = this.runtimeFor(session);
      // Started the same way for both driver modes. A push channel leaves it running in the
      // background exactly as before; a pull channel awaits it inside the same `advance()` so an
      // invocation never ends with the credential exchange still in flight.
      runtime.finalizing = this.finalizeLogin(session, event.payload).catch((error) =>
        this.failSession(session, error, session.failureStage ?? 'credential-exchange'),
      );
      void runtime.finalizing;
    } else if (['canceled', 'timeout', 'loginFailed'].includes(event.type ?? '')) {
      session.state = 'expired';
      session.failureStage = 'qr-event';
      session.failureReason =
        event.type === 'canceled'
          ? 'user-canceled'
          : event.type === 'timeout'
            ? 'qr-timeout'
            : 'login-rejected';
      session.retryAfterMs = this.backoff(session);
    }
    this.qrSessionStore.persist();
  }

  /**
   * Gives a pull channel its one time-boxed look at the upstream. Push channels have already
   * delivered whatever arrived, so this is a no-op for them.
   */
  private async advanceSession(session: QrSessionRecord, budgetMs: number): Promise<void> {
    const runtime = this.runtimeFor(session);
    if (runtime.driver.mode !== 'pull' || terminalState(session.state)) return;
    let events: QrEvent[];
    try {
      events = await runtime.driver.advance(session, budgetMs);
      runtime.pollErrors = 0;
    } catch (error) {
      // A dropped long poll is normal; only a run of them fails the session. This is the same
      // tolerance the self-driving WeChat loop applied before it became a pull driver.
      runtime.pollErrors += 1;
      if (runtime.pollErrors > MAX_CONSECUTIVE_POLL_ERRORS)
        this.failSession(session, error, 'qr-poll');
      return;
    }
    for (const event of events) this.onQrEvent(session, event);
    await runtime.finalizing;
  }

  public async createSession(
    channel: QrLoginChannel | LegacyQrLoginChannel = DEFAULT_LOGIN_CHANNEL,
  ): Promise<string> {
    // Normalizing here rather than deeper in is what keeps the legacy alias a boundary concern:
    // every field, log and comparison below this line only ever sees a canonical channel.
    const loginChannel = normalizeLoginChannel(channel);
    // Validated against this runtime's declared capabilities, not a module-level constant, so a
    // runtime that cannot serve a channel rejects it instead of failing further in.
    if (!loginChannel || !this.capabilities.channels.includes(loginChannel))
      throw new QrLoginServiceError(`Unsupported QR login channel: ${channel}`, 400);
    this.cleanup();
    const retryAfterMs = Math.max(0, this.nextQrAllowedAt - this.now());
    if (retryAfterMs > 0)
      throw new QrLoginServiceError(
        'QR login is temporarily backed off',
        429,
        retryAfterMs,
        undefined,
        {
          failureStage: 'qr-key',
          failureReason: 'local-backoff',
          lastFailure: this.lastQrFailure,
        },
      );
    // The concurrency lock and a QR that is mid-confirmation are the only real 409s left.
    if (this.creatingSession || this.confirmingQrExists())
      throw new QrLoginServiceError(
        'Another QR login is already active',
        409,
        undefined,
        undefined,
        {
          failureStage: 'qr-key',
          failureReason: 'session-busy',
        },
      );
    this.discardPreemptibleSessions();
    this.creatingSession = true;
    let stage: QrFailureStage = 'device-bootstrap';
    try {
      const device = this.deviceStore.get();
      if (await ensureQimei(this.http, device, this.now())) this.deviceStore.persist();
      stage = 'session-bootstrap';
      await refreshAndroidSession(this.http, device);
      this.deviceStore.persist();
      const key = this.random(24).toString('hex');
      this.qrSessionStore.set({
        key,
        channel: loginChannel,
        state: 'created',
        createdAt: this.now(),
        expiresAt: this.now() + QR_TTL_MS,
      });
      logger.info('qq-auth.qr-session-created', { loginChannel });
      return key;
    } catch (error) {
      throw this.failBootstrap(error, stage);
    } finally {
      this.creatingSession = false;
    }
  }

  /**
   * Releases one QR session by key. Keyed on purpose: clearing every session would let one client
   * closing its dialog kill a QR another client is confirming on their phone.
   */
  public cancelSession(key: string): void {
    const session = this.qrSessionStore.get(key);
    // Idempotent by contract. The client cancels on dialog close as fire-and-forget, so an unknown
    // or already expired key is a success, never a 404.
    if (!session) return;
    // A confirmed session is left to expire on its own: the credential already reached authSessions
    // and a poll still in flight has to keep reading 803 rather than flip a login into "expired".
    if (session.state === 'confirmed') return;
    this.dropSession(session);
    logger.info('qq-auth.qr-session-canceled', { loginChannel: session.channel });
  }

  private sessionHttp(session: QrSessionRecord): AuthHttpClient {
    const runtime = this.runtimeFor(session);
    if (!runtime.http) runtime.http = this.createSessionHttp();
    return runtime.http;
  }

  public async createQr(key: string): Promise<string> {
    const session = this.sessionFor(key);
    if (session.imageUrl) return session.imageUrl;
    if (session.state !== 'created')
      throw new QrLoginServiceError('QR session cannot create another code', 409);
    const runtime = this.runtimeFor(session);
    session.state = 'creating';
    let stage: QrFailureStage = 'qr-create';
    try {
      const qr = await runtime.driver.createQr(session);
      session.identifier = qr.identifier;
      if (session.channel === 'qq') session.qrcodeId = qr.identifier;
      session.imageUrl = qr.imageUrl;
      if (qr.expiresIn && qr.expiresIn > 0) {
        session.expiresAt = Math.min(session.expiresAt, this.now() + qr.expiresIn * 1000);
      }
      logger.info('qq-auth.qr-created', {
        loginChannel: session.channel,
        qrIdentifierLength: qr.identifier.length,
      });
      if (runtime.driver.start) {
        stage = 'mqtt-listener';
        // The listener deadline is still computed after `expiresIn` narrowed the record, which is
        // exactly the order the pre-driver implementation used.
        const listener = runtime.driver.start(session, {
          onEvent: (event) => this.onQrEvent(session, event),
          timeoutMs: session.expiresAt - this.now(),
        });
        runtime.listener = listener;
        void listener.done.catch((error) => this.failSession(session, error, 'mqtt-listener'));
        await listener.ready;
      } else {
        // A pull channel is scannable the moment the code exists. The self-driving loop it
        // replaces emitted this same event before its first poll.
        this.onQrEvent(session, { type: 'waiting', payload: null });
      }
      this.qrSessionStore.persist();
      return qr.imageUrl;
    } catch (error) {
      this.failSession(session, error, stage);
      throw new QrLoginServiceError(
        'Unable to create QR login',
        502,
        session.retryAfterMs,
        session.upstreamCode,
        failureDetailsOf(session),
      );
    }
  }

  public async checkQr(key: string, budgetMs: number = this.checkBudgetMs): Promise<QrCheckResult> {
    try {
      const session = this.sessionFor(key);
      await this.advanceSession(session, budgetMs);
      if (session.state === 'confirmed' && session.authToken) {
        return {
          code: 803,
          message: 'Authorization login successful',
          cookie: `qqmusic_session=${session.authToken}`,
        };
      }
      if (session.state === 'scanned' || session.state === 'exchanging')
        return { code: 802, message: 'QR code scanned' };
      if (session.state === 'expired' || session.state === 'failed')
        return this.failedCheckResult(session);
      return { code: 801, message: 'Waiting for QR scan' };
    } catch {
      return { code: 800, message: 'QR code expired' };
    }
  }

  private failedCheckResult(session: QrSessionRecord): QrCheckResult {
    return {
      code: 800,
      message: session.state === 'expired' ? 'QR code expired' : 'QR login failed',
      ...(session.retryAfterMs === undefined ? {} : { retryAfterMs: session.retryAfterMs }),
      ...failureDetailsOf(session),
    };
  }

  /**
   * `/login/status` 在没有可用会话时回 200 加一个空载荷，客户端靠 `data.profile` 在不在判断登录态。
   * 因此凭证被上游拒绝时这里回报「未登录」而不是抛错，让它和「根本没带 token」走同一条路；其余需要
   * 登录的路由仍然回 401。
   */
  public async getLoginStatus(token?: string): Promise<Dictionary | null> {
    const auth = await this.authFor(token);
    if (!auth) return null;
    try {
      return await withCredentialRejectionMapped(() => getLoginProfile(this.http, auth));
    } catch (error) {
      if (error instanceof AuthCredentialRejectedError) return null;
      throw error;
    }
  }

  public async getUserDetail(token?: string): Promise<Dictionary | null> {
    const auth = await this.authFor(token);
    return auth ? withCredentialRejectionMapped(() => getLoginProfile(this.http, auth)) : null;
  }

  public async getUserPlaylists(
    token?: string,
    uin?: string,
    options: UserPlaylistOptions = {},
  ): Promise<Dictionary | null> {
    const auth = await this.authFor(token);
    if (!auth) return null;
    // 只支持登录账号本身：别人的 uid 以前会让自建歌单读对方、收藏歌单读自己，两边混在一起。
    if (uin !== undefined && uin.trim() !== '' && !isOwnAccountId(auth.credential, uin))
      throw new RequestRejectedError('uid must be the logged-in account');
    return withCredentialRejectionMapped(() =>
      getPlaylists(this.http, auth, options.favoriteOffset ?? 0),
    );
  }

  public async getUserAlbums(
    token?: string,
    offset?: number,
    limit?: number,
  ): Promise<Dictionary | null> {
    const auth = await this.authFor(token);
    return auth
      ? withCredentialRejectionMapped(() => getFavoriteAlbums(this.http, auth, offset, limit))
      : null;
  }

  public async getUserLikedSongs(
    token?: string,
    offset?: number,
    limit?: number,
  ): Promise<Dictionary | null> {
    const auth = await this.authFor(token);
    return auth
      ? withCredentialRejectionMapped(() => getLikedSongs(this.http, auth, offset, limit))
      : null;
  }

  public async getOwnedPlaylistSongs(
    token?: string,
    params: OwnedPlaylistSongsParams = {},
  ): Promise<Dictionary | null> {
    const auth = await this.authFor(token);
    return auth
      ? withCredentialRejectionMapped(() => getOwnedPlaylistSongs(this.http, auth, params))
      : null;
  }

  public async getAuthenticatedSongListDetail(
    token?: string,
    disstid?: number | string,
    options: AuthenticatedSongListDetailOptions = {},
  ): Promise<Dictionary | null> {
    const id = positiveIdOf(disstid);
    if (!id) return null;
    const auth = await this.authFor(token);
    return auth
      ? withCredentialRejectionMapped(() =>
          getAuthenticatedSongListDetail(this.http, auth, id, options.limit),
        )
      : null;
  }

  public async getMusicPlay(
    token: string | undefined,
    songmid: string,
    quality?: string | number,
    mediaId?: string,
    options?: PlaybackOptions,
  ): Promise<Dictionary | null> {
    const auth = await this.authFor(token);
    return auth
      ? withCredentialRejectionMapped(() =>
          getAuthenticatedPlayUrls(
            this.http,
            auth,
            this.streamCdnSelector,
            songmid,
            quality,
            mediaId,
            options,
            this.playbackHintsEnabled,
          ),
        )
      : null;
  }

  public async resolveSession(token?: string): Promise<AuthSession | null> {
    return this.authFor(token);
  }

  /**
   * Electron's lifeline, unchanged in shape. A sealed resolver has no repository to swap, so the
   * call is a no-op there rather than an error: the hook exists for hosts that keep credentials on
   * the server, and a runtime that does not is not misconfigured for ignoring it.
   */
  public configureAuthSessionRepository(repository: AuthSessionRepository): void {
    this.sessionResolver.useRepository?.(repository);
  }

  public async logout(token?: string): Promise<void> {
    if (token) await this.sessionResolver.revoke(token);
    for (const session of this.qrSessionStore.values()) this.dropSession(session);
  }
}

export const createQrLoginService = (dependencies: QrLoginDependencies = {}): QrLoginService =>
  new QrLoginServiceImpl(dependencies);
