import type { HttpRequestConfig } from '../../transport/httpClientTypes';
import u_common from '../u_common';

export interface UCommonParams {
  method?: string;
  params?: Record<string, unknown>;
  option?: HttpRequestConfig;
}

export default ({ method = 'get', params = {}, option = {} }: UCommonParams) => {
  const options = Object.assign(option, { params });
  return u_common({ method, options });
};
