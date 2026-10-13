import type { OperationHandler } from './types';

// src/routes/operations/getUserLikedSongs.ts
// 喜欢歌曲。宽松的 parseInt、零值回默认以及集合回包都照旧。
export const getUserLikedSongs: OperationHandler = async (request) => {
  const offset = Math.max(0, Number.parseInt(String(request.queryRaw('offset') ?? '0'), 10) || 0);
  const limit = Math.min(
    100,
    Math.max(1, Number.parseInt(String(request.queryRaw('limit') ?? '100'), 10) || 100),
  );
  const data = await (await request.service()).getUserLikedSongs(request.token, offset, limit);
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
