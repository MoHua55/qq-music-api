import type { UpstreamOperation } from '../../protocol/businessCodes';
import { readCgi } from '../../protocol/cgi';
import { QqApiError } from '../../protocol/errors';
import { createFetchCgiTransport } from '../../transport/fetchCgi';
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

/** 匿名旧 CGI 读取走协议层：一次请求、25 秒截止，不经过旧曲库的全局传输槽，不发送会话。 */
export const readAnonymousCgi = (
  path: string,
  params: Record<string, string | number>,
  operation: UpstreamOperation,
): Promise<Data> =>
  readCgi('https://c.y.qq.com', path, params, { operation, http: createFetchCgiTransport() });
