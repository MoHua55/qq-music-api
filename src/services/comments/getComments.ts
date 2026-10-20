import type { HttpClientResponse, HttpRequestConfig } from '../../transport/httpClientTypes';
import { logServiceFailure, logServiceRequest, logServiceSuccess } from '../../util/observability';
import { toLegacyErrorBody } from '../../util/safeError';
import y_common from '../y_common';

export interface GetCommentsParams {
  method?: string;
  params?: Record<string, unknown>;
  option?: HttpRequestConfig;
}

const upstream = '/base/fcgi-bin/fcg_global_comment_h5.fcg';

export default ({ method = 'get', params = {}, option = {} }: GetCommentsParams) => {
  const data = Object.assign(params, {
    format: 'json',
    outCharset: 'GB2312',
    domain: 'qq.com',
    ct: 24,
    cv: 10101010,
    needmusiccrit: 0,
  });
  const options = Object.assign(option, { params: data });
  logServiceRequest('getComments', upstream, data);
  return y_common({
    url: upstream,
    method,
    options,
  })
    .then((res: HttpClientResponse<any>) => {
      const response = res.data;
      logServiceSuccess('getComments', upstream, response, {
        topId: data.topid,
      });
      return {
        status: 200,
        body: {
          response,
        },
      };
    })
    .catch((error: unknown) => {
      logServiceFailure('getComments', upstream, error, data);
      return {
        status: 500,
        body: {
          error: toLegacyErrorBody(error),
        },
      };
    });
};
