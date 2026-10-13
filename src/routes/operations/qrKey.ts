import {
  DEFAULT_LOGIN_CHANNEL,
  normalizeLoginChannel,
  SUPPORTED_LOGIN_CHANNELS,
} from '../../services/auth/qrLogin';
import { qrServiceErrorResult } from './qrServiceError';
import type { OperationHandler } from './types';

export const qrKey: OperationHandler = async (request) => {
  const raw =
    request.queryRaw('channel') ?? (request.runtime === 'node' ? DEFAULT_LOGIN_CHANNEL : 'wechat');
  const channel = request.runtime === 'node' ? normalizeLoginChannel(raw) : raw;
  if (request.runtime === 'node' && !channel)
    return {
      status: 400,
      headers: {},
      body: { code: 400, message: `channel must be one of ${SUPPORTED_LOGIN_CHANNELS.join(', ')}` },
    };
  try {
    const unikey = request.qr?.createSession
      ? await request.qr.createSession(channel as 'qq' | 'wechat')
      : await (await request.service()).createSession(channel as 'qq' | 'wechat');
    return { status: 200, headers: {}, body: { code: 200, data: { unikey } } };
  } catch (error) {
    return qrServiceErrorResult(error);
  }
};
