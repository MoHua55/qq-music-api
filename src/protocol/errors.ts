import {
  type BusinessErrorKind,
  type CodeEvidence,
  isBusinessErrorKey,
  lookupBusinessCode,
  type UpstreamOperation,
} from './businessCodes';

export type QqErrorKind =
  | BusinessErrorKind
  | 'input'
  | 'auth-missing'
  | 'network'
  | 'upstream-http'
  | 'invalid-response'
  | 'unexpected';

export interface QqFailureContext {
  operation?: UpstreamOperation;
  readOnly?: boolean;
  networkPhase?: 'connect' | 'read' | 'unknown';
}

interface UpstreamDetails {
  upstreamCode?: unknown;
  upstreamGlobalCode?: unknown;
  upstreamSubCode?: unknown;
  upstreamHttpStatus?: unknown;
  retryAfterMs?: unknown;
}

export type QqFailure =
  | { source: 'input' | 'auth-missing' | 'invalid-response' | 'unexpected' }
  | ({ source: 'business'; upstreamCode: unknown } & UpstreamDetails)
  | ({ source: 'gateway'; upstreamGlobalCode: unknown } & UpstreamDetails)
  | ({ source: 'http'; upstreamHttpStatus: unknown } & UpstreamDetails)
  | { source: 'network'; error: unknown };

interface QqErrorOptions extends UpstreamDetails {
  errorKey?: string;
  evidence?: CodeEvidence;
  retryable?: boolean;
}

export interface SafeQqError {
  kind: QqErrorKind;
  errorKey: string;
  message: string;
  retryable: boolean;
  upstreamCode?: number;
  upstreamGlobalCode?: number;
  upstreamSubCode?: number;
  upstreamHttpStatus?: number;
  retryAfterMs?: number;
  evidence?: CodeEvidence;
}

const defaults: Record<QqErrorKind, { key: string; message: string; status: number }> = {
  input: { key: 'input.invalid', message: 'Invalid request', status: 400 },
  'auth-missing': { key: 'auth.required', message: 'Login required', status: 401 },
  'credential-invalid': { key: 'auth.credential-invalid', message: 'Login required', status: 401 },
  'rate-limited': { key: 'upstream.rate-limited', message: 'Too many requests', status: 429 },
  network: { key: 'network.unknown', message: 'Network request failed', status: 502 },
  'upstream-http': { key: 'upstream.http', message: 'Upstream HTTP request failed', status: 502 },
  'upstream-gateway': {
    key: 'upstream.gateway-rejected',
    message: 'Upstream gateway rejected the request',
    status: 502,
  },
  'upstream-business': {
    key: 'upstream.unknown',
    message: 'Upstream rejected the request',
    status: 502,
  },
  'not-found': { key: 'resource.not-found', message: 'No matching data', status: 422 },
  'invalid-response': {
    key: 'upstream.invalid-response',
    message: 'Invalid upstream response',
    status: 502,
  },
  unexpected: { key: 'internal.unexpected', message: 'Service request failed', status: 500 },
  'device-limit': {
    key: 'auth.device-limit',
    message: 'Login was rejected; device policy may apply',
    status: 502,
  },
  'account-restricted': {
    key: 'auth.account-restricted',
    message: 'Upstream rejected this account login',
    status: 502,
  },
  'account-banned': {
    key: 'auth.account-banned',
    message: 'Upstream rejected this account login',
    status: 502,
  },
  'account-binding': {
    key: 'auth.account-binding',
    message: 'Upstream rejected this account login',
    status: 502,
  },
  'login-rejected': {
    key: 'auth.login-rejected',
    message: 'Upstream rejected this login',
    status: 502,
  },
};

const networkKeys = new Set([
  'network.dns',
  'network.refused',
  'network.reset',
  'network.timeout',
  'network.aborted',
  'network.unknown',
]);
const evidenceLevels = new Set<CodeEvidence>([
  'existing-behavior',
  'observed-response',
  'protocol-reference',
  'third-party-report',
]);
const integerOf = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;
const statusOf = (value: unknown): number | undefined => {
  const status = integerOf(value);
  return status !== undefined && status >= 100 && status <= 599 ? status : undefined;
};
const delayOf = (value: unknown): number | undefined => {
  const delay = integerOf(value);
  return delay !== undefined && delay >= 0 ? delay : undefined;
};
const propertyOf = (value: unknown, key: string): unknown => {
  try {
    return value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
  } catch {
    return undefined;
  }
};

/** Contains only fixed messages, allowlisted keys and safe scalar observations, never native causes. */
export class QqApiError extends Error {
  public readonly kind: QqErrorKind;
  public readonly errorKey: string;
  public readonly retryable: boolean;
  public readonly upstreamCode?: number;
  public readonly upstreamGlobalCode?: number;
  public readonly upstreamSubCode?: number;
  public readonly upstreamHttpStatus?: number;
  public readonly retryAfterMs?: number;
  public readonly evidence?: CodeEvidence;

