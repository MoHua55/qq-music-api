// src/services/auth/qrLogin.ts
// 保留原来的认证入口与公开名称；实现分别放在协议、会话、播放和 QR 服务模块中。

export { buildAndroidComm, buildQimeiRequest } from './androidDevice';
export type {
  AuthenticatedSongListDetailOptions,
  OwnedPlaylistSongsParams,
} from './authenticatedReads';
export {
  createMqttListen,
  createMqttListenOver,
  type MqttConnect,
  type MqttSocket,
  type MqttSocketHandlers,
  type WebSocketConstructor,
  webSocketConnect,
} from './mqtt';
export {
  credentialCookieHeader,
  QqDeviceBootstrapError,
  QqProtocolError,
  QrLoginServiceError,
} from './musicuProtocol';
export { createRelayQqQrDriver, type QqQrRelay } from './qrDrivers';
export { createQrLoginService } from './qrService';
export {
  type AuthSession,
  type AuthSessionRepository,
  DEFAULT_LOGIN_CHANNEL,
  isSupportedLoginChannel,
  type LegacyQrLoginChannel,
  NODE_RUNTIME_CAPABILITIES,
  normalizeLoginChannel,
  type QqCredential,
  type QrChannelDriver,
  type QrCheckResult,
  type QrCodeMaterial,
  type QrDriverContext,
  type QrEvent,
  type QrEventListener,
  type QrFailureDetails,
  type QrFailureDiagnostics,
  type QrLoginChannel,
  type QrLoginService,
  type QrPrimaryFailure,
  type QrSessionRecord,
  type QrSessionRepository,
  type QrState,
  type RuntimeCapabilities,
  type SessionResolver,
  SUPPORTED_LOGIN_CHANNELS,
} from './qrTypes';
export {
  createMemoryAuthSessionRepository,
  createMemoryQrSessionRepository,
  createStoredSessionResolver,
  isAuthSession,
  isQrSessionRecord,
} from './sessionState';
