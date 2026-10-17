import type { QrRouteService } from '../routes/operations/types';
import type { AuthHttpClient } from '../services/auth/httpClient';
import type { QrLoginService } from '../services/auth/qrLogin';
import { createQrLoginService, QrLoginServiceError } from '../services/auth/qrLogin';
import { isMqttLoginChannel, type QrLoginChannel } from '../services/auth/qrTypes';
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
  usesPtlogin,
} from './qrRuntime';
import { openQrState, sealQrState } from './sealedQrState';
import { createSealedSessionResolver } from './sealedResolver';

interface QrHostContext {
  env: ServerlessEnv;
  options: ServerlessOptions;
  service(): Promise<QrLoginService>;
}
// 每次请求的封存状态和服务组合，保留原入口的设备、Cookie 与 relay 生命周期。
export const createServerlessQrOperations = ({
  env,
  options,
  service: getService,
}: QrHostContext): Partial<QrRouteService> => ({
  createSession: async (channel) => {
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
      capabilities: capabilitiesFor(options, env),
      drivers: driversFor(options, http, deviceRepository, base, env),
      checkBudgetMs: CHECK_BUDGET_MS,
    });

    const key = await service.createSession(channel as QrLoginChannel);
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
        // 纯 HTTP 扫码的图没法再要一次，只有它把图一起封进去（见 sealedQrState.ts）。
        ...(record.channel === 'qq' && usesPtlogin(options, env) && record.imageUrl
          ? { image: record.imageUrl }
          : {}),
      },
      secrets.current,
    );
    return unikey;
  },
  createQr: async (key) => {
    const secrets = secretsOf(env);
    const payload = await openQrState(key, secrets, Date.now());
    if (!payload) {
      throw new QrLoginServiceError('QR session not found or expired', 404);
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
      capabilities: capabilitiesFor(options, env),
      drivers: driversFor(options, http, deviceRepository, base, env),
      checkBudgetMs: CHECK_BUDGET_MS,
    });
    return service.createQr(key);
  },
  checkQr: async (key) => {
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
      capabilities: capabilitiesFor(options, env),
      drivers: driversFor(options, http, deviceRepository, base, env),
      checkBudgetMs: CHECK_BUDGET_MS,
    });
    return service.checkQr(key, CHECK_BUDGET_MS);
  },
  cancelSession: async (key) => {
    const relay = options.qqRelay;
    if (relay) {
      const payload = await openQrState(key, secretsOf(env), Date.now()).catch(() => null);
      // Best effort by contract: an unknown, tampered or already-released key is still a success.
      if (payload && isMqttLoginChannel(payload.channel))
        await relay.close(payload.identifier).catch(() => undefined);
    }
    // §5.3 #5: always 200. Callers cancel fire-and-forget on dialog close.
    (await getService()).cancelSession(key);
  },
});
