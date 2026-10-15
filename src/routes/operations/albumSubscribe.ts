import { QqApiError, toNewRouteErrorResponse } from '../../protocol/errors';
import { albumSubscribeResult } from '../../services/user/albumSubscribe';
import type { OperationHandler } from './types';

export const albumSubscribe: OperationHandler = async (request) => {
  if (request.method !== 'POST')
    return {
      status: 405,
      headers: { Allow: 'POST' },
      body: { code: 405, message: 'POST required' },
    };
  const session = await (await request.service()).resolveSession(request.token);
  if (!session) return toNewRouteErrorResponse(new QqApiError('auth-missing'));
  try {
    return albumSubscribeResult(session, await request.body?.());
  } catch {
    return toNewRouteErrorResponse(new QqApiError('input'));
  }
};
