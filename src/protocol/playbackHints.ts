// src/protocol/playbackHints.ts
//
// 某首歌拿不到播放链接时，给使用者看的原因（`restriction.hint`）。只是提示：不改 `restriction.key`、
// 不改证据等级。原因不能猜：会员、付费音乐包、地区、下架只有受控对照验证过的规则才能说（在
// `PLAYBACK_HINT_RULES` 里加），其他一律是「原因尚未确认」。文案是英文预设，前端可以按 key 换成自己的。
// 零依赖，两个运行时共用。

export type PlaybackHintKey =
  | 'playback.reason-unconfirmed'
  | 'playback.maybe-region-restricted'
  | 'playback.maybe-music-pack'
  | 'playback.maybe-membership'
  | 'playback.maybe-taken-down';

export interface PlaybackHint {
  key: PlaybackHintKey;
  message: string;
}

export const PLAYBACK_HINT_MESSAGES: Readonly<Record<PlaybackHintKey, string>> = {
  'playback.reason-unconfirmed':
    "This song can't be played right now. The exact reason isn't confirmed yet.",
  'playback.maybe-region-restricted': 'This song may not be available in your region.',
  'playback.maybe-music-pack': 'This song may need a paid music pack to play.',
  'playback.maybe-membership': 'This song may need a VIP membership to play in full.',
  'playback.maybe-taken-down': "This song can't be played right now. It may have been taken down.",
};

/** 一条验证过的规则：`trackInfo` 是同一个会话读到的单曲详情（`track_info`），读不到时是 `undefined`。 */
export interface PlaybackHintRule {
  key: Exclude<PlaybackHintKey, 'playback.reason-unconfirmed'>;
  matches: (trackInfo: unknown) => boolean;
}

/**
 * 受控对照下验证过的规则，按顺序挑第一条命中的。目前一条都没有；空的时候调用方不用为了挑提示去查单曲详情。
 */
export const PLAYBACK_HINT_RULES: readonly PlaybackHintRule[] = [];

const hint = (key: PlaybackHintKey): PlaybackHint => ({
  key,
  message: PLAYBACK_HINT_MESSAGES[key],
});

const matches = (rule: PlaybackHintRule, trackInfo: unknown): boolean => {
  try {
    return rule.matches(trackInfo);
  } catch {
    return false;
  }
};

export const playbackHintOf = (
  trackInfo: unknown,
  rules: readonly PlaybackHintRule[] = PLAYBACK_HINT_RULES,
): PlaybackHint => {
  const rule = rules.find((candidate) => matches(candidate, trackInfo));
  return hint(rule?.key ?? 'playback.reason-unconfirmed');
};
