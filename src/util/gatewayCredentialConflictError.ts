// 网关与凭证码冲突时供两个宿主返回 502，协议数字和安全说明仍保持原形。
export class GatewayCredentialConflictError extends Error {
  public readonly responseStatus = 502;
  public readonly phase: string;
  public readonly upstreamCode: number | undefined;
  public readonly globalCode: number;
  public readonly httpStatus: number;

  constructor(error: {
    phase: string;
    upstreamCode: number | undefined;
    globalCode: number;
    httpStatus: number;
  }) {
    super(
      `${error.phase} failed (HTTP ${error.httpStatus}, global=${error.globalCode}, code=${error.upstreamCode ?? 'unknown'})`,
    );
    // 安全摘要继续走协议错误的白名单，502 是客户端收到的状态，不覆盖上游 HTTP 200。
    this.name = 'QqProtocolError';
    this.phase = error.phase;
    this.upstreamCode = error.upstreamCode;
    this.globalCode = error.globalCode;
    this.httpStatus = error.httpStatus;
  }
}
