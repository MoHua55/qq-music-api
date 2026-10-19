import { tokenFromCookieString } from '../sessionToken';
import type { OperationHandler } from './types';

export const qrCheck: OperationHandler = async (request) => {
  const key = request.queryRaw('key');
  if (!key) return { status: 400, headers: {}, body: { code: 400, message: 'key is required' } };
  const result = request.qr?.checkQr
    ? await request.qr.checkQr(String(key))
    : await (await request.service()).checkQr(String(key));
  const token =
    result.code === 803 && result.cookie ? tokenFromCookieString(result.cookie) : undefined;
  // Node 用 Koa Cookie API；serverless 继续发送原来的 Max-Age 标头。
  const headers: Record<string, string> =
    request.runtime === 'serverless' && token
      ? { 'set-cookie': `qqmusic_session=${token}; HttpOnly; Max-Age=86400; SameSite=Lax; Path=/` }
      : {};
  return { status: 200, headers, body: result };
};
