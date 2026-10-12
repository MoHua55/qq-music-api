// src/protocol/playbackRestriction.ts
//
// `/getMusicPlay` 某首歌拿不到链接时附在 `playUrl[mid].restriction` 上的结构化原因。
//
// 规则很简单：没有受控实验证据，就只说「拿不到链接，原因未确认」（`url_unavailable`），
// 不猜会员、购买、地区或下架。分类框架先建好，规则表等有证据再填。零依赖，两个运行时共用。

import type { EvidenceLevel } from './evidence';
import { type PlaybackEntryCodes, playbackEntryCodesOf } from './playbackDiagnostics';

export type PlaybackRestrictionKey =
  /** 拿不到播放链接，原因未确认。目前唯一会出现在回应里的值。 */
  | 'url_unavailable'
  /** 当前账号缺少会员权益。 */
  | 'membership_required'
  /** 需要单独购买（数字专辑、单曲付费）。 */
  | 'purchase_required'
  /** 缺少某种播放权益，但分不出是会员还是购买。 */
  | 'entitlement_required'
  /** 只能拿到试听片段。 */
  | 'preview_only'
  /** 地区版权限制。 */
  | 'region_restricted'
  /** 确实下架。 */
  | 'taken_down';

export const PLAYBACK_RESTRICTION_KEYS: readonly PlaybackRestrictionKey[] = [
  'url_unavailable',
  'membership_required',
  'purchase_required',
  'entitlement_required',
  'preview_only',
  'region_restricted',
  'taken_down',
];

/** 取链接时实际请求的音质（文件类型）。认不出的值和取链接本身一样退回 128。 */
export type PlaybackQuality = 'm4a' | '128' | '320' | 'ape' | 'flac';

const PLAYBACK_QUALITIES: readonly PlaybackQuality[] = ['m4a', '128', '320', 'ape', 'flac'];

export const playbackQualityOf = (value: unknown): PlaybackQuality => {
  const text = String(value ?? '');
  return (PLAYBACK_QUALITIES as readonly string[]).includes(text)
    ? (text as PlaybackQuality)
    : '128';
};

/** 对外的形状。`codes` 只来自这首歌的单曲条目，没有可用数字时省略。 */
export interface PlaybackRestriction {
  key: PlaybackRestrictionKey;
  evidence: EvidenceLevel;
  codes?: PlaybackEntryCodes;
}

export interface PlaybackAttemptContext {
  /** 这次请求实际用的音质。每次请求只有一个音质，一次的结果不代表别的音质。 */
  quality: PlaybackQuality;
  /** 带会话（`UrlGetVkey`）还是匿名（`CgiGetVkey`）。 */
  authenticated: boolean;
}

export interface PlaybackRestrictionInput extends PlaybackAttemptContext {
  codes: PlaybackEntryCodes;
}

/**
 * 一条把单曲条目的数字对应到具体原因的规则。
 *
 * 🔴 只有 `evidence: 'verified-controlled'` 的规则会在分类时生效：其余规则即使放进表里也会被跳过，
 * 免得把协议资料或第三方说法当成结论。
 */
export interface PlaybackRestrictionRule {
  readonly id: string;
  readonly key: Exclude<PlaybackRestrictionKey, 'url_unavailable'>;
  readonly evidence: EvidenceLevel;
  /** 证据出处的简述（实验条件、样本数量），不写账号、歌名或 id。 */
  readonly source: string;
  readonly matches: (input: PlaybackRestrictionInput) => boolean;
}

/** 正式路径用的规则表。拿到受控实验的证据之前保持为空：所有失败都是 `url_unavailable`。 */
export const PLAYBACK_RESTRICTION_RULES: readonly PlaybackRestrictionRule[] = [];

const ruleMatches = (rule: PlaybackRestrictionRule, input: PlaybackRestrictionInput): boolean => {
  try {
    return rule.matches(input) === true;
  } catch {
    return false;
  }
};

const withCodes = (codes: PlaybackEntryCodes): Pick<PlaybackRestriction, 'codes'> =>
  Object.keys(codes).length ? { codes: { ...codes } } : {};

export const classifyPlaybackRestriction = (
  input: PlaybackRestrictionInput,
  rules: readonly PlaybackRestrictionRule[] = PLAYBACK_RESTRICTION_RULES,
): PlaybackRestriction => {
  for (const rule of rules) {
    if (rule.evidence !== 'verified-controlled') continue;
    if (ruleMatches(rule, input))
      return { key: rule.key, evidence: rule.evidence, ...withCodes(input.codes) };
  }
  // 「拿不到链接」本身是在响应里看到的事实；原因未确认。
  return { key: 'url_unavailable', evidence: 'observed-response', ...withCodes(input.codes) };
};

/**
 * 播放授权这一层的观测：这个账号、这个音质、这一次请求，上游有没有发链接。
 * 它不代表账号的会员身份，也不代表拿到链接之后 CDN 能不能真的播；这些需要分别观测。
 */
export interface PlaybackAuthorizationObservation extends PlaybackAttemptContext {
  granted: boolean;
  entryCodes: PlaybackEntryCodes;
  /** 只有没拿到链接时才有。 */
  restriction?: PlaybackRestriction;
}

export const observePlaybackAuthorization = (
  entry: unknown,
  granted: boolean,
  context: PlaybackAttemptContext,
  rules: readonly PlaybackRestrictionRule[] = PLAYBACK_RESTRICTION_RULES,
): PlaybackAuthorizationObservation => {
  const entryCodes = playbackEntryCodesOf(entry);
  return {
    quality: context.quality,
    authenticated: context.authenticated,
    granted,
    entryCodes,
    ...(granted
      ? {}
      : { restriction: classifyPlaybackRestriction({ ...context, codes: entryCodes }, rules) }),
  };
};

/**
 * `playback.url-unavailable` 开发日志（debug）的内容。不带 songmid、链接、文件名、提示文字或凭证：
 * 只保留阶段、请求里的位置、音质和白名单数字。
 */
export const playbackUnavailableLogOf = (
  observation: PlaybackAuthorizationObservation,
  where: { phase: 'get-music-play' | 'get-music-play-anonymous'; index: number },
): Record<string, unknown> => ({
  phase: where.phase,
  index: where.index,
  quality: observation.quality,
  entryCodes: { ...observation.entryCodes },
});
