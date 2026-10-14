import { QqApiError, toNewRouteErrorResponse } from '../../protocol/errors';
import { playlistCreateResult, playlistDeleteResult } from '../../services/user/playlistManagement';
import { playlistRenameResult } from '../../services/user/playlistRename';
import type { OperationHandler } from './types';

const writeHandler =
  (action: typeof playlistCreateResult): OperationHandler =>
  async (request) => {
    if (request.method !== 'POST')
      return {
        status: 405,
        headers: { Allow: 'POST' },
        body: { code: 405, message: 'POST required' },
      };
    const session = await (await request.service()).resolveSession(request.token);
    if (!session) return toNewRouteErrorResponse(new QqApiError('auth-missing'));
    let body: unknown;
    try {
      body = await request.body?.();
    } catch {
      return toNewRouteErrorResponse(new QqApiError('input'));
    }
    return action(session, body);
  };
export const playlistCreate = writeHandler(playlistCreateResult);
export const playlistDelete = writeHandler(playlistDeleteResult);
export const playlistRename = writeHandler(playlistRenameResult);
