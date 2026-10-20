import type { HttpClientResponse } from '../../transport/httpClientTypes';
import { BaseServiceParams, BaseServiceResponse } from '../../types/core/request';
import lyricParse from '../../util/lyricParse';
import {
  logServiceBranch,
  logServiceFailure,
  logServiceRequest,
  logServiceSuccess,
} from '../../util/observability';
import { toLegacyErrorBody } from '../../util/safeError';
import y_common from '../y_common';
import { playLyricTranslation } from './playLyricTranslation';

export interface GetLyricParams extends BaseServiceParams {
  isFormat?: boolean;
  /** 旧接口成功但翻译是空的时，补打一次新接口要翻译。 */
  trans?: boolean;
}

const upstream = '/lyric/fcgi-bin/fcg_query_lyric_new.fcg';

/** 上游给的是 UTF-8 文字的 base64；两个运行时都有 atob 与 TextDecoder，不依赖 Node 的 Buffer。 */
const decodeBase64Utf8 = (value: string): string =>
  new TextDecoder().decode(Uint8Array.from(atob(value), (character) => character.charCodeAt(0)));

export default ({
  method = 'get',
  params = {},
  options = {},
  isFormat = false,
  trans = false,
}: GetLyricParams): Promise<BaseServiceResponse> => {
  const songmid = String(params.songmid ?? '');
  const data = Object.assign(params, {
    format: 'json',
    outCharset: 'utf-8',
    pcachetime: Date.now(),
  });
  const opts = Object.assign(options, {
    params: data,
  });
  logServiceRequest('getLyric', upstream, data, {
    formatLyric: isFormat,
  });
  if (isFormat) {
    logServiceBranch('getLyric', upstream, 'format', {
      formatLyric: true,
    });
  }
  return y_common({
    url: upstream,
    method,
    options: opts,
  })
    .then(async (res: HttpClientResponse<any>) => {
      const lyricString = res.data?.lyric && decodeBase64Utf8(res.data.lyric);
      const lyric = isFormat ? lyricParse.lyricParse(lyricString || '') : lyricString;
      const response = {
        ...(res.data || {}),
        lyric,
      };
      if (trans && res.data?.code === 0 && !res.data.trans) {
        const translated = await playLyricTranslation(songmid);
        logServiceBranch('getLyric', upstream, 'translation', { translated: Boolean(translated) });
        if (translated) response.trans = translated;
      }
      logServiceSuccess('getLyric', upstream, {
        code: res.data?.code,
        hasLyric: Boolean(lyricString),
        formatLyric: isFormat,
      });
      return {
        status: 200,
        body: {
          response,
        },
      };
    })
    .catch((error: unknown) => {
      logServiceFailure('getLyric', upstream, error, data, {
        formatLyric: isFormat,
      });
      return {
        status: 500,
        body: {
          error: toLegacyErrorBody(error),
        },
      };
    });
};
