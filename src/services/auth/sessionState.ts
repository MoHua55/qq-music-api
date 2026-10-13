import { logger } from '../../util/logger';
import { isAndroidDevice } from './androidDevice';
import type { AuthHttpClient } from './httpClient';
import {
  type AuthSession,
  type AuthSessionRepository,
  isSupportedLoginChannel,
  type QqCredential,
  type QrEventListener,
  type QrSessionRecord,
  type QrSessionRepository,
  type QrState,
  type SessionResolver,
} from './qrTypes';
import { isDictionary } from './values';

// src/services/auth/sessionState.ts
// 从认证入口搬出的同一套实现；协议、状态与对外回包沿用原规则。

export interface AuthSessionStore {
  get(token: string): AuthSession | null;
  set(session: AuthSession): void;
  delete(token: string): void;
  cleanup(): void;
  useRepository(repository: AuthSessionRepository): void;
}

export const cloneAuthSession = (session: AuthSession): AuthSession => ({
  ...session,
  credential: { ...session.credential },
  device: { ...session.device },
});

export const isQqCredential = (value: unknown): value is QqCredential => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const hasMusicId =
    (typeof candidate.musicid === 'string' && candidate.musicid.length > 0) ||
    (typeof candidate.musicid === 'number' && Number.isFinite(candidate.musicid));
  return (
    hasMusicId &&
    typeof candidate.musickey === 'string' &&
    candidate.musickey.length > 0 &&
    typeof candidate.loginType === 'number' &&
    Number.isFinite(candidate.loginType)
  );
};

/** A decrypted record is still untrusted: reject partial or hand-edited credentials on restore. */
export const isAuthSession = (value: unknown): value is AuthSession => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.token === 'string' &&
    candidate.token.length > 0 &&
    isQqCredential(candidate.credential) &&
    isAndroidDevice(candidate.device) &&
    typeof candidate.expiresAt === 'number' &&
    Number.isFinite(candidate.expiresAt)
  );
};

/**
 * Backwards-compatible default for servers that do not opt into persistence. The repository owns
 * copies so callers cannot mutate a stored credential through a previously returned object.
 */
export const createMemoryAuthSessionRepository = (
  seed: readonly AuthSession[] = [],
): AuthSessionRepository => {
  let stored = seed.filter(isAuthSession).map(cloneAuthSession);
  return {
    kind: 'memory',
    load: () => stored.map(cloneAuthSession),
    save: (sessions) => {
      stored = sessions.map(cloneAuthSession);
    },
  };
};

/**
 * Keeps repository failures outside the login protocol. A locked keychain or corrupt desktop state
 * must degrade to the previous in-memory behaviour instead of preventing QR login altogether.
 */
export const createAuthSessionStore = (
  initialRepository: AuthSessionRepository,
  now: () => number,
): AuthSessionStore => {
  let repository = initialRepository;
  const sessions = new Map<string, AuthSession>();

  const persist = (): void => {
    try {
      repository.save(Array.from(sessions.values(), cloneAuthSession));
    } catch (error) {
      logger.warn('qq-auth.auth-session.save-failed', {
        kind: repository.kind,
        name: error instanceof Error ? error.name : 'Error',
      });
    }
  };

  const removeExpired = (): boolean => {
    let removed = false;
    const current = now();
    for (const [token, session] of sessions) {
      if (session.expiresAt <= current) {
        sessions.delete(token);
        removed = true;
      }
    }
    return removed;
  };

  const restore = (): void => {
    let loaded: unknown;
    try {
      loaded = repository.load();
    } catch (error) {
      logger.warn('qq-auth.auth-session.load-failed', {
        kind: repository.kind,
        name: error instanceof Error ? error.name : 'Error',
      });
      return;
    }

    if (loaded === null || loaded === undefined) loaded = [];
    if (!Array.isArray(loaded)) {
      logger.warn('qq-auth.auth-session.invalid-state', { kind: repository.kind });
      return;
    }

    let rejectedCount = 0;
    for (const value of loaded) {
      if (!isAuthSession(value)) {
        rejectedCount += 1;
        continue;
      }
      sessions.set(value.token, cloneAuthSession(value));
    }
    const expiredRemoved = removeExpired();
    logger.info('qq-auth.auth-session.ready', {
      kind: repository.kind,
      restoredCount: sessions.size,
      rejectedCount,
    });
    // Rewrite only when validation pruned records, so corrupt or expired credentials are not
    // repeatedly decrypted and examined on every application launch.
    if (rejectedCount > 0 || expiredRemoved) persist();
  };

  restore();

  return {
    get: (token) => sessions.get(token) ?? null,
    set: (session) => {
      sessions.set(session.token, cloneAuthSession(session));
      persist();
    },
    delete: (token) => {
      if (sessions.delete(token)) persist();
    },
    cleanup: () => {
      if (removeExpired()) persist();
    },
    useRepository: (nextRepository) => {
      // The npm package starts listening as a side effect of require(). Folia injects its encrypted
      // repository immediately afterwards; preserving any already-created in-memory entries also
      // makes a late-but-valid configuration call lossless.
      const currentSessions = Array.from(sessions.values(), cloneAuthSession);
      sessions.clear();
      repository = nextRepository;
      restore();
      for (const session of currentSessions) {
        if (session.expiresAt > now()) sessions.set(session.token, session);
      }
      if (currentSessions.length > 0) persist();
    },
  };
};

