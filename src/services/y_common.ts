import { legacyRequestStructureOf } from '../protocol/logStructure';
import type { HttpRequestConfig } from '../transport/httpClientTypes';
import { BaseYCommonParams } from '../types/core/request';
import { logger } from '../util/logger';
import { getLegacyHttpTransport } from './httpTransport';

export default ({
  url,
  method = 'get',
  options = {},
  hasCommonParams = true,
}: BaseYCommonParams) => {
  // See `u_common.ts`: defaults come from the registered transport, never from `../config`.
  const transport = getLegacyHttpTransport();
  const commonParams = hasCommonParams ? transport.defaults.commonParams : {};
  const opts: HttpRequestConfig = Object.assign({}, options, commonParams, {
    headers: {
      referer: transport.defaults.referer.c,
      host: 'c.y.qq.com',
      ...options.headers,
    },
  });
  logger.debug('upstream.request-structure', legacyRequestStructureOf(url, method, opts));
  return transport.request(url, method, opts);
};
