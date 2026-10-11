import qrLoginService from '../auth/qrLogin.node';
import { guessYouLikeResult } from './guessYouLike';

// Node 版：用进程里的登录服务解析会话，业务实现与 serverless 共用。
export default async ({ token }: { token?: string }) =>
  guessYouLikeResult(await qrLoginService.resolveSession(token));
