import {
  toUserPlaylistBody,
  userPlaylistOptionsOf,
} from '../../services/user/userPlaylistResponse';
import type { OperationHandler } from './types';

// src/routes/operations/getUserPlaylist.ts
// 用户歌单。Node 的重复 uid 仍是数组，不把旧的参数行为悄悄改成只取第一项。
export const getUserPlaylist: OperationHandler = async (request) => {
  const service = await request.service();
  const uid = request.queryRaw('uid') as string | undefined;
  const options = userPlaylistOptionsOf(request.queryRaw('favoriteOffset'));
  // Node 的旧 service 包装在没有续读时只传两个参数；serverless 原来一直传三个。
  const data =
    request.runtime === 'node' && !options
      ? await service.getUserPlaylists(request.token, uid)
      : await service.getUserPlaylists(request.token, uid, options);
  return {
    status: data ? 200 : 401,
    headers: {},
    body: data ? toUserPlaylistBody(data) : { code: 401, message: 'Login required' },
  };
};
