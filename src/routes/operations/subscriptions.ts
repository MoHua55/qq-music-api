import { QqApiError, toNewRouteErrorResponse } from '../../protocol/errors';
import {
  playlistSubscribeResult,
  subscriptionStatusResult,
} from '../../services/user/subscriptions';
import type { OperationHandler } from './types';

export const playlistSubscribe: OperationHandler = async (request) => {
  if (request.method !== 'POST')
    return {
      status: 405,
      headers: { Allow: 'POST' },
      body: { code: 405, message: 'POST required' },
    };
  const session = await (await request.service()).resolveSession(request.token);
  if (!session) return toNewRouteErrorResponse(new QqApiError('auth-missing'));
  try {
    return playlistSubscribeResult(session, await request.body?.());
  } catch {
    return toNewRouteErrorResponse(new QqApiError('input'));
  }
};
export const subscriptionStatus: OperationHandler = async (request) => {
  if (request.method !== 'GET')
    return { status: 405, headers: { Allow: 'GET' }, body: { code: 405, message: 'GET required' } };
  return subscriptionStatusResult(
    await (await request.service()).resolveSession(request.token),
    request.query('type'),
    request.query('ids'),
  );
};
