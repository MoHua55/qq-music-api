// src/protocol/playbackDiagnostics.ts
//
// 取不到播放链接时，开发日志只留单曲条目里登记过的数字字段，给日后判断原因当证据。
// 这些数字的含义还没有实测，这里只记录、不解释；对外回应不受影响。零依赖，两个运行时共用。

/** `UrlGetVkey` 单曲条目里可能带失败原因的数字字段。不在这里的字段一律不记。 */
export const PLAYBACK_FAILURE_FIELDS = ['result', 'errtype', 'code', 'subcode'] as const;

export type PlaybackFailureField = (typeof PLAYBACK_FAILURE_FIELDS)[number];

/** 安全整数照收；纯数字字符串（上游有时把码写成字符串）换成整数；其他一律丢掉。 */
const safeIntegerOf = (value: unknown): number | undefined => {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : undefined;
  if (typeof value !== 'string' || !/^-?\d{1,15}$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
};

const read = (item: unknown, key: string): unknown => {
  try {
    return item && typeof item === 'object' ? (item as Record<string, unknown>)[key] : undefined;
  } catch {
    return undefined;
  }
};

export const playbackFailureCodesOf = (
  item: unknown,
): Partial<Record<PlaybackFailureField, number>> => {
  const codes: Partial<Record<PlaybackFailureField, number>> = {};
  for (const field of PLAYBACK_FAILURE_FIELDS) {
    const value = safeIntegerOf(read(item, field));
    if (value !== undefined) codes[field] = value;
  }
  return codes;
};

/** songmid 只收常见的字母数字写法，免得把任意上游文字带进日志。 */
export const loggableSongmid = (value: string): string | undefined =>
  /^[0-9A-Za-z_-]{1,64}$/.test(value) ? value : undefined;
