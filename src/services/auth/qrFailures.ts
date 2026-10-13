import type { UpstreamOperation } from '../../protocol/businessCodes';
import {
  exposedUpstreamErrorKeyOf,
  isExposedUpstreamErrorKey,
} from '../../protocol/upstreamErrorKeys';
import { QqDeviceBootstrapError, QqProtocolError } from './musicuProtocol';
import {
  type QrFailureDetails,
  type QrFailureReason,
  type QrFailureStage,
  type QrLoginChannel,
  type QrPrimaryFailure,
  type QrState,
} from './qrTypes';
import { dictionaryOf } from './values';
import { WechatQrError } from './wechatLogin';

// src/services/auth/qrFailures.ts
// 从认证入口搬出的同一套实现；协议、状态与对外回包沿用原规则。

export const terminalState = (state: QrState): boolean =>
  ['confirmed', 'expired', 'failed'].includes(state);

/**
 * States where the user is already acting on this QR from their phone. A second login attempt must
 * not pull the rug out from under that, so these keep the 409; every other non-terminal state is an
 * abandoned code and is preemptible. `confirmed` is deliberately absent: it is terminal, it never
 * blocked a new session, and blocking it would 409 anyone who signs out and back in inside the TTL.
 */
export const confirmingState = (state: QrState): boolean =>
  ['scanned', 'exchanging'].includes(state);

/** Keeps whatever opaque number the upstream gave us, whichever channel produced the failure. */
export const upstreamCodeOf = (error: unknown): number | undefined => {
  if (error instanceof QqProtocolError) return error.upstreamCode;
  if (error instanceof WechatQrError) return error.upstreamCode;
  return undefined;
};

/** Which registered call each login step (`QqProtocolError.phase`) is, per channel. */
const LOGIN_UPSTREAM_OPERATIONS: Record<
  QrLoginChannel,
  Partial<Record<string, UpstreamOperation>>
> = {
  qq: {
    'credential-exchange': 'login.qq.credential-exchange',
    'get-login-user': 'login.qq.fallback-validation',
  },
  wechat: {
    'credential-exchange': 'login.wechat.credential-exchange',
    'get-login-user': 'login.wechat.credential-validation',
    'credential-refresh': 'login.wechat.credential-refresh',
  },
};

/**
 * A login failure's optional key. An HTTP failure or a non-zero gateway code takes precedence, so
 * only a business code from an otherwise healthy response counts, and then only when channel, step
 * and number all match a registered entry with a source.
 */
export const loginUpstreamErrorKeyOf = (
  error: unknown,
  channel: QrLoginChannel | undefined,
): string | undefined => {
  if (!channel || !(error instanceof QqProtocolError) || error.upstreamCode === undefined)
    return undefined;
  if (error.httpStatus < 200 || error.httpStatus > 299 || error.globalCode !== 0) return undefined;
  const operations = LOGIN_UPSTREAM_OPERATIONS[channel];
  const operation = Object.hasOwn(operations, error.phase) ? operations[error.phase] : undefined;
  return operation
    ? exposedUpstreamErrorKeyOf(operation, 'business', error.upstreamCode)
    : undefined;
};

/** Only stable, non-sensitive error categories cross the API boundary. */
export const qrFailureReasonOf = (error: unknown): QrFailureReason => {
  const status = upstreamHttpStatusOf(error);
  if (status !== undefined && status >= 400) return 'upstream-http-error';
  if (
    error instanceof QqProtocolError ||
    error instanceof WechatQrError ||
    error instanceof QqDeviceBootstrapError
  )
    return 'upstream-rejected';
  const message = error instanceof Error ? error.message : '';
  const knownMessages: Record<string, QrFailureReason> = {
    'MQTT WebSocket error': 'mqtt-websocket-error',
    'MQTT WebSocket closed': 'mqtt-websocket-closed',
    'MQTT packet timeout': 'mqtt-packet-timeout',
    'MQTT handshake timeout': 'mqtt-handshake-timeout',
    'MQTT handshake failed': 'mqtt-handshake-failed',
    'MQTT cookies missing login credential': 'missing-credential',
  };
  if (Object.hasOwn(knownMessages, message)) return knownMessages[message];
  const record = dictionaryOf(error);
  const code = record.code ?? dictionaryOf(record.cause).code;
  if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name))
    return 'network-timeout';
  if (code === 'ETIMEDOUT' || code === 'ECONNABORTED') return 'network-timeout';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns-error';
  if (code === 'ECONNRESET') return 'connection-reset';
  if (code === 'ECONNREFUSED') return 'connection-refused';
  if (code === 'ERR_NETWORK') return 'network-error';
  return 'unexpected-error';
};

export const safeDiagnosticNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;

export const upstreamHttpStatusOf = (error: unknown): number | undefined => {
  const record = dictionaryOf(error);
  const status = safeDiagnosticNumber(record.httpStatus ?? dictionaryOf(record.response).status);
  return status !== undefined && status >= 100 && status <= 599 ? status : undefined;
};

