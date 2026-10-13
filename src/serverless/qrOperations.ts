import type { QrRouteService } from '../routes/operations/types';
import type { AuthHttpClient } from '../services/auth/httpClient';
import type { QrLoginService } from '../services/auth/qrLogin';
import { createQrLoginService, QrLoginServiceError } from '../services/auth/qrLogin';
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
      capabilities: capabilitiesFor(options),
      drivers: driversFor(options, http, deviceRepository, base),
      checkBudgetMs: CHECK_BUDGET_MS,
    });

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
      capabilities: capabilitiesFor(options),
      drivers: driversFor(options, http, deviceRepository, base),
      checkBudgetMs: CHECK_BUDGET_MS,
    });
    return service.createQr(key);
  },
});
