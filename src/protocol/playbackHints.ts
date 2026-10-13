// src/protocol/playbackHints.ts
//
// 某首歌拿不到播放链接时，给使用者看的原因（`restriction.hint`）。只是提示：从单曲详情的候选讯号挑一句，
// 不改 `restriction.key`、不改证据等级。讯号来自 2026-10 官方网页的观察（免费与绿钻各一个账号，
// 都在海外），还没有受控实验，所以文案都写「可能」。文案是英文预设，前端可以按 key 换成自己的。
// 零依赖，两个运行时共用。

export type PlaybackHintKey =
  | 'playback.maybe-region-restricted'
  | 'playback.maybe-music-pack'
  | 'playback.maybe-membership'
  | 'playback.maybe-taken-down';

export interface PlaybackHint {
  key: PlaybackHintKey;
  message: string;
}

export const PLAYBACK_HINT_MESSAGES: Readonly<Record<PlaybackHintKey, string>> = {
  'playback.maybe-region-restricted': 'This song may not be available in your region.',
  'playback.maybe-music-pack': 'This song may need a paid music pack to play.',
  'playback.maybe-membership': 'This song may need a VIP membership to play in full.',
  'playback.maybe-taken-down': "This song can't be played right now. It may have been taken down.",
};

/** 限制提示 ID：地区类与会员类（`PayAlertH5` 的 `msginfo`）。14 只关下载，不算。 */
const REGION_MESSAGE_IDS = new Set([18, 23, 32]);
const MEMBERSHIP_MESSAGE_IDS = new Set([8, 13]);
/** 歌曲 `action.alert` 指到「开通付费音乐包」的弹窗。 */
const MUSIC_PACK_ALERT = 11;

const read = (value: unknown, key: string): unknown => {
  try {
    return value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
  } catch {
    return undefined;
  }
};

/** 安全整数照收，纯数字字符串换成整数，其他都当没有。 */
const integerOf = (value: unknown): number | undefined => {
  const parsed = typeof value === 'string' && /^-?\d{1,15}$/.test(value) ? Number(value) : value;
  return typeof parsed === 'number' && Number.isSafeInteger(parsed) ? parsed : undefined;
};

const hint = (key: PlaybackHintKey): PlaybackHint => ({
  key,
  message: PLAYBACK_HINT_MESSAGES[key],
});

/**
 * `trackInfo` 是同一个会话读到的单曲详情（`track_info`）；读不到时传 `undefined`，给兜底的「可能已下架」。
 * 顺序：地区 > 付费音乐包 > 会员 > 兜底。
 */
export const playbackHintOf = (trackInfo: unknown): PlaybackHint => {
  const action = read(trackInfo, 'action');
  const msgid = integerOf(read(action, 'msgid'));
  if (
    (msgid !== undefined && REGION_MESSAGE_IDS.has(msgid)) ||
    integerOf(read(trackInfo, 'ov')) === 1
  )
    return hint('playback.maybe-region-restricted');
  if (integerOf(read(action, 'alert')) === MUSIC_PACK_ALERT)
    return hint('playback.maybe-music-pack');
  if (
    integerOf(read(read(trackInfo, 'pay'), 'pay_play')) === 1 ||
    (msgid !== undefined && MEMBERSHIP_MESSAGE_IDS.has(msgid))
  )
    return hint('playback.maybe-membership');
  return hint('playback.maybe-taken-down');
};
