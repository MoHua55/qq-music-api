import type { HttpClientResponse, HttpRequestConfig } from '../../transport/httpClientTypes';
import { logServiceFailure, logServiceRequest, logServiceSuccess } from '../../util/observability';
import { toLegacyErrorBody } from '../../util/safeError';
import y_common from '../y_common';

export interface GetDigitalAlbumListsParams {
  method?: string;
  params?: Record<string, unknown>;
  option?: HttpRequestConfig;
}

const upstream = '/v8/fcg-bin/musicmall.fcg';

export default ({ method = 'get', params = {}, option = {} }: GetDigitalAlbumListsParams) => {
  const data = Object.assign(params, {
    format: 'json',
    outCharset: 'utf-8',
    cmd: 'pc_index_new',
  });
  const options = Object.assign(option, {
    params: data,
  });
  logServiceRequest('getDigitalAlbumLists', upstream, data);
  return y_common({
    url: upstream,
    method,
    options,
  })
    .then((res: HttpClientResponse<any>) => {
      const response = res.data;
      logServiceSuccess('getDigitalAlbumLists', upstream, response, {
        cmd: data.cmd,
      });
      return {
        status: 200,
        body: {
          response,
        },
      };
    })
    .catch((error: unknown) => {
      logServiceFailure('getDigitalAlbumLists', upstream, error, data);
      return {
        status: 500,
        body: {
          error: toLegacyErrorBody(error),
        },
      };
    });
};
