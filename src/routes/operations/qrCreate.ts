import { qrServiceErrorResult } from './qrServiceError';
import type { OperationHandler } from './types';

export const qrCreate: OperationHandler = async (request) => {
  const key = request.queryRaw('key');
  if (!key) return { status: 400, headers: {}, body: { code: 400, message: 'key is required' } };
  try {
    const qrimg = request.qr?.createQr
      ? await request.qr.createQr(String(key))
      : await (await request.service()).createQr(String(key));
    return { status: 200, headers: {}, body: { code: 200, data: { qrimg } } };
  } catch (error) {
    return qrServiceErrorResult(error);
  }
};
