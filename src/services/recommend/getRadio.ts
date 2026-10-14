import qrLoginService from '../auth/qrLogin.node';
import { radioListResult, radioTracksResult } from './radio';

// Node 版：用进程里的登录服务解析会话，业务实现与 serverless 共用。
export const getRadioList = async ({ token }: { token?: string }) =>
  radioListResult(await qrLoginService.resolveSession(token));

export const getRadioTracks = async ({ token, id }: { token?: string; id?: unknown }) =>
  radioTracksResult(await qrLoginService.resolveSession(token), id);
