import type { Context } from 'koa';
import { AUTH_COOKIE_NAME, AUTH_HEADER_NAME, tokenFromCookieString } from '../routes/sessionToken';
import { getTypedQuery } from '../types/core/request';

interface LoginQuery {
  key?: string;
  cookie?: string;
  channel?: string;
}

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
