import qrLoginService from '../auth/qrLogin.node';
import type { UserPlaylistOptions } from './userPlaylistResponse';

export interface UserPlaylistParams {
  token?: string;
  uin?: string;
  options?: UserPlaylistOptions;
}

export default async ({ token, uin, options }: UserPlaylistParams) =>
  qrLoginService.getUserPlaylists(token, uin, options);
