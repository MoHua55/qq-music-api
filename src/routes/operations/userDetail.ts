import type { OperationHandler } from './types';

// src/routes/operations/userDetail.ts
// 用户资料。服务返回空才回登录要求，其他异常继续交给原来的宿主兜底。
export const userDetail: OperationHandler = async (request) => {
  const profile = await (await request.service()).getUserDetail(request.token);
  return {
    status: profile ? 200 : 401,
    headers: {},
    body: profile ? { code: 200, profile } : { code: 401, message: 'Login required' },
  };
};
