import qrLoginService from '../auth/qrLogin.node';
import type { UserPlaylistOptions } from './userPlaylistResponse';

export interface UserPlaylistParams {
  token?: string;
  uin?: string;
  options?: UserPlaylistOptions;
}

// 没有续读参数时照旧只传两个参数，与以前的调用完全相同。
export default async ({ token, uin, options }: UserPlaylistParams) =>
  options
    ? qrLoginService.getUserPlaylists(token, uin, options)
    : qrLoginService.getUserPlaylists(token, uin);