export const QR_FAILURE_STAGES = new Set<string>([
  'qr-key',
  'device-bootstrap',
  'session-bootstrap',
  'qr-create',
  'mqtt-listener',
  'qr-poll',
  'qr-event',
  'credential-payload',
  'credential-exchange',
  'credential-validation',
  'session-issue',
]);

export const QR_FAILURE_REASONS = new Set<string>([
  'local-backoff',
  'session-busy',
  'upstream-http-error',
  'upstream-rejected',
  'mqtt-websocket-error',
  'mqtt-websocket-closed',
  'mqtt-packet-timeout',
  'mqtt-handshake-timeout',
  'mqtt-handshake-failed',
  'missing-credential',
  'network-timeout',
  'dns-error',
  'connection-reset',
  'connection-refused',
  'network-error',
  'login-rejected',
  'user-canceled',
  'qr-timeout',
  'unexpected-error',
]);

const knownStage = (value: unknown): QrFailureStage | undefined =>
  typeof value === 'string' && QR_FAILURE_STAGES.has(value) ? (value as QrFailureStage) : undefined;

const knownReason = (value: unknown): QrFailureReason | undefined =>
  typeof value === 'string' && QR_FAILURE_REASONS.has(value)
    ? (value as QrFailureReason)
    : undefined;

/** Keeps only the validated fields; a record with none of them left is dropped entirely. */
const primaryFailureFieldsOf = (source: unknown): QrPrimaryFailure | undefined => {
  const record = dictionaryOf(source);
  const fields: QrPrimaryFailure = {
    failureStage: knownStage(record.failureStage),
    failureReason: knownReason(record.failureReason),
    upstreamCode: safeDiagnosticNumber(record.upstreamCode),
    upstreamErrorKey: isExposedUpstreamErrorKey(record.upstreamErrorKey)
      ? record.upstreamErrorKey
      : undefined,
  };
  return Object.values(fields).some((value) => value !== undefined) ? fields : undefined;
};

/** Restored records are untrusted. Select and validate only public diagnostic fields. */
export const failureDetailsOf = (source: QrFailureDetails): QrFailureDetails => {
  const details: QrFailureDetails = {
    failureStage: knownStage(source.failureStage),
    failureReason: knownReason(source.failureReason),
    upstreamHttpStatus: upstreamHttpStatusOf({ httpStatus: source.upstreamHttpStatus }),
    upstreamCode: safeDiagnosticNumber(source.upstreamCode),
    upstreamGlobalCode: safeDiagnosticNumber(source.upstreamGlobalCode),
    upstreamSubCode: safeDiagnosticNumber(source.upstreamSubCode),
  };
  // The newer fields are added only when present, so a failure without them keeps exactly the
  // keys it always had.
  if (isExposedUpstreamErrorKey(source.upstreamErrorKey))
    details.upstreamErrorKey = source.upstreamErrorKey;
  const primaryFailure = primaryFailureFieldsOf(source.primaryFailure);
  if (primaryFailure) details.primaryFailure = primaryFailure;
  if (source.fallbackAttempted === true) details.fallbackAttempted = true;
  return details;
};

export const qrFailureDetailsOf = (
  error: unknown,
  stage: QrFailureStage,
  channel?: QrLoginChannel,
): QrFailureDetails => {
  const details: QrFailureDetails = {
    failureStage: stage,
    failureReason: qrFailureReasonOf(error),
    upstreamHttpStatus: upstreamHttpStatusOf(error),
    upstreamCode: safeDiagnosticNumber(
      error instanceof QqDeviceBootstrapError ? error.outerCode : upstreamCodeOf(error),
    ),
    upstreamGlobalCode:
      error instanceof QqProtocolError ? safeDiagnosticNumber(error.globalCode) : undefined,
    upstreamSubCode:
      error instanceof QqDeviceBootstrapError ? safeDiagnosticNumber(error.innerCode) : undefined,
  };
  const upstreamErrorKey = loginUpstreamErrorKeyOf(error, channel);
  if (upstreamErrorKey) details.upstreamErrorKey = upstreamErrorKey;
  return details;
};

/** What a primary step failed with, in the shape `primaryFailure` carries. */
export const primaryFailureOf = (
  error: unknown,
  stage: QrFailureStage,
  channel: QrLoginChannel,
): QrPrimaryFailure => {
  const failure: QrPrimaryFailure = {
    failureStage: stage,
    failureReason: qrFailureReasonOf(error),
    upstreamCode: safeDiagnosticNumber(upstreamCodeOf(error)),
  };
  const upstreamErrorKey = loginUpstreamErrorKeyOf(error, channel);
  if (upstreamErrorKey) failure.upstreamErrorKey = upstreamErrorKey;
  return failure;
};
