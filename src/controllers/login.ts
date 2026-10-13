import type { Context } from 'koa';
import { getTypedQuery } from '../types/core/request';

export const AUTH_COOKIE_NAME = 'qqmusic_session';

/**
 * Same-origin callers send the token here instead of in `?cookie=`. A sealed token carries the
 * encrypted credential itself, and a query string is the one place it would predictably end up in
 * CDN and edge access logs — the only new exposure sealed has over an opaque lookup key. A header
 * is not logged by default anywhere on that path.
 *
 * Under `stored` this changes nothing of substance; it is added now so the transport is already in
 * place when sealed arrives, and so both modes share one code path.
 */
export const AUTH_HEADER_NAME = 'x-qq-session';

interface LoginQuery {
  key?: string;
  cookie?: string;
  channel?: string;
}

const tokenFromCookieString = (cookie: string): string | undefined => {
  for (const entry of cookie.split(';')) {
    const separator = entry.indexOf('=');
    if (separator <= 0) continue;
    if (entry.slice(0, separator).trim() === AUTH_COOKIE_NAME)
      return entry.slice(separator + 1).trim() || undefined;
  }
  return undefined;
};

/**
 * Priority is header > query > cookie. The two existing sources keep their relative order and
 * their exact behaviour, so external callers and Electron — which both send `?cookie=` — are
 * unaffected by the addition.
 */
export const getAuthToken = (ctx: Context): string | undefined => {
  const header = ctx.get(AUTH_HEADER_NAME).trim();
  if (header) return header;
  const query = getTypedQuery<LoginQuery>(ctx);
  return tokenFromCookieString(String(query.cookie ?? '')) || ctx.cookies.get(AUTH_COOKIE_NAME);
};
