import type { Context } from 'koa';
import { logout } from '../routes/operations/logout';
import { AUTH_COOKIE_NAME } from './login';
import { operationController } from './operation';

// src/controllers/logoutOperation.ts
// 登出的 Node 薄转接：继续用 Koa 原来的 Cookie API，保留 secure、签名和 overwrite 行为。
const commonLogout = operationController(logout);

export default async (ctx: Context): Promise<void> => {
  await commonLogout(ctx);
  ctx.cookies.set(AUTH_COOKIE_NAME, '', { expires: new Date(0), overwrite: true });
};
