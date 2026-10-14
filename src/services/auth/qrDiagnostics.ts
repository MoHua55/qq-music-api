import { logger } from '../../util/logger';
import type {
  QrFailureReason,
  QrFailureStage,
  QrSessionRecord,
  QrState,
  RuntimeCapabilities,
} from './qrTypes';

// src/services/auth/qrDiagnostics.ts

const attempts = new WeakMap<QrSessionRecord, number>();
let nextAttemptId = 0;

interface WechatQrDiagnostic {
  outcome?: 'status' | 'budget-expired' | 'error';
  durationMs?: number;
  budgetMs?: number;
  upstreamCode?: number;
  upstreamHttpStatus?: number;
  failureReason?: QrFailureReason;
  failureStage?: QrFailureStage;
  eventType?:
    | 'waiting'
    | 'scanned'
    | 'authorized'
    | 'cookies'
    | 'canceled'
    | 'timeout'
    | 'loginFailed'
    | 'unknown';
  previousState?: QrState;
  state?: QrState;
  ignored?: boolean;
  apiCode?: 800 | 801 | 802 | 803;
  sessionMode?: RuntimeCapabilities['sessionMode'];
  pollErrors?: number;
}

/** A process-local counter correlates one attempt without deriving anything from a QR or account. */
export const logWechatQr = (
  session: QrSessionRecord,
  event: 'poll' | 'qr-state' | 'qr-check',
  fields: WechatQrDiagnostic,
): void => {
  if (session.channel !== 'wechat') return;
  let attemptId = attempts.get(session);
  if (attemptId === undefined) {
    attemptId = ++nextAttemptId;
    attempts.set(session, attemptId);
  }
  try {
    logger.info(`qq-auth.wechat-${event}`, { attemptId, loginChannel: 'wechat', ...fields });
  } catch {
    // Optional host log sinks must never turn a valid poll or login into a failure.
  }
};
