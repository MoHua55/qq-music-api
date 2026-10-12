import { UPSTREAM_CODES, type UpstreamCodeEntry, type UpstreamCodeLayer } from './businessCodes';

/** 只有含义已登记、证据不止是见过响应的错误键才公开。 */
const isExposedEntry = (entry: UpstreamCodeEntry): boolean =>
  entry.errorKey !== 'upstream.unknown' &&
  entry.errorKey !== 'upstream.unclassified' &&
  entry.evidence !== 'observed-response' &&
  entry.evidence !== 'unknown';

/** 可以出现在对外响应中的错误键，也用于校验还原的记录。 */
export const EXPOSED_UPSTREAM_ERROR_KEYS: ReadonlySet<string> = new Set(
  UPSTREAM_CODES.filter(isExposedEntry).map((entry) => entry.errorKey),
);

export const isExposedUpstreamErrorKey = (value: unknown): value is string =>
  typeof value === 'string' && EXPOSED_UPSTREAM_ERROR_KEYS.has(value);

/** 调用、层级、数字都匹配且证据足够才给错误键；未知情况不推断。 */
export const exposedUpstreamErrorKeyOf = (
  operation: string,
  sourceLayer: UpstreamCodeLayer,
  upstreamCode: number,
): string | undefined => {
  const entry = UPSTREAM_CODES.find(
    (candidate) =>
      candidate.operation === operation &&
      candidate.sourceLayer === sourceLayer &&
      candidate.upstreamCode === upstreamCode,
  );
  return entry && isExposedEntry(entry) ? entry.errorKey : undefined;
};
