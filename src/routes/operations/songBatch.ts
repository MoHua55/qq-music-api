import { QqApiError, toNewRouteErrorResponse } from '../../protocol/errors';
import { songBatchResult } from '../../services/song/batch';
import type { OperationHandler } from './types';

export const songBatch: OperationHandler = async (request) => {
  if (request.method !== 'POST')
    return {
      status: 405,
      headers: { Allow: 'POST' },
      body: { code: 405, message: 'POST required' },
    };
  let body: unknown;
  try {
    body = await request.body?.();
  } catch {
    return toNewRouteErrorResponse(new QqApiError('input'));
  }
  return songBatchResult(body);
};
