import { userVipResult } from '../../services/user/vip';
import type { OperationHandler } from './types';

export const userVip: OperationHandler = async (request) =>
  userVipResult(await (await request.service()).resolveSession(request.token));
