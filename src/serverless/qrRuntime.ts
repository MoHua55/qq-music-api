import type { AndroidDevice } from '../services/auth/androidDevice';
import type { DeviceContextRepository } from '../services/auth/deviceContext';
import { createMemoryDeviceContextRepository } from '../services/auth/deviceContextStore';
import type { AuthHttpClient } from '../services/auth/httpClient';
import { createPtloginQrDriver } from '../services/auth/qrDrivers';
import {
  createRelayQqQrDriver,
  type QrChannelDriver,
  type QrLoginChannel,
  type QrSessionRecord,
  type QrSessionRepository,
  type RuntimeCapabilities,
} from '../services/auth/qrLogin';
import { isMqttLoginChannel } from '../services/auth/qrTypes';
import { deriveAndroidDevice } from './derivedDevice';
import type { ServerlessEnv, ServerlessOptions } from './index';
import type { SealedQrDeviceStateV1 } from './sealedQrState';
// 一次 /login/qr/check 最多做多久；Folia 等登录请求 20 秒，这里留出余量。
export const CHECK_BUDGET_MS = 15_000;
export const secretsOf = (env: ServerlessEnv) => ({
  current: env.QQ_SESSION_SECRET ?? '',
  previous: env.QQ_SESSION_SECRET_PREVIOUS,
});

/** 没有 relay 时手机 QQ 走纯 HTTP 扫码；默认开，`QQ_PTLOGIN_HTTP_ENABLED` 设 `0` 或 `false` 才关。 */
export const ptloginEnabled = (env: ServerlessEnv): boolean =>
  !['0', 'false'].includes((env.QQ_PTLOGIN_HTTP_ENABLED ?? '').trim().toLowerCase());

/** 这个部署的 `qq` 通道是不是纯 HTTP 扫码（有 relay 时照旧走 MQTT）。 */
export const usesPtlogin = (options: ServerlessOptions, env: ServerlessEnv): boolean =>
  !options.qqRelay && ptloginEnabled(env);

/**
 * 🔴 The single place this runtime decides what it can serve. Three call sites used to hard-code
 * `['wechat']` independently; deriving all of them from the injected relay is what makes "no relay
 * means no `qq`" impossible to get half-right. 没有 relay 时 `qq` 改走纯 HTTP 扫码；`qqmusic`
 * 只有 MQTT 这一套，所以还是要 relay。
 */
export const capabilitiesFor = (
  options: ServerlessOptions,
  env: ServerlessEnv = {},
): RuntimeCapabilities => ({
  channels: options.qqRelay
    ? (['qq', 'wechat', 'qqmusic'] as const)
    : usesPtlogin(options, env)
      ? (['qq', 'wechat'] as const)
      : (['wechat'] as const),
  sessionMode: 'sealed',
});

/**
 * The MQTT drivers (`qq`, and `qqmusic` on the same flow) exist only when a relay does; `wechat`
 * keeps the service's own default.
 */
export const driversFor = (
  options: ServerlessOptions,
  http: AuthHttpClient,
  deviceRepository: DeviceContextRepository,
  base: AndroidDevice,
  env: ServerlessEnv = {},
): Partial<Record<QrLoginChannel, QrChannelDriver>> | undefined => {
  const relay = options.qqRelay;
  if (!relay) return usesPtlogin(options, env) ? { qq: createPtloginQrDriver() } : undefined;
  const relayDriver = () =>
    createRelayQqQrDriver({
      http,
      // Read through the repository rather than captured: `createSession` bootstraps QIMEI and
      // the Android session and persists them, so the device the QR is created with has to be
      // the post-bootstrap one, not the deterministic base this repository was seeded with.
      device: () => deviceRepository.load() ?? base,
      relay,
    });
  return { qq: relayDriver(), qqmusic: relayDriver() };
};

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
  payload: {
    channel: QrLoginChannel;
    createdAt: number;
    expiresAt: number;
    identifier: string;
    image?: string;
  },
  state: QrSessionRecord['state'],
): QrSessionRecord => ({
  key,
  channel: payload.channel,
  state,
  createdAt: payload.createdAt,
  expiresAt: payload.expiresAt,
  identifier: payload.identifier,
  ...(isMqttLoginChannel(payload.channel) ? { qrcodeId: payload.identifier } : {}),
  // 纯 HTTP 扫码的图跟着 unikey 走；有了它，`/login/qr/create` 就不会再去要一张新码。
  ...(payload.image ? { imageUrl: payload.image } : {}),
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
