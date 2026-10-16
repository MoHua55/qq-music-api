import type { OperationHandler, OperationResult } from './types';

// src/routes/operations/loginRefresh.ts
//
// POST /login/refresh：客户端主动要求续期。sealed 部署在最后 6 小时内续期并交出新 token，
// stored 部署照常静默续期、token 不变。旧 token 都照原到期时间可用，客户端没存到新的也只是下次再续。
export const loginRefresh: OperationHandler = async (request): Promise<OperationResult> => {
  if (request.method !== 'POST')
    return {
      status: 405,
      headers: { Allow: 'POST' },
      body: { code: 405, message: 'POST required' },
    };
  const rotation = await (await request.service()).refreshSession(request.token);
  if (!rotation)
    return { status: 401, headers: {}, body: { code: 401, message: 'Login required' } };
  return { status: 200, headers: {}, body: { code: 200, data: rotation } };
};
