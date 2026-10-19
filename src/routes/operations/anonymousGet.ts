import type { OperationHandler } from './types';

/** 只约束新增匿名读取接口，不改变既有 Serverless 的方法行为。 */
export const anonymousGet =
  (handler: OperationHandler): OperationHandler =>
  async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD')
      return {
        status: 405,
        headers: { Allow: 'GET, HEAD' },
        body: { code: 405, message: 'GET required' },
      };
    return handler(request);
  };
