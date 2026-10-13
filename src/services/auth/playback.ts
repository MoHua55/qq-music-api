import { playbackEntryCodesOf, playbackUnavailableLogOf } from '../../protocol/playbackDiagnostics';
import { playbackHintOf } from '../../protocol/playbackHints';
import { classifyPlaybackRestriction, playbackQualityOf } from '../../protocol/playbackRestriction';
import { logger } from '../../util/logger';
import type { AuthHttpClient } from './httpClient';
import { callMusicu } from './musicuProtocol';
import { type AuthSession } from './qrTypes';
import { StreamCdnSelector } from './streamCdnSelector';
import { type Dictionary, dictionaryOf, identifierOf, numberOf, stringOf } from './values';

// src/services/auth/playback.ts
// 从认证入口搬出的同一套实现；协议、状态与对外回包沿用原规则。

/**
 * `music.vkey.GetVkey/UrlGetVkey` answers with `midurlinfo` but an empty `sip`, unlike the legacy
 * web `CgiGetVkey`. Without a fallback the play URL degrades into a bare filename, which the
 * browser then resolves against its own origin. The stream fallback remains the last resort after
 * probing the known responsive route first, then asking QQ's CDN dispatcher for alternatives.
 */
export const DEFAULT_STREAM_DOMAIN = 'http://dl.stream.qqmusic.qq.com/';

export const PREFERRED_STREAM_DOMAIN = 'http://sjy6.stream.qqmusic.qq.com/';

export const PREFERRED_STREAM_HOST = new URL(PREFERRED_STREAM_DOMAIN).hostname;

export const DEFAULT_CDN_REFRESH_MS = 30 * 60 * 1_000;

export const isPreferredStreamDomain = (value: string): boolean => {
  try {
    return new URL(value).hostname.toLowerCase() === PREFERRED_STREAM_HOST;
  } catch {
    return false;
  }
};

export const MUSIC_FILE_TYPES = {
  m4a: { prefix: 'C400', extension: '.m4a' },
  128: { prefix: 'M500', extension: '.mp3' },
  320: { prefix: 'M800', extension: '.mp3' },
  ape: { prefix: 'A000', extension: '.ape' },
  flac: { prefix: 'F000', extension: '.flac' },
} as const;

/** One request rarely carries more than a few songs; past this many, failures get the default hint. */
export const MAX_PLAYBACK_HINT_LOOKUPS = 10;

/**
 * The song detail as this same session sees it: the restriction fields are computed per account, so
 * another account's (or an anonymous) copy would hint the wrong reason. Any failure here only costs
 * the hint its precision, never the playback answer.
 */
const songDetailForHint = async (
  http: AuthHttpClient,
  auth: AuthSession,
  songmid: string,
): Promise<unknown> => {
  try {
    const data = await callMusicu(
      http,
      auth.device,
      'get-playback-hint',
      'music.pf_song_detail_svr',
      'get_song_detail_yqq',
      { song_type: 0, song_mid: songmid },
      auth.credential,
    );
    return data.track_info;
  } catch {
    return undefined;
  }
};

