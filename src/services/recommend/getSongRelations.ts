import qrLoginService from '../auth/qrLogin.node';
import { relatedPlaylistsResult, similarSongsResult } from './songRelations';

// Node 版：用进程里的登录服务解析会话，业务实现与 serverless 共用。
export const getSimilarSongs = async ({ token, id }: { token?: string; id?: string }) =>
  similarSongsResult(await qrLoginService.resolveSession(token), id);

export const getRelatedPlaylists = async ({ token, id }: { token?: string; id?: string }) =>
  relatedPlaylistsResult(await qrLoginService.resolveSession(token), id);
