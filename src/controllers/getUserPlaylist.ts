import type { Context } from 'koa';
import services from '../services';
import { toUserPlaylistBody, userPlaylistOptionsOf } from '../services/user/userPlaylistResponse';
import { getTypedQuery } from '../types/core/request';
import { getAuthToken } from './login';

interface UserPlaylistQuery {
  uid?: string;
  favoriteOffset?: string;
}

export default async (ctx: Context): Promise<void> => {
  const { uid, favoriteOffset } = getTypedQuery<UserPlaylistQuery>(ctx);
  const data = await services.getUserPlaylist({
    token: getAuthToken(ctx),
    uin: uid,
    options: userPlaylistOptionsOf(favoriteOffset),
  });
  if (!data) {
    ctx.status = 401;
    ctx.body = { code: 401, message: 'Login required' };
    return;
  }
  ctx.status = 200;
  ctx.body = toUserPlaylistBody(data);
};
