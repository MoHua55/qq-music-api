import type { AuthSession } from '../../services/auth/qrLogin';
import type { OperationRequest } from './types';

// src/routes/operations/requestValues.ts
//
// 新路由 handler 共用的两件小事：按各自原来的方式读参数，按路由的要求解析会话。

/**
 * 参数按两边原来读到的值交出去：Node 带重复参数时是数组，Serverless 只有第一个值。
 * 后面的业务函数自己会把不合法的值当成没给，这里不先统一，免得悄悄改了原有行为。
 */
export const rawQuery = (request: OperationRequest, name: string): string | string[] | undefined =>
  request.queryRaw(name);

/** 要登录的路由：没有会话或解不开都交给业务函数回 401。 */
export const requiredSession = async (request: OperationRequest): Promise<AuthSession | null> =>
  (await request.service()).resolveSession(request.token);

/**
 * 有会话就带凭证，没有就匿名。Node 进程里总有登录服务；Serverless 没设密钥时解不开任何会话，
 * 也就不建服务，直接匿名。
 */
export const optionalSession = async (request: OperationRequest): Promise<AuthSession | null> =>
  request.runtime === 'node' || (request.sessionConfigured && request.token)
    ? requiredSession(request)
    : null;
