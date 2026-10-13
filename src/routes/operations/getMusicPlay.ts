import { playbackEntryCodesOf, playbackUnavailableLogOf } from '../../protocol/playbackDiagnostics';
import {
  PLAYBACK_HINT_RULES,
  type PlaybackHint,
  playbackHintOf,
  previewUnavailableHint,
} from '../../protocol/playbackHints';
import {
  classifyPlaybackRestriction,
  type PlaybackRestriction,
  playbackQualityOf,
} from '../../protocol/playbackRestriction';
import {
  previewMediaIdOf,
  previewUnavailableRestriction,
  validMediaIdOf,
} from '../../protocol/previewFile';
import { previewFilenameOf } from '../../services/auth/playback';
import UCommon from '../../services/UCommon/UCommon';
import { logger } from '../../util/logger';
import type { OperationHandler } from './types';

interface AnonymousPlaybackDefaults {
  uin: string;
  guid: string;
}

const fileType = {
  m4a: { s: 'C400', e: '.m4a' },
  128: { s: 'M500', e: '.mp3' },
  320: { s: 'M800', e: '.mp3' },
  ape: { s: 'A000', e: '.ape' },
  flac: { s: 'F000', e: '.flac' },
};
interface AnonymousPlayEntry {
  url: string;
  error: string | boolean;
  preview?: true;
  restriction?: PlaybackRestriction & { hint?: PlaybackHint };
}

const MAX_HINT_LOOKUPS = 10;

/** 匿名播放就用匿名读到的单曲详情挑提示、判断有没有试听文件；读不到就当没有详情。 */
const anonymousSongDetail = async (songmid: string): Promise<unknown> => {
  try {
    const res = await UCommon({
      method: 'get',
      params: {
        format: 'json',
        data: JSON.stringify({
          comm: { ct: 24, cv: 0 },
          req_0: {
            module: 'music.pf_song_detail_svr',
            method: 'get_song_detail_yqq',
            param: { song_type: 0, song_mid: songmid },
          },
        }),
      },
      option: {},
    });
    const body = res.data as { req_0?: { data?: { track_info?: unknown } } } | undefined;
    return body?.req_0?.data?.track_info;
  } catch {
    return undefined;
  }
};

const loginRequired = { status: 401, headers: {}, body: { code: 401, message: 'Login required' } };

