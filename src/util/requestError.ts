/**
 * 请求本身不被接受（例如查询别人的账号），调用方改参数就能解决，不是服务端故障。
 *
 * 控制器包装与 serverless 兜底都把它映射成 400，回应是 `{ code: 400, message }`，与其他用户路由的
 * 400 同形。message 只用固定文字，不夹带调用方输入。
 *
 * 和 `authError.ts` 一样放在 `util/`、不引入任何模块：日志路径与 serverless 都要认得它。
 */
export class RequestRejectedError extends Error {
  public readonly httpStatus = 400;

  constructor(message: string) {
    super(message);
    this.name = 'RequestRejectedError';
  }
}
