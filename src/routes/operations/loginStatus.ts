import type { OperationHandler } from './types';

// src/routes/operations/loginStatus.ts
// 登录状态始终回 200；有没有 profile 由服务判断，其他异常仍交给宿主兜底。
export const loginStatus: OperationHandler = async (request) => {
  const profile = await (await request.service()).getLoginStatus(request.token);
  return { status: 200, headers: {}, body: { code: 200, data: profile ? { profile } : {} } };
};
