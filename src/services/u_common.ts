import { legacyRequestStructureOf } from '../protocol/logStructure';
import type { HttpRequestConfig } from '../transport/httpClientTypes';
import { BaseUCommonParams } from '../types/core/request';
import { logger } from '../util/logger';
import { getLegacyHttpTransport } from './httpTransport';

export default ({ options = {}, method = 'get' }: BaseUCommonParams) => {
  // The registered transport owns both execution and the request defaults. Reading them from
  // `../config` here is what pulled the filesystem-backed config manager into the serverless
  // dependency graph (M0 0.2).
  const transport = getLegacyHttpTransport();
  const { baseURL, commonParams, referer } = transport.defaults;
  const opts: HttpRequestConfig = Object.assign({}, options, commonParams, {
    headers: {
      referer: referer.u,
      host: 'u.y.qq.com',
      'content-type': 'application/x-www-form-urlencoded',
      ...options.headers,
    },
  });
  logger.debug('upstream.request-structure', legacyRequestStructureOf(baseURL.u, method, opts));
  return transport.request(baseURL.u, method, opts, 'u');
};
