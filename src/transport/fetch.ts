import { QqApiError } from '../protocol/errors';
import { checkAbort, type HttpTransport, HttpTransportError } from '../protocol/http';
import { cookieHeader, mergeCookieHeaders, updateCookieJar } from './cookieJar';

export interface FetchResponse {
  status: number;
  headers?: { get(name: string): string | null; getSetCookie?(): string[] };
  body?: { cancel(): Promise<void> } | null;
  text(): Promise<string>;
}

export interface FetchInit {
  method: 'POST';
  redirect: 'manual';
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
}

export type FetchExecutor = (url: string, init: FetchInit) => Promise<FetchResponse>;

const property = (value: unknown, key: string): unknown => {
  try {
    return value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
  } catch {
    return undefined;
  }
};

const observedFailure = (raw: unknown, reading: boolean, signal: AbortSignal) => {
  checkAbort(signal);
  const code = property(raw, 'code') ?? property(property(raw, 'cause'), 'code');
  const name = property(raw, 'name');
  if (
    name === 'AbortError' ||
    name === 'CanceledError' ||
    code === 'ABORT_ERR' ||
    code === 'ERR_CANCELED'
  )
    return new HttpTransportError({ phase: reading ? 'read' : 'unknown', code: 'ABORT_ERR' });
  const known = [
    'ENOTFOUND',
    'EAI_AGAIN',
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'ECONNABORTED',
  ];
  const connect =
    !reading &&
    typeof code === 'string' &&
    ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT'].includes(code);
  const safeCode =
    code === 'UND_ERR_CONNECT_TIMEOUT' || name === 'TimeoutError'
      ? 'ETIMEDOUT'
      : typeof code === 'string' && known.includes(code)
        ? code
        : undefined;
  return new HttpTransportError({
    phase: reading ? 'read' : connect ? 'connect' : 'unknown',
    code: safeCode,
  });
};

const retryDelay = (value: string | null | undefined): number | undefined => {
  if (!value || !/^\d+(?:\.\d+)?$/.test(value)) return undefined;
  const ms = Math.ceil(Number(value) * 1000);
  return Number.isSafeInteger(ms) && ms >= 0 ? ms : undefined;
};

/** Native fetch works in Node and Web hosts; inject a host executor for testing or embedding. */
export const createFetchTransport = (fetcher: FetchExecutor = globalThis.fetch): HttpTransport => {
  const jars = new Map<string, Map<string, string>>();
  // This instance must belong to one session context; never share it across accounts.
  return async (request) => {
    checkAbort(request.signal);
    const origin = new URL(request.url).origin;
    let jar = jars.get(origin);
    if (!jar) {
      jar = new Map<string, string>();
      jars.set(origin, jar);
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    let explicitCookie = '';
    for (const [key, value] of Object.entries(request.headers)) {
      if (key.toLowerCase() === 'cookie') explicitCookie = value;
      else if (key.toLowerCase() !== 'content-type') headers[key] = value;
    }
    const cookies = mergeCookieHeaders(cookieHeader(jar), explicitCookie);
    if (cookies) headers.Cookie = cookies;
    let response: FetchResponse;
    try {
      // Vercel Edge 和 Cloudflare Workers 的 fetch 不收 `redirect: 'error'`（直接抛错），所以送 manual，
      // 下面再把转址当成和以前一样的网络失败，不跟着跳。
      response = await fetcher(request.url, {
        method: 'POST',
        redirect: 'manual',
        headers,
        body: request.body,
        signal: request.signal,
      });
    } catch (error) {
      throw observedFailure(error, false, request.signal);
    }
    checkAbort(request.signal);
    // 3xx，或浏览器式 fetch 的 opaqueredirect（status 0）：以前 `redirect: 'error'` 会在这里抛错，结果照旧。
    if (response.status === 0 || (response.status >= 300 && response.status < 400)) {
      void response.body?.cancel().catch(() => {});
      throw new HttpTransportError({ phase: 'unknown' });
    }
    if (!Number.isSafeInteger(response.status) || response.status < 100 || response.status > 599)
      throw new QqApiError('invalid-response');
    const retryAfterMs = retryDelay(response.headers?.get('Retry-After'));
    if (response.status < 200 || response.status >= 300) {
      // Do not parse or retain error bodies. Release the stream without waiting for an error page.
      void response.body?.cancel().catch(() => {});
      return { status: response.status, retryAfterMs };
    }
    const setCookies =
      response.headers?.getSetCookie?.() ??
      response.headers?.get('set-cookie')?.split(/,(?=\s*[^;,=\s]+=[^;]*)/) ??
      [];
    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      throw observedFailure(error, true, request.signal);
    }
    checkAbort(request.signal);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new QqApiError('invalid-response');
    }
    updateCookieJar(jar, setCookies);
    return { status: response.status, body };
  };
};
