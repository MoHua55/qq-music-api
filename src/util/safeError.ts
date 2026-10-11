/**
 * 把任意异常收敛成可以安全对外的摘要：旧路由的 500 回应和日志都只用它，不再直接带出原始异常。
 *
 * 原始异常（尤其是 AxiosError）会带着 config、请求地址、header、body、stack，甚至凭证和账号、
 * 设备标识。这里只按白名单挑出几样东西：已知的错误名、已知的网络错误码、合法的 HTTP 状态码、
 * 已知的协议阶段和安全整数业务码；message 一律由固定模板生成，不会出现原始文字。
 *
 * 这个模块不 import 任何东西：serverless 和日志路径都会用到它，依赖闭包必须保持干净。
 * 协议错误按 name 和字段识别，而不是 import 登录模块的类；字段不合法时退回通用摘要。
 */

/** `callMusicu` 等协议调用使用的阶段名；不在这里的阶段不会出现在回应或日志中。 */
export const UPSTREAM_PHASES = [
  'get-music-play',
  'get-cdn-dispatch',
  'get-session',
  'create-qr',
  'credential-exchange',
  'get-login-user',
  'credential-refresh',
  'get-user-playlists',
  'get-user-favorite-playlists',
  'get-user-favorite-albums',
  'get-song-list-detail',
  'get-owned-playlist-songs',
  'get-user-liked-songs',
] as const;

export type UpstreamPhase = (typeof UPSTREAM_PHASES)[number];

/** 旧路由 500 回应里 `error` 对象的形状，键名沿用 AxiosError 序列化后的同名字段。 */
export interface LegacyErrorBody {
  name: string;
  message: string;
  code?: string;
  status?: number;
}

/** 日志用的摘要，比回应多带协议阶段和业务码。 */
export interface SafeErrorSummary extends LegacyErrorBody {
  stage?: UpstreamPhase | 'device-bootstrap';
  upstreamCode?: number;
  globalCode?: number;
}

const GENERIC_MESSAGE = 'Service request failed';

const SAFE_NAMES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'AxiosError',
  'CanceledError',
  'AbortError',
  'TimeoutError',
  'QqProtocolError',
  'QqDeviceBootstrapError',
  'AuthCredentialRejectedError',
]);

const TIMEOUT_CODES = new Set([
  'ETIMEDOUT',
  'ECONNABORTED',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

const NETWORK_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'ERR_NETWORK',
  'UND_ERR_SOCKET',
]);

const SAFE_CODES = new Set([
  ...TIMEOUT_CODES,
  ...NETWORK_CODES,
  'ERR_CANCELED',
  'ERR_BAD_RESPONSE',
  'ERR_BAD_REQUEST',
  'ERR_FR_TOO_MANY_REDIRECTS',
]);

const PHASES = new Set<string>(UPSTREAM_PHASES);

/** getter 可能抛错、值可能是任意类型；读不到就当作没有。 */
const read = (value: unknown, key: string): unknown => {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null)
    return undefined;
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
};

const safeInteger = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;

const httpStatus = (value: unknown): number | undefined => {
  const status = safeInteger(value);
  return status !== undefined && status >= 100 && status <= 599 ? status : undefined;
};

const safeCode = (value: unknown): string | undefined =>
  typeof value === 'string' && SAFE_CODES.has(value) ? value : undefined;

const safeName = (value: unknown): string =>
  typeof value === 'string' && SAFE_NAMES.has(value) ? value : 'Error';

const codeOrUnknown = (value: number | undefined): string =>
  value === undefined ? 'unknown' : String(value);

