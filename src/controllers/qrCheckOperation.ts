import type { Context } from 'koa';
import { qrCheck, qrCookieTokenOf } from '../routes/operations/qrCheck';
import type { QrCheckResult } from '../services/auth/qrLogin';
import { AUTH_COOKIE_NAME } from './login';
import { operationController } from './operation';

const commonQrCheck = operationController(qrCheck);
// 继续用 Koa 的 Cookie API，保留安全连接、签名及覆盖行为。
export default async (ctx: Context): Promise<void> => {
  await commonQrCheck(ctx);
  const result = ctx.body as QrCheckResult;
  if (result.code === 803 && result.cookie) {
    const token = qrCookieTokenOf(result.cookie);
    if (token)
      ctx.cookies.set(AUTH_COOKIE_NAME, token, {
        httpOnly: true,
        maxAge: 86400000,
        overwrite: true,
        sameSite: 'lax',
      });
  }
};
