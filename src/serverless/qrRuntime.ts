import type { AndroidDevice } from '../services/auth/androidDevice';
import type { DeviceContextRepository } from '../services/auth/deviceContext';
import { createMemoryDeviceContextRepository } from '../services/auth/deviceContextStore';
import type { AuthHttpClient } from '../services/auth/httpClient';
import {
  createRelayQqQrDriver,
  type QrChannelDriver,
  type QrLoginChannel,
  type QrSessionRecord,
  type QrSessionRepository,
  type RuntimeCapabilities,
} from '../services/auth/qrLogin';
import { deriveAndroidDevice } from './derivedDevice';
import type { ServerlessEnv, ServerlessOptions } from './index';
import { AUTH_COOKIE_NAME } from './response';
import type { SealedQrDeviceStateV1 } from './sealedQrState';
export const CHECK_BUDGET_MS = 20_000;
export const tokenFromCookieString = (cookie: string): string | undefined => {
  for (const entry of cookie.split(';')) {
    const separator = entry.indexOf('=');
    if (separator <= 0) continue;
    if (entry.slice(0, separator).trim() === AUTH_COOKIE_NAME)
      return entry.slice(separator + 1).trim() || undefined;
  }
  return undefined;
};

/** Header > query > cookie, the same order the Koa controller applies (§5.3 #2). */
export const secretsOf = (env: ServerlessEnv) => ({
  current: env.QQ_SESSION_SECRET ?? '',
  previous: env.QQ_SESSION_SECRET_PREVIOUS,
});

/**
 * 🔴 The single place this runtime decides what it can serve. Three call sites used to hard-code
 * `['wechat']` independently; deriving all of them from the injected relay is what makes "no relay
 * means no `qq`" impossible to get half-right.
 */
export const capabilitiesFor = (options: ServerlessOptions): RuntimeCapabilities => ({
  channels: options.qqRelay ? (['qq', 'wechat'] as const) : (['wechat'] as const),
  sessionMode: 'sealed',
});

/** The `qq` driver exists only when a relay does; `wechat` keeps the service's own default. */
export const driversFor = (
  options: ServerlessOptions,
  http: AuthHttpClient,
  deviceRepository: DeviceContextRepository,
  base: AndroidDevice,
): Partial<Record<QrLoginChannel, QrChannelDriver>> | undefined =>
  options.qqRelay
    ? {
        qq: createRelayQqQrDriver({
          http,
          // Read through the repository rather than captured: `createSession` bootstraps QIMEI and
          // the Android session and persists them, so the device the QR is created with has to be
          // the post-bootstrap one, not the deterministic base this repository was seeded with.
          device: () => deviceRepository.load() ?? base,
          relay: options.qqRelay,
        }),
      }
    : undefined;

/**
 * A `QrSessionRepository` that answers `load()` with exactly the record a sealed `unikey` was
 * opened into, and never actually persists anything `/login/qr/create` or `/login/qr/check`
 * mutate — there is nowhere to write it back to, and nothing past this one call needs it.
 */
export const replayQrSessionRepository = (records: QrSessionRecord[]): QrSessionRepository => ({
  kind: 'sealed-replay',
  load: () => records,
  save: () => undefined,
});

/**
 * Rebuilds one QR record from a sealed payload.
 *
 * 🔴 `qrcodeId` is not a duplicate of `identifier`: `exchangeQqLogin` reads *that* field as the
 * `qrCodeID` exchange parameter, and a record that carries only `identifier` fails at the very last
 * step of a successful scan — after the user has already approved on their phone. The App channel
 * is the only one where the two fields both apply, which is why `createQr` sets both.
 */
export const replayedRecord = (
  key: string,
  payload: { channel: QrLoginChannel; createdAt: number; expiresAt: number; identifier: string },
  state: QrSessionRecord['state'],
): QrSessionRecord => ({
  key,
  channel: payload.channel,
  state,
  createdAt: payload.createdAt,
  expiresAt: payload.expiresAt,
  identifier: payload.identifier,
  ...(payload.channel === 'qq' ? { qrcodeId: payload.identifier } : {}),
});

/**
 * A `QrSessionRepository` that starts empty and remembers the last thing saved into it, so
 * `/login/qr/key` can read back the record `createSession` + `createQr` just built — the state
 * that has to be sealed into the `unikey` — without `QrLoginService` exposing it directly.
 */
export const capturingQrSessionRepository = (): {
  repository: QrSessionRepository;
  latest: () => QrSessionRecord[];
} => {
  let saved: QrSessionRecord[] = [];
  return {
    repository: {
      kind: 'sealed-capture',
      load: () => [],
      save: (sessions) => {
        saved = sessions.slice();
      },
    },
    latest: () => saved,
  };
};

/** Layers the live fields a fresh isolate cannot re-derive onto the deterministic base device. */
const withQrDeviceState = (base: AndroidDevice, saved?: SealedQrDeviceStateV1): AndroidDevice =>
  saved
    ? {
        ...base,
        ...(saved.qimei === undefined ? {} : { qimei: saved.qimei }),
        ...(saved.qimei36 === undefined ? {} : { qimei36: saved.qimei36 }),
        ...(saved.qimeiSavedAt === undefined ? {} : { qimeiSavedAt: saved.qimeiSavedAt }),
        ...(saved.sessionUid === undefined ? {} : { sessionUid: saved.sessionUid }),
        ...(saved.sessionSid === undefined ? {} : { sessionSid: saved.sessionSid }),
        ...(saved.sessionVkey === undefined ? {} : { sessionVkey: saved.sessionVkey }),
      }
    : base;

export const qrDeviceRepositoryFor = async (
  secrets: { current: string; previous?: string },
  saved?: SealedQrDeviceStateV1,
): Promise<{ repository: DeviceContextRepository; base: AndroidDevice }> => {
  const base = withQrDeviceState(await deriveAndroidDevice(secrets.current), saved);
  return { repository: createMemoryDeviceContextRepository(base), base };
};
