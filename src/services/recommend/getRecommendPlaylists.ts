import qrLoginService from '../auth/qrLogin.node';
import { recommendPlaylistsLimitOf, recommendPlaylistsResult } from './recommendPlaylists';

// Node 版：会话解不开就是 null，按匿名读；业务实现与 serverless 共用。
export default async ({ token, limit }: { token?: string; limit?: string }) =>
  recommendPlaylistsResult(
    await qrLoginService.resolveSession(token),
    recommendPlaylistsLimitOf(limit),
  );
