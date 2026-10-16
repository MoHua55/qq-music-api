import { cloudSongsResult } from '../../services/user/cloud';
import type { OperationHandler } from './types';

export const userCloud: OperationHandler = async (request) =>
  cloudSongsResult(await (await request.service()).resolveSession(request.token), {
    limit: request.query('limit'),
    offset: request.query('offset'),
  });
