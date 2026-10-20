// 下游（Folia）按字符串分支的错误字段。它看新路由错误正文的 `kind` 判断「平台拒绝」还是「连不上」，
// 看扫码失败的 `failureHint.key` 换成自己的文案。这些字符串一改名，下游就会把拒绝当成断线、
// 或者文案对不上，所以单独固定下来；具体路由的回应形状由各自的路由测试守。

import { QqApiError, type QqErrorKind, toNewRouteErrorResponse } from '../src/protocol/errors';
import { LOGIN_HINT_MESSAGES } from '../src/protocol/loginHints';

const responseOf = (kind: QqErrorKind, retryAfterMs?: number) =>
  toNewRouteErrorResponse(new QqApiError(kind, retryAfterMs === undefined ? {} : { retryAfterMs }));

describe('Folia error-field contracts', () => {
  it.each([
    'upstream-business',
    'upstream-gateway',
    'invalid-response',
    'device-limit',
    'account-restricted',
    'account-banned',
    'account-binding',
    'login-rejected',
  ] as const)('answers a platform refusal of kind %s with 502 and the same kind string', (kind) => {
    const response = responseOf(kind);
    expect(response.status).toBe(502);
    expect(response.body).toMatchObject({ code: 502, kind });
  });

  it.each([
    'network',
    'upstream-http',
  ] as const)('answers an unreachable upstream of kind %s with 502 and the same kind string', (kind) => {
    const response = responseOf(kind);
    expect(response.status).toBe(502);
    expect(response.body).toMatchObject({ code: 502, kind });
  });

  it('keeps the statuses the downstream session and retry handling depend on', () => {
    expect(responseOf('auth-missing').status).toBe(401);
    expect(responseOf('credential-invalid').status).toBe(401);
    expect(responseOf('feature-unavailable').status).toBe(501);
    // 新路由没有数据时不能用 404：下游把 404 当成「后端没有这条路由」。
    expect(responseOf('not-found').status).toBe(422);
    const limited = responseOf('rate-limited', 2500);
    expect(limited.status).toBe(429);
    expect(limited.headers).toEqual({ 'Retry-After': '3' });
    expect(limited.body).toMatchObject({ retryAfterMs: 2500 });
  });

  it('keeps every login failure hint key the downstream maps to its own wording', () => {
    expect(Object.keys(LOGIN_HINT_MESSAGES).sort()).toEqual(
      [
        'login.account-banned',
        'login.account-binding',
        'login.account-restricted',
        'login.device-limit',
        'login.rate-limited',
        'login.rejected',
        'login.wrong-scan-app',
      ].sort(),
    );
  });
});
