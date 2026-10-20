import type { UpstreamOperation } from '../../protocol/businessCodes';
import { normalizeQqFailure, QqApiError } from '../../protocol/errors';
import type { UpstreamPhase } from '../../util/safeError';
import { failureResult, type NewRouteResult } from '../recommend/newRouteResult';

export type Data = Record<string, unknown>;

export const objectOf = (value: unknown): Data => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new QqApiError('invalid-response');
  return value as Data;
};

export const arrayOf = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw new QqApiError('invalid-response');
  return value;
};

export const countOf = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

export const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');

export const integerOf = (
  raw: unknown,
  fallback: number | undefined,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): number => {
  if (raw === undefined && fallback !== undefined) return fallback;
  const text = typeof raw === 'string' || typeof raw === 'number' ? String(raw) : '';
  const value = /^\d+$/.test(text) ? Number(text) : Number.NaN;
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new QqApiError('input');
  return value;
};

/** 只保留已确认的标量字段，不交出账号标识、追踪信息或未知对象。 */
export const fieldsOf = (value: Data, names: readonly string[]): Data =>
  Object.fromEntries(
    names
      .filter(
        (key) =>
          typeof value[key] === 'string' ||
          typeof value[key] === 'boolean' ||
          (typeof value[key] === 'number' && Number.isFinite(value[key])),
      )
      .map((key) => [key, value[key]]),
  );

export const anonymousResult = async (
  phase: UpstreamPhase,
  run: () => Promise<NewRouteResult>,
): Promise<NewRouteResult> => {
  try {
    return await run();
  } catch (error) {
    return failureResult(phase, error);
  }
};

/** 新 CGI 读取自带一次请求与截止时间，不经过旧曲库的全局传输槽，不发送会话。 */
export const readAnonymousCgi = async (
  path: string,
  params: Record<string, string | number>,
  operation: UpstreamOperation,
): Promise<Data> => {
  const url = new URL(path, 'https://c.y.qq.com');
  url.search = new URLSearchParams(
    Object.entries({
      format: 'json',
      outCharset: 'utf-8',
      ...params,
    }).map(([key, value]) => [key, String(value)]),
  ).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method: 'GET',
        redirect: 'manual',
        headers: { Referer: 'https://y.qq.com/' },
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted)
        throw new QqApiError('network', { errorKey: 'network.timeout' });
      throw normalizeQqFailure({ source: 'network', error }, { operation, readOnly: true });
    }
    if (response.status >= 300 && response.status < 400) {
      void response.body?.cancel().catch(() => {});
      throw new QqApiError('upstream-http', { upstreamHttpStatus: response.status });
    }
    if (response.status < 200 || response.status >= 300) {
      void response.body?.cancel().catch(() => {});
      const retry = response.headers.get('Retry-After');
      const seconds = retry && /^\d+(?:\.\d+)?$/.test(retry) ? Number(retry) : undefined;
      throw normalizeQqFailure(
        {
          source: 'http',
          upstreamHttpStatus: response.status,
          ...(seconds === undefined ? {} : { retryAfterMs: Math.ceil(seconds * 1000) }),
        },
        { operation, readOnly: true },
      );
    }
    let bytes: ArrayBuffer;
    try {
      bytes = await response.arrayBuffer();
    } catch (error) {
      if (controller.signal.aborted)
        throw new QqApiError('network', { errorKey: 'network.timeout' });
      throw normalizeQqFailure({ source: 'network', error }, { operation, readOnly: true });
    }
    let body: unknown;
    try {
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        text = new TextDecoder('gb18030', { fatal: true }).decode(bytes);
      }
      const jsonp = /^\w+\(([\s\S]*)\);?\s*$/.exec(text);
      body = JSON.parse(jsonp ? jsonp[1] : text);
    } catch {
      throw new QqApiError('invalid-response');
    }
    const data = objectOf(body);
    if (typeof data.code !== 'number' || !Number.isSafeInteger(data.code))
      throw new QqApiError('invalid-response');
    if (data.code !== 0)
      throw normalizeQqFailure({ source: 'business', upstreamCode: data.code }, { operation });
    if (data.subcode !== undefined) {
      if (typeof data.subcode !== 'number' || !Number.isSafeInteger(data.subcode))
        throw new QqApiError('invalid-response');
      if (data.subcode !== 0)
        throw normalizeQqFailure({ source: 'business', upstreamCode: data.subcode }, { operation });
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
};
