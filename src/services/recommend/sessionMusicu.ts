import { createMusicuClient } from '../../protocol/musicu';
import { createFetchTransport, type FetchExecutor } from '../../transport/fetch';
import { buildAndroidComm } from '../auth/androidDevice';
import { type AuthSession, credentialCookieHeader } from '../auth/qrLogin';

// src/services/recommend/sessionMusicu.ts
//
// 新路由的上游客户端：每个请求、每个会话各建一个，Cookie jar 不跨账号共用；限流用默认的共享令牌桶。
// 只依赖协议、传输与 auth 的中立模块，Node 和 serverless 共用。

export interface SessionMusicuOptions {
  /** 测试或宿主注入；不给就用运行时自己的 fetch。 */
  fetcher?: FetchExecutor;
}

/** 匿名请求用网页端的 comm，和曲库路由一样；2026-10 实测推荐歌单匿名可读。 */
const ANONYMOUS_COMM = { ct: 24, cv: 0 };

export const createSessionMusicuClient = (
  session: AuthSession | null,
  options: SessionMusicuOptions = {},
) => {
  const http = createFetchTransport(options.fetcher);
  if (!session) return createMusicuClient({ http, comm: ANONYMOUS_COMM });
  // 和既有的带凭证请求同一套 comm、User-Agent 与 Cookie。
  return createMusicuClient({
    http,
    comm: buildAndroidComm(session.device, session.credential),
    headers: {
      'User-Agent': `QQMusic 14090008(android ${session.device.osRelease})`,
      Cookie: credentialCookieHeader(session.credential),
    },
  });
};
