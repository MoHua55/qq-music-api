// src/routes/sessionToken.ts
//
// 会话 token 放在哪里、叫什么名字，Node 和 Serverless 共用这一份。没有任何依赖，两边都会打包。

/** 存 token 的 Cookie 名，也是 `?cookie=` 参数里认的名字。 */
export const AUTH_COOKIE_NAME = 'qqmusic_session';

/**
 * Same-origin callers send the token here instead of in `?cookie=`. A sealed token carries the
 * encrypted credential itself, and a query string is the one place it would predictably end up in
 * CDN and edge access logs — the only new exposure sealed has over an opaque lookup key. A header
 * is not logged by default anywhere on that path.
 */
export const AUTH_HEADER_NAME = 'x-qq-session';

/** 从 `a=1; qqmusic_session=xxx` 这样的字符串里取出 token；没有或是空值都当成没有。 */
export const tokenFromCookieString = (cookie: string): string | undefined => {
  for (const entry of cookie.split(';')) {
    const separator = entry.indexOf('=');
    if (separator <= 0) continue;
    if (entry.slice(0, separator).trim() === AUTH_COOKIE_NAME)
      return entry.slice(separator + 1).trim() || undefined;
  }
  return undefined;
};
