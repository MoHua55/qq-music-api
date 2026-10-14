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