// Node 的配置由薄转接提供，避免把文件系统配置带进 serverless。匿名分支仍使用旧的 CgiGetVkey；
// serverless 缺会话时仍回 401，缺密钥的 501 继续由入口处理。
export const createGetMusicPlay =
  (
    anonymousDefaults: () => AnonymousPlaybackDefaults = () => ({ uin: '0', guid: '1429839143' }),
  ): OperationHandler =>
  async (request) => {
    const songmid = String(request.params.songmid ?? request.queryRaw('songmid') ?? '').trim();
    if (!songmid) return { status: 400, headers: {}, body: { data: { message: 'no songmid' } } };
    const quality = request.queryRaw('quality') ?? '128';
    const mediaId = request.queryRaw('mediaId');
    // 只认明确的 1／true；其他写法（含重复参数）都当成一般请求，回应和以前一样。
    const preview = ['1', 'true'].includes(String(request.queryRaw('preview') ?? ''));
    const token = request.token;
    if (token) {
      const service = await request.service();
      const playUrl = preview
        ? await service.getMusicPlay(
            token,
            songmid,
            quality as string,
            mediaId as string | undefined,
            {
              preview: true,
            },
          )
        : await service.getMusicPlay(
            token,
            songmid,
            quality as string,
            mediaId as string | undefined,
          );
      return playUrl ? { status: 200, headers: {}, body: { data: { playUrl } } } : loginRequired;
    }
    if (request.runtime === 'serverless') return loginRequired;

    const { uin, guid } = anonymousDefaults();
    const justPlayUrl = (request.queryRaw('resType') || 'play') === 'play';
    const requestedList = songmid.split(',');
    // 试听只要确认有试听文件的歌（每首查一次详情，最多 MAX_HINT_LOOKUPS 首）；其他的直接回「试听不可用」。
    const previewMediaIds = new Map<string, string>();
    if (preview) {
      const callerMediaId = validMediaIdOf(mediaId);
      const looked = [...new Set(requestedList)].slice(0, MAX_HINT_LOOKUPS);
      const details = await Promise.all(looked.map((mid) => anonymousSongDetail(mid)));
      looked.forEach((mid, index) => {
        const media = previewMediaIdOf(details[index], callerMediaId);
        if (media) previewMediaIds.set(mid, media);
      });
    }
    const songmidList = preview
      ? requestedList.filter((mid) => previewMediaIds.has(mid))
      : requestedList;
    const skipped: Record<string, AnonymousPlayEntry> = Object.fromEntries(
      requestedList
        .filter((mid) => preview && !previewMediaIds.has(mid))
        .map((mid) => [
          mid,
          { url: '', error: '暂无播放链接', restriction: previewUnavailableRestriction(false) },
        ]),
    );
    // 全部都不要试听文件时不打取链接的请求，回应只有 playUrl。
    if (preview && !songmidList.length)
      return { status: 200, headers: {}, body: { data: { playUrl: skipped } } };
    const fileInfo = fileType[quality as keyof typeof fileType] ?? fileType[128];
    const file = songmidList.map((mid) =>
      preview
        ? previewFilenameOf(previewMediaIds.get(mid) as string)
        : `${fileInfo.s}${mid}${mediaId || mid}${fileInfo.e}`,
    );
    const data = {
      req_0: {
        module: 'vkey.GetVkeyServer',
        method: 'CgiGetVkey',
        param: {
          filename: file,
          guid,
          songmid: songmidList,
          songtype: [0],
          uin,
          loginflag: 1,
          platform: '20',
        },
      },
      loginUin: uin,
      comm: { uin, format: 'json', ct: 24, cv: 0 },
    };
    const res = await UCommon({
      method: 'get',
      params: {
        format: 'json',
        sign: 'zzannc1o6o9b4i971602f3554385022046ab796512b7012',
        data: JSON.stringify(data),
      },
      option: {},
    });
    const response = res.data as {
      req_0?: { data?: { sip?: string[]; midurlinfo?: Array<{ songmid: string; purl: string }> } };
      playUrl?: Record<string, AnonymousPlayEntry>;
    };
    // 只对 undefined 使用旧默认值；null、错误类型仍按原路由抛错交给宿主兜底。
    const sip = response?.req_0?.data?.sip;
    const domain =
      (sip === undefined ? [] : sip).find((value: string) => !value.startsWith('http://ws')) ||
      sip?.[0];
    const midurlinfo = response?.req_0?.data?.midurlinfo;
    const playUrl: Record<string, AnonymousPlayEntry> = {};
    const loggedQuality = preview
      ? 'preview'
      : fileInfo === fileType[128]
        ? '128'
        : String(quality);
    (midurlinfo === undefined ? [] : midurlinfo).forEach(
      (item: { songmid: string; purl: string }, index: number) => {
        if (item.purl) {
          playUrl[item.songmid] = {
            url: `${domain}${item.purl}`,
            error: false,
            ...(preview ? { preview: true as const } : {}),
          };
          return;
        }
        // 开发日志（debug）：没链接的那首只记位置、音质和白名单里的数字，不记歌曲 id。
        logger.debug(
          'playback.url-unavailable',
          playbackUnavailableLogOf({
            phase: 'get-music-play-anonymous',
            index,
            quality: loggedQuality,
            entry: item,
          }),
        );
        playUrl[item.songmid] = {
          url: '',
          error: '暂无播放链接',
          restriction: classifyPlaybackRestriction({
            quality: playbackQualityOf(loggedQuality),
            authenticated: false,
            codes: playbackEntryCodesOf(item),
          }),
        };
      },
    );
    const unavailable = Object.entries(playUrl).filter(([, entry]) => entry.restriction);
    // 试听拿不到链接一律是「试听不可用」；其他的在还没有验证过的规则时挑不出具体原因，不用多查。
    const details = await Promise.all(
      unavailable
        .slice(0, PLAYBACK_HINT_RULES.length && !preview ? MAX_HINT_LOOKUPS : 0)
        .map(([mid]) => anonymousSongDetail(mid)),
    );
    unavailable.forEach(([, entry], index) => {
      if (entry.restriction)
        entry.restriction.hint = preview
          ? previewUnavailableHint()
          : playbackHintOf(details[index]);
    });
    Object.assign(playUrl, skipped);
    response.playUrl = playUrl;
    return { status: 200, headers: {}, body: { data: justPlayUrl ? { playUrl } : response } };
  };

export const getMusicPlay = createGetMusicPlay();
