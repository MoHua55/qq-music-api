import { PLAYBACK_HINT_MESSAGES, type PlaybackHint } from './playbackHints';
import { classifyPlaybackRestriction, type PlaybackRestriction } from './playbackRestriction';

export type QualityFileFailure = 'quality-file-unavailable' | 'quality-detail-unavailable';

/** 只守门 ape。缺少可靠数字与确认没文件分开；不从错误码猜文件是否存在。 */
export const apeFileFailureOf = (track: unknown): QualityFileFailure | undefined => {
  const file = track && typeof track === 'object' ? (track as { file?: unknown }).file : undefined;
  const raw =
    file && typeof file === 'object' ? (file as { size_ape?: unknown }).size_ape : undefined;
  const size = typeof raw === 'string' && /^\d{1,15}$/.test(raw) ? Number(raw) : raw;
  if (typeof size !== 'number' || !Number.isSafeInteger(size)) return 'quality-detail-unavailable';
  return size > 0 ? undefined : 'quality-file-unavailable';
};

export const qualityFileRestriction = (
  authenticated: boolean,
  failureReason: QualityFileFailure,
): PlaybackRestriction & { hint: PlaybackHint } => {
  const key =
    failureReason === 'quality-file-unavailable'
      ? 'playback.quality-file-unavailable'
      : 'playback.quality-detail-unavailable';
  return {
    ...classifyPlaybackRestriction({ authenticated, quality: 'ape', codes: {} }),
    failureReason,
    hint: { key, message: PLAYBACK_HINT_MESSAGES[key] },
  };
};

/** quality=best 依次尝试的音质，和 Folia 的回退顺序一致。 */
export const BEST_QUALITY_ORDER = ['flac', '320', '128'] as const;
export type BestQuality = (typeof BEST_QUALITY_ORDER)[number];

const sizeOf = (file: unknown, key: string): number | undefined => {
  const raw = file && typeof file === 'object' ? (file as Record<string, unknown>)[key] : undefined;
  const size = typeof raw === 'string' && /^\d{1,15}$/.test(raw) ? Number(raw) : raw;
  return typeof size === 'number' && Number.isSafeInteger(size) ? size : undefined;
};

/**
 * quality=best 这首歌要试哪些音质：详情里 size_flac、size_320mp3 大于 0 才试那一级，128 一定是最后一级。
 * 详情读不到（undefined）或数字不可靠时只试 128，不猜文件。
 */
export const bestQualityLevelsOf = (track: unknown): BestQuality[] => {
  const file = track && typeof track === 'object' ? (track as { file?: unknown }).file : undefined;
  return [
    ...((sizeOf(file, 'size_flac') ?? 0) > 0 ? (['flac'] as const) : []),
    ...((sizeOf(file, 'size_320mp3') ?? 0) > 0 ? (['320'] as const) : []),
    '128',
  ];
};