  constructor(kind: QqErrorKind, options: QqErrorOptions = {}) {
    const safeKind = Object.hasOwn(defaults, kind) ? kind : 'unexpected';
    super(defaults[safeKind].message);
    this.name = 'QqApiError';
    this.kind = safeKind;
    const key = options.errorKey;
    this.errorKey =
      key &&
      (key === defaults[safeKind].key ||
        (safeKind === 'network' && networkKeys.has(key)) ||
        isBusinessErrorKey(key, safeKind))
        ? key
        : defaults[safeKind].key;
    this.retryable = options.retryable === true && ['network', 'upstream-http'].includes(safeKind);
    this.upstreamCode = integerOf(options.upstreamCode);
    this.upstreamGlobalCode = integerOf(options.upstreamGlobalCode);
    this.upstreamSubCode = integerOf(options.upstreamSubCode);
    this.upstreamHttpStatus = statusOf(options.upstreamHttpStatus);
    this.retryAfterMs = delayOf(options.retryAfterMs);
    this.evidence = evidenceLevels.has(options.evidence as CodeEvidence)
      ? options.evidence
      : undefined;
  }

  public toJSON(): SafeQqError {
    return {
      kind: this.kind,
      errorKey: this.errorKey,
      message: this.message,
      retryable: this.retryable,
      ...(this.upstreamCode === undefined ? {} : { upstreamCode: this.upstreamCode }),
      ...(this.upstreamGlobalCode === undefined
        ? {}
        : { upstreamGlobalCode: this.upstreamGlobalCode }),
      ...(this.upstreamSubCode === undefined ? {} : { upstreamSubCode: this.upstreamSubCode }),
      ...(this.upstreamHttpStatus === undefined
        ? {}
        : { upstreamHttpStatus: this.upstreamHttpStatus }),
      ...(this.retryAfterMs === undefined ? {} : { retryAfterMs: this.retryAfterMs }),
      ...(this.evidence === undefined ? {} : { evidence: this.evidence }),
    };
  }
}

const networkFailure = (raw: unknown, context: QqFailureContext): QqApiError => {
  const name = propertyOf(raw, 'name');
  const directCode = propertyOf(raw, 'code');
  const code = directCode ?? propertyOf(propertyOf(raw, 'cause'), 'code');
  if (
    name === 'AbortError' ||
    name === 'CanceledError' ||
    code === 'ERR_CANCELED' ||
    code === 'ABORT_ERR'
  )
    return new QqApiError('network', { errorKey: 'network.aborted' });
  const keys: Record<string, string> = {
    ENOTFOUND: 'network.dns',
    EAI_AGAIN: 'network.dns',
    ECONNREFUSED: 'network.refused',
    ECONNRESET: 'network.reset',
    ETIMEDOUT: 'network.timeout',
    ECONNABORTED: 'network.timeout',
  };
  const key =
    name === 'TimeoutError'
      ? 'network.timeout'
      : typeof code === 'string' && Object.hasOwn(keys, code)
        ? keys[code]
        : 'network.unknown';
  return new QqApiError('network', {
    errorKey: key,
    // A reset or timeout is not known to be a connection failure unless the transport says so.
    retryable:
      key !== 'network.unknown' && context.readOnly === true && context.networkPhase === 'connect',
  });
};

/** Used by new protocol/transport adapters. Existing route errors and status rules are untouched. */
export const normalizeQqFailure = (
  failure: QqFailure,
  context: QqFailureContext = {},
): QqApiError => {
  if (failure.source === 'network') return networkFailure(failure.error, context);
  if (
    failure.source === 'input' ||
    failure.source === 'auth-missing' ||
    failure.source === 'invalid-response' ||
    failure.source === 'unexpected'
  )
    return new QqApiError(failure.source);
  const details = failure as UpstreamDetails;
  const http = statusOf(details.upstreamHttpStatus);
  // An HTTP failure wins over any body code. A 503 must never be treated as invalid credentials.
  if (http !== undefined && http >= 400)
    return new QqApiError(http === 429 ? 'rate-limited' : 'upstream-http', {
      ...details,
      retryable: context.readOnly === true && http >= 500,
    });
  if (failure.source === 'http') return new QqApiError('invalid-response', details);
  const global = integerOf(details.upstreamGlobalCode);
  if (global !== undefined && global !== 0) {
    const info = lookupBusinessCode(global, context.operation, 'gateway');
    return new QqApiError('upstream-gateway', { ...details, evidence: info?.evidence });
  }
  if (failure.source === 'gateway') return new QqApiError('invalid-response', details);
  const code = integerOf(details.upstreamCode);
  if (code === undefined || code === 0) return new QqApiError('invalid-response', details);
  const info = lookupBusinessCode(code, context.operation);
  return new QqApiError(info?.kind ?? 'upstream-business', {
    ...details,
    errorKey: info?.errorKey,
    evidence: info?.evidence,
  });
};

export interface NewRouteErrorResponse {
  status: number;
  headers: Record<string, string>;
  body: SafeQqError & { code: number };
}

/** New routes only: never reinterpret the legacy 200-with-body-code or QR 800 contracts. */
export const toNewRouteErrorResponse = (error: unknown): NewRouteErrorResponse => {
  const safe = error instanceof QqApiError ? error : new QqApiError('unexpected');
  const status = defaults[safe.kind].status;
  return {
    status,
    headers:
      safe.retryAfterMs === undefined
        ? {}
        : { 'Retry-After': String(Math.ceil(safe.retryAfterMs / 1000)) },
    body: { code: status, ...safe.toJSON() },
  };
};
