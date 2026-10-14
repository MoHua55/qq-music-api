import { QqApiError, toNewRouteErrorResponse } from '../../protocol/errors';
import type { AuthSession } from '../../services/auth/qrLogin';
import type { OperationHandler, OperationResult } from './types';

/** 真账号双向验证前，只允许可信宿主明确开启的测试入口。 */
export const unverifiedWrite =
  (execute: (session: AuthSession, body: unknown) => Promise<OperationResult>): OperationHandler =>
  async (request) => {
    if (request.method !== 'POST')
      return {
        status: 405,
        headers: { Allow: 'POST' },
        body: { code: 405, message: 'POST required' },
      };
    if (!request.unverifiedWritesEnabled)
      return toNewRouteErrorResponse(new QqApiError('feature-unavailable'));
    const session = await (await request.service()).resolveSession(request.token);
    if (!session) return toNewRouteErrorResponse(new QqApiError('auth-missing'));
    let body: unknown;
    try {
      body = await request.body?.();
    } catch {
      return toNewRouteErrorResponse(new QqApiError('input'));
    }
    return execute(session, body);
  };