/**
 * The `stored` backend: a thin adapter over the existing `AuthSessionStore`, which is left exactly
 * as it was. Nothing here re-implements lookup, persistence, expiry or repository swapping — the
 * store still owns all of it, so the six PR #2 behaviour guarantees continue to be enforced by the
 * same code that has always enforced them.
 *
 * The only logic that moves in is minting the token, which `finalizeLogin` used to do inline: the
 * port hands `issue()` a session without one precisely so a sealed backend can derive the token
 * from the credential instead of generating an unrelated identifier.
 */
/**
 * Neutral fallbacks for the three dependencies that used to default to a Node implementation.
 *
 * They exist so this module can be imported by any runtime without dragging `axios`, `ws` or
 * `node:fs` into the dependency closure, which is what made a serverless bundle impossible. Each
 * one fails on use rather than on construction, so a runtime that never touches the QQ App channel
 * — every serverless deployment, which is WeChat-only — is not forced to supply a listener it has
 * no implementation for.
 *
 * 🔴 Node, Electron and Docker never see these: `qrLogin.node.ts` supplies exactly the defaults
 * this module used to apply, so the packaged behaviour is unchanged.
 */
// Written as one string each on purpose. `tests/runtime.dependencies.test.ts` scans this directory
// for import specifiers with a regex, and splitting a literal right after an import keyword makes
// the remainder look like a package name to it.
export const MISSING_HTTP_MESSAGE =
  'No AuthHttpClient was provided. Node, Electron and Docker take one from the wrapper at `services/auth/qrLogin.node.ts`; a serverless runtime injects its fetch client.';

export const MISSING_LISTEN_MESSAGE =
  'The QQ App channel needs an MQTT listener and this runtime has none. Node supplies one via the wrapper at `services/auth/qrLogin.node.ts`; a serverless runtime should declare `wechat` only.';

export const unavailableHttpClient = (): AuthHttpClient => ({
  getCookieHeader: () => {
    throw new Error(MISSING_HTTP_MESSAGE);
  },
  request: () => {
    throw new Error(MISSING_HTTP_MESSAGE);
  },
  post: () => {
    throw new Error(MISSING_HTTP_MESSAGE);
  },
});

export const unavailableListen = (): QrEventListener => {
  throw new Error(MISSING_LISTEN_MESSAGE);
};

/**
 * Unlike `http`/`listen` above, `randomBytes` has no "this runtime doesn't need it" case — every
 * runtime mints QR session keys and (under `stored`) auth tokens — so its default has to actually
 * work rather than throw. `globalThis.crypto.getRandomValues` is the Web Crypto primitive Node
 * ≥20, Electron, Cloudflare Workers and the Vercel Edge Runtime all implement identically, unlike
 * `node:crypto`'s `randomBytes`, which the last of those refuses to deploy a bundle importing at
 * all. `qrLogin.node.ts` overrides this with the real `node:crypto` generator for Node, Electron
 * and Docker, exactly as it does for `http` and `listen`; every other caller — including every
 * `createQrLoginService()` call in `src/serverless/index.ts` — gets this one.
 */
