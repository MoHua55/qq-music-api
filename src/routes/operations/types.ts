import type { QrLoginService, RuntimeCapabilities } from '../../services/auth/qrLogin';

/** 封存 QR 的宿主适配；Node 直接调用原服务，serverless 在每次调用中还原封存状态。 */
export type QrRouteService = Pick<QrLoginService, 'createSession' | 'createQr' | 'checkQr'> & {
  cancelSession(key: string): void | Promise<void>;
};

// src/routes/operations/types.ts
//
// 两边共用的路由处理（operation handler）：业务只写一份，不碰 Koa 的 ctx，也不碰 fetch 的 Request。
// Koa 和 serverless 各有一个很薄的转接，把自己的请求整理成 `OperationRequest`，再把
// `OperationResult` 写回去。这个目录下的文件两边都会打包，所以不能引入 npm 包或 `node:*`。

/** 请求从哪一边进来。两边原有的差异要照旧保留时，handler 看它决定怎么做。 */
export type OperationRuntime = 'node' | 'serverless';

export interface OperationRequest {
  runtime: OperationRuntime;
  /** 同名参数的第一个值；没带这个参数是 `undefined`，带了但是空的是 `''`。两边一致。 */
  query(name: string): string | undefined;
  /**
   * 各自原来读到的值，只给要保留原有行为的 handler 用。Node 是 `ctx.query[name]`，重复的参数是
   * 数组；serverless 一直用 `searchParams.get`，只有第一个值。
   */
  queryRaw(name: string): string | string[] | undefined;
  /** 路径参数。可选的段没出现就没有这个键，不是空字符串。 */
  params: Readonly<Record<string, string>>;
  /** 会话 token，两边都是 header、query 里的 cookie、Cookie header 依次取。 */
  readonly token: string | undefined;
  /** serverless 是否配置了会话密钥，只传能力判断，不传密钥本身。 */
  readonly sessionConfigured?: boolean;
  /** 登录服务。serverless 每次请求现建，所以只在真的用到时才调用。 */
  service(): Promise<QrLoginService>;
  readonly qr?: Partial<QrRouteService>;
  readonly capabilities?: RuntimeCapabilities;
}

/** 和新路由的结果同一个形状：状态码、要加的 header、JSON 内容。 */
export interface OperationResult {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export type OperationHandler = (request: OperationRequest) => Promise<OperationResult>;
