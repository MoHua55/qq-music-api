import { QqApiError, toNewRouteErrorResponse } from '../../protocol/errors';
import { playlistTracksResult } from '../../services/user/playlistTracks';
import type { OperationHandler } from './types';

export const playlistTracks: OperationHandler = async (request) => {
  if (request.method !== 'POST')
    return {
      status: 405,
      headers: { Allow: 'POST' },
      body: { code: 405, message: 'POST required' },
    };
  const session = await (await request.service()).resolveSession(request.token);
  if (!session) return toNewRouteErrorResponse(new QqApiError('auth-missing'));
  try {
    return playlistTracksResult(session, await request.body?.());
  } catch {
    return toNewRouteErrorResponse(new QqApiError('input'));
  }
};