export const randomBytesNeutral = (size: number): Buffer =>
  Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(size)));

export const createStoredSessionResolver = (options: {
  repository: AuthSessionRepository;
  now: () => number;
  randomBytes: (size: number) => Buffer;
}): SessionResolver => {
  const store = createAuthSessionStore(options.repository, options.now);
  return {
    mode: 'stored',
    issue: async (session) => {
      const token = options.randomBytes(32).toString('hex');
      store.set({ ...session, token });
      return token;
    },
    resolve: async (token) => (token ? store.get(token) : null),
    revoke: async (token) => {
      store.delete(token);
    },
    cleanup: () => {
      store.cleanup();
    },
    useRepository: (repository) => {
      store.useRepository(repository);
    },
  };
};

export const QR_STATES: readonly QrState[] = [
  'created',
  'creating',
  'waiting',
  'scanned',
  'exchanging',
  'confirmed',
  'expired',
  'failed',
];

/** A restored QR record is untrusted input, exactly like a restored auth session. */
export const isQrSessionRecord = (value: unknown): value is QrSessionRecord => {
  if (!isDictionary(value)) return false;
  const optionalText = (key: string): boolean =>
    value[key] === undefined ||
    (typeof value[key] === 'string' && (value[key] as string).length > 0);
  return (
    typeof value.key === 'string' &&
    value.key.length > 0 &&
    isSupportedLoginChannel(value.channel) &&
    QR_STATES.includes(value.state as QrState) &&
    Number.isFinite(value.createdAt) &&
    Number.isFinite(value.expiresAt) &&
    ['identifier', 'qrcodeId', 'imageUrl', 'authToken'].every(optionalText)
  );
};

export const cloneQrSessionRecord = (session: QrSessionRecord): QrSessionRecord => ({ ...session });

/** Backwards-compatible default: the process-local map the service has always used. */
export const createMemoryQrSessionRepository = (
  seed: readonly QrSessionRecord[] = [],
): QrSessionRepository => {
  let stored = seed.filter(isQrSessionRecord).map(cloneQrSessionRecord);
  return {
    kind: 'memory',
    load: () => stored.map(cloneQrSessionRecord),
    save: (sessions) => {
      stored = sessions.map(cloneQrSessionRecord);
    },
  };
};

export interface QrSessionStore {
  get(key: string): QrSessionRecord | null;
  set(session: QrSessionRecord): void;
  /** The service mutates records in place; this mirrors the current map into the repository. */
  persist(): void;
  delete(key: string): boolean;
  keys(): string[];
  values(): QrSessionRecord[];
}

/**
 * Mirrors `AuthSessionStore`: the map stays authoritative in-process and every mutation is
 * mirrored into the repository, whose failures never reach the login protocol.
 */
export const createQrSessionStore = (repository: QrSessionRepository): QrSessionStore => {
  const sessions = new Map<string, QrSessionRecord>();

  const persist = (): void => {
    try {
      repository.save(Array.from(sessions.values(), cloneQrSessionRecord));
    } catch (error) {
      logger.warn('qq-auth.qr-session.save-failed', {
        kind: repository.kind,
        name: error instanceof Error ? error.name : 'Error',
      });
    }
  };

  let loaded: unknown;
  try {
    loaded = repository.load();
  } catch (error) {
    logger.warn('qq-auth.qr-session.load-failed', {
      kind: repository.kind,
      name: error instanceof Error ? error.name : 'Error',
    });
  }
  for (const value of Array.isArray(loaded) ? loaded : []) {
    if (isQrSessionRecord(value)) sessions.set(value.key, cloneQrSessionRecord(value));
  }

  return {
    get: (key) => sessions.get(key) ?? null,
    set: (session) => {
      // Stored by reference on purpose: the service mutates the live record through the same
      // object it has always used, and only the repository ever receives a copy.
      sessions.set(session.key, session);
      persist();
    },
    persist,
    delete: (key) => {
      const removed = sessions.delete(key);
      if (removed) persist();
      return removed;
    },
    keys: () => Array.from(sessions.keys()),
    values: () => Array.from(sessions.values()),
  };
};
