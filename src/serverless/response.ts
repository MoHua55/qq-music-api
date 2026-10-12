import { AuthCredentialRejectedError } from '../util/authError';
import { RequestRejectedError } from '../util/requestError';
import { toLegacyErrorMessage } from '../util/safeError';

// src/serverless/response.ts
//
// serverless 路由共用的两件事：把内容写成 JSON 回应，以及路由抛出异常时怎么回。
// 单独放一个文件，是为了让入口以外的路由实现（还有测试）也用同一份，不各写一套。

export const AUTH_COOKIE_NAME = 'qqmusic_session';
export const LOGIN_REQUIRED = { code: 401, message: 'Login required' };

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });

/**
 * 和 Koa 那边的错误中间件同一个分法：上游明确拒绝凭证、请求本身不被接受，回对应的状态码，
 * 客户端可以自己处理；其余一律 500，内容只来自固定模板。
 */
export const failureResponse = (error: unknown): Response => {
  if (error instanceof AuthCredentialRejectedError || error instanceof RequestRejectedError)
    return json({ code: error.httpStatus, message: error.message }, error.httpStatus);
  return json({ error: toLegacyErrorMessage(error) }, 500);
};
