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

const COOKIE_NAME = /^[A-Za-z0-9_]{1,40}$/;
const COOKIE_NAME_LIMIT = 20;

/**
 * MQTT 通道（手机 QQ、QQ 音乐 App）收到 `cookies` 时，只记录 cookie 名称和 `tmeLoginType` 的数字。
 * 用来分辨不同 App、不同账号类型扫码时回调内容有什么不同；任何 cookie 的值都不记录。
 */
export const logQqCookies = (payload: unknown, loginChannel: 'qq' | 'qqmusic' = 'qq'): void => {
  try {
    const body =
      payload !== null && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    const cookies =
      body.cookies !== null && typeof body.cookies === 'object' && !Array.isArray(body.cookies)
        ? (body.cookies as Record<string, unknown>)
        : {};
    const cookieNames = Object.keys(cookies)
      .filter((name) => COOKIE_NAME.test(name))
      .sort()
      .slice(0, COOKIE_NAME_LIMIT);
    const entry = cookies.tmeLoginType;
    const raw =
      entry !== null && typeof entry === 'object'
        ? (entry as Record<string, unknown>).value
        : undefined;
    const tmeLoginType =
      typeof raw === 'number' && Number.isSafeInteger(raw)
        ? raw
        : typeof raw === 'string' && /^\d{1,3}$/.test(raw)
          ? Number(raw)
          : undefined;
    logger.info('qq-auth.qq-cookies', {
      loginChannel,
      cookieNames,
      ...(tmeLoginType === undefined ? {} : { tmeLoginType }),
      hasCommConf: body.commConf !== null && typeof body.commConf === 'object',
    });
  } catch {
    // Optional host log sinks must never turn a valid login into a failure.
  }
};

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