/** `QqProtocolError`：阶段、HTTP 状态和两个业务码都合法才认，否则交给通用规则。 */
const protocolSummary = (error: unknown): SafeErrorSummary | undefined => {
  const status = httpStatus(read(error, 'httpStatus'));
  const globalCode = safeInteger(read(error, 'globalCode'));
  const rawUpstreamCode = read(error, 'upstreamCode');
  const upstreamCode = safeInteger(rawUpstreamCode);
  if (status === undefined || globalCode === undefined) return undefined;
  if (rawUpstreamCode !== undefined && upstreamCode === undefined) return undefined;
  const phase = read(error, 'phase');
  const stage =
    typeof phase === 'string' && PHASES.has(phase) ? (phase as UpstreamPhase) : undefined;
  return {
    name: 'QqProtocolError',
    message: `${stage ?? 'Upstream request'} failed (HTTP ${status}, global=${globalCode}, code=${codeOrUnknown(upstreamCode)})`,
    status,
    ...(stage === undefined ? {} : { stage }),
    ...(upstreamCode === undefined ? {} : { upstreamCode }),
    globalCode,
  };
};

const bootstrapSummary = (error: unknown): SafeErrorSummary | undefined => {
  const status = httpStatus(read(error, 'httpStatus'));
  const rawOuter = read(error, 'outerCode');
  const rawInner = read(error, 'innerCode');
  const outer = safeInteger(rawOuter);
  const inner = safeInteger(rawInner);
  if (status === undefined) return undefined;
  if (
    (rawOuter !== undefined && outer === undefined) ||
    (rawInner !== undefined && inner === undefined)
  )
    return undefined;
  return {
    name: 'QqDeviceBootstrapError',
    message: `QIMEI bootstrap failed (HTTP ${status}, outer=${codeOrUnknown(outer)}, inner=${codeOrUnknown(inner)})`,
    status,
    stage: 'device-bootstrap',
    ...(outer === undefined ? {} : { upstreamCode: outer }),
  };
};

/** 任意异常 → 日志可用的安全摘要。 */
export const summarizeError = (error: unknown): SafeErrorSummary => {
  const name = safeName(read(error, 'name'));
  if (name === 'QqProtocolError') {
    const summary = protocolSummary(error);
    if (summary) return summary;
  }
  if (name === 'QqDeviceBootstrapError') {
    const summary = bootstrapSummary(error);
    if (summary) return summary;
  }
  if (name === 'AuthCredentialRejectedError') {
    const upstreamCode = safeInteger(read(error, 'upstreamCode'));
    return {
      name,
      message: 'Login required',
      ...(upstreamCode === undefined ? {} : { upstreamCode }),
    };
  }

  const code = safeCode(read(error, 'code')) ?? safeCode(read(read(error, 'cause'), 'code'));
  const status =
    httpStatus(read(read(error, 'response'), 'status')) ??
    httpStatus(read(error, 'httpStatus')) ??
    httpStatus(read(error, 'status'));
  const extras = {
    ...(code === undefined ? {} : { code }),
    ...(status === undefined ? {} : { status }),
  };

  if (status !== undefined)
    return { name, message: `Upstream request failed (HTTP ${status})`, ...extras };
  if (name === 'TimeoutError' || (code !== undefined && TIMEOUT_CODES.has(code)))
    return { name, message: 'Upstream request timed out', ...extras };
  if (name === 'AbortError' || name === 'CanceledError' || code === 'ERR_CANCELED')
    return { name, message: 'Upstream request was canceled', ...extras };
  if (code !== undefined && NETWORK_CODES.has(code))
    return { name, message: `Upstream request failed (${code})`, ...extras };
  return { name, message: GENERIC_MESSAGE, ...extras };
};

/** 旧曲库服务 500 回应里的 `error` 对象：只保留名称、固定文案、白名单错误码和上游状态码。 */
export const toLegacyErrorBody = (error: unknown): LegacyErrorBody => {
  const { name, message, code, status } = summarizeError(error);
  return {
    name,
    message,
    ...(code === undefined ? {} : { code }),
    ...(status === undefined ? {} : { status }),
  };
};

/** 控制器层与 serverless 兜底 500 回应里的 `error` 字符串。 */
export const toLegacyErrorMessage = (error: unknown): string => summarizeError(error).message;
