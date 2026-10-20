import { CgiNetworkError, type CgiTransport } from '../protocol/cgi';

// src/transport/fetchCgi.ts
//
// 匿名旧 CGI 的 fetch 实现。不跟转址，非 2xx 不读回包；网络失败只交出 name 和 code。

export type CgiFetchExecutor = (
  url: string,
  init: {
    method: 'GET';
    redirect: 'manual';
    headers: Record<string, string>;
    signal: AbortSignal;
  },
) => Promise<Response>;

const stringOf = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const property = (value: unknown, key: string): unknown => {
  try {
    return value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
  } catch {
    return undefined;
  }
};

const observed = (error: unknown): CgiNetworkError =>
  new CgiNetworkError({
    name: stringOf(property(error, 'name')),
    code: stringOf(property(error, 'code') ?? property(property(error, 'cause'), 'code')),
  });

const retryDelay = (value: string | null): number | undefined =>
  value && /^\d+(?:\.\d+)?$/.test(value) ? Math.ceil(Number(value) * 1000) : undefined;

/** 默认每次调用时才取全局 fetch，测试或嵌入方替换全局 fetch 也能生效。 */
export const createFetchCgiTransport =
  (fetcher: CgiFetchExecutor = (url, init) => globalThis.fetch(url, init)): CgiTransport =>
  async (request) => {
    let response: Response;
    try {
      response = await fetcher(request.url, {
        method: 'GET',
        redirect: 'manual',
        headers: request.headers,
        signal: request.signal,
      });
    } catch (error) {
      throw observed(error);
    }
    if (response.status < 200 || response.status >= 300) {
      void response.body?.cancel().catch(() => {});
      return {
        status: response.status,
        retryAfterMs: retryDelay(response.headers.get('Retry-After')),
      };
    }
    try {
      return { status: response.status, bytes: await response.arrayBuffer() };
    } catch (error) {
      throw observed(error);
    }
  };
