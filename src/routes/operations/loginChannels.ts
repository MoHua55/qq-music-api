import { NODE_RUNTIME_CAPABILITIES } from '../../services/auth/qrLogin';
import { describeRuntimeCapabilities } from '../../services/runtimeCapabilities';
import type { OperationHandler } from './types';

export const loginChannels: OperationHandler = async (request) => {
  const node = request.runtime === 'node';
  const capabilities = node
    ? NODE_RUNTIME_CAPABILITIES
    : (request.capabilities ?? { channels: ['wechat'] as const, sessionMode: 'sealed' as const });
  return {
    status: 200,
    headers: {},
    body: {
      code: 200,
      data: describeRuntimeCapabilities(
        request.runtime,
        capabilities,
        node || Boolean(request.sessionConfigured),
      ),
    },
  };
};