export const getAuthenticatedPlayUrls = async (
  http: AuthHttpClient,
  auth: AuthSession,
  streamCdnSelector: StreamCdnSelector,
  songmid: string,
  quality: string | number = 128,
  mediaId?: string,
): Promise<Dictionary> => {
  const songmidList = songmid
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const qualityKey = String(quality) as keyof typeof MUSIC_FILE_TYPES;
  const fileType = MUSIC_FILE_TYPES[qualityKey] ?? MUSIC_FILE_TYPES[128];
  // `globalThis.crypto` is the Web Crypto API global: identical on Node ≥20, Electron, Cloudflare
  // Workers and the Vercel Edge Runtime, unlike `node:crypto`, which the last of those refuses to
  // deploy a bundle importing at all.
  const guid = globalThis.crypto.randomUUID().replaceAll('-', '');
  const normalizedMediaId = stringOf(mediaId).trim();
  const data = await callMusicu(
    http,
    auth.device,
    'get-music-play',
    'music.vkey.GetVkey',
    'UrlGetVkey',
    {
      // filename 一律是两段识别值：`prefix + songmid + media_mid + extension`。media_mid 缺席时
      // 用 songmid 补上第二段；只送一段的文件名在 vkey server 仍会拿到 purl，但 CDN 端会 403。
      filename: songmidList.map(
        (mid) => `${fileType.prefix}${mid}${normalizedMediaId || mid}${fileType.extension}`,
      ),
      guid,
      songmid: songmidList,
      songtype: songmidList.map(() => 0),
      uin: stringOf(auth.credential.str_musicid) || String(auth.credential.musicid),
      ctx: 0,
    },
    auth.credential,
  );
  const sip = Array.isArray(data.sip) ? data.sip.map(stringOf).filter(Boolean) : [];
  let domain: string | undefined = sip.find((value) => !value.startsWith('http://ws')) ?? sip[0];
  if (!domain) {
    const firstPurl = (Array.isArray(data.midurlinfo) ? data.midurlinfo : [])
      .map(dictionaryOf)
      .map((item) => stringOf(item.purl))
      .find(Boolean);
    if (firstPurl) {
      try {
        // sjy6 is the responsive compatible route observed across authenticated playback. Trying
        // it first keeps the common Serverless path to one Range request instead of dispatch + N.
        domain =
          (await streamCdnSelector.select([PREFERRED_STREAM_DOMAIN], firstPurl)) ?? undefined;
        if (!domain) {
          const dispatch = await callMusicu(
            http,
            auth.device,
            'get-cdn-dispatch',
            'music.audioCdnDispatch.cdnDispatch',
            'GetCdnDispatch',
            {
              guid,
              uid: '0',
              use_new_domain: 1,
              use_ipv6: 1,
            },
            auth.credential,
          );
          const dispatchSip = Array.isArray(dispatch.sip)
            ? dispatch.sip.map(stringOf).filter(Boolean)
            : [];
          const alternativeSip = dispatchSip.filter((value) => !isPreferredStreamDomain(value));
          const refreshMs =
            (numberOf(dispatch.refreshTime) ?? DEFAULT_CDN_REFRESH_MS / 1_000) * 1_000;
          domain =
            (await streamCdnSelector.select(
              [...alternativeSip, DEFAULT_STREAM_DOMAIN],
              firstPurl,
              refreshMs,
            )) ?? undefined;
        }
      } catch (error) {
        logger.warn('qq-auth.cdn-selection-failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  domain ??= DEFAULT_STREAM_DOMAIN;
  const playUrl: Dictionary = {};
  const entries = Array.isArray(data.midurlinfo) ? data.midurlinfo : [];
  const loggedQuality = MUSIC_FILE_TYPES[qualityKey] ? qualityKey : '128';
  const unavailable: Dictionary[] = [];
  for (const [index, entry] of entries.entries()) {
    const item = dictionaryOf(entry);
    const mid = identifierOf(item.songmid);
    if (!mid) continue;
    const purl = stringOf(item.purl);
    // 开发日志（debug）：没链接的那首只记位置、音质和白名单里的数字，不记歌曲 id。
    if (!purl)
      logger.debug(
        'playback.url-unavailable',
        playbackUnavailableLogOf({
          phase: 'get-music-play',
          index,
          quality: String(loggedQuality),
          entry: item,
        }),
      );
    if (purl) {
      playUrl[mid] = { url: `${domain}${purl}`, error: false };
      continue;
    }
    const restriction: Dictionary = {
      ...classifyPlaybackRestriction({
        quality: playbackQualityOf(loggedQuality),
        authenticated: true,
        codes: playbackEntryCodesOf(item),
      }),
    };
    playUrl[mid] = { url: '', error: '暂无播放链接', restriction };
    unavailable.push({ mid, restriction });
  }
  const details = await Promise.all(
    unavailable
      .slice(0, MAX_PLAYBACK_HINT_LOOKUPS)
      .map(({ mid }) => songDetailForHint(http, auth, String(mid))),
  );
  for (const [index, { restriction }] of unavailable.entries())
    (restriction as Dictionary).hint = playbackHintOf(details[index]);
  return playUrl;
};
