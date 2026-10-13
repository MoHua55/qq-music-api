import type { OperationHandler } from './types';

// src/routes/operations/getOwnedPlaylistSongs.ts
// 登录态歌单详情。宽松的 parseInt、零值回默认以及集合回包都照旧。
export const getOwnedPlaylistSongs: OperationHandler = async (request) => {
  const idOf = (raw: string | string[] | undefined): number =>
    /^\d+$/.test(String(raw ?? '')) ? Number(raw) : 0;
  const disstid = idOf(request.queryRaw('tid'));
  const dirid = idOf(request.queryRaw('dirid'));
  if (!disstid && !dirid)
    return { status: 400, headers: {}, body: { code: 400, message: 'tid or dirid is required' } };
  const offset = Math.max(0, Number.parseInt(String(request.queryRaw('offset') ?? '0'), 10) || 0);
  const limit = Math.min(
    100,
    Math.max(1, Number.parseInt(String(request.queryRaw('limit') ?? '100'), 10) || 100),
  );
  const data = await (await request.service()).getOwnedPlaylistSongs(request.token, {
    disstid,
    dirid,
    offset,
    limit,
  });
  if (!data) return { status: 401, headers: {}, body: { code: 401, message: 'Login required' } };
  const songs = Array.isArray(data.songlist) ? data.songlist : [];
  const total = typeof data.total_song_num === 'number' ? data.total_song_num : songs.length;
  return {
    status: 200,
    headers: {},
    body: {
      code: 200,
      songs,
      total,
      more: data.hasmore === true || Number(data.hasmore) === 1 || offset + songs.length < total,
    },
  };
};
