import type { OperationHandler } from './types';

export const qrCancel: OperationHandler = async (request) => {
  const key = request.queryRaw('key');
  if (!key) return { status: 400, headers: {}, body: { code: 400, message: 'key is required' } };
  if (request.qr?.cancelSession) await request.qr.cancelSession(String(key));
  else (await request.service()).cancelSession(String(key));
  // 未知、过期或重复取消都继续回成功。
  return { status: 200, headers: {}, body: { code: 200 } };
};
