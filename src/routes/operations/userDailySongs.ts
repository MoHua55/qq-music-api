import { dailySongsResult } from '../../services/recommend/dailySongs';
import type { OperationHandler } from './types';

export const userDailySongs: OperationHandler = async (request) =>
  dailySongsResult(await (await request.service()).resolveSession(request.token));
