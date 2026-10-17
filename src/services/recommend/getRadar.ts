import qrLoginService from '../auth/qrLogin.node';
import { radarPageOf, radarResult } from './radar';

// Node 版：会话解不开就是 null，按匿名读；业务实现与 serverless 共用。
export default async ({ token, page }: { token?: string; page?: string }) =>
  radarResult(await qrLoginService.resolveSession(token), radarPageOf(page));
