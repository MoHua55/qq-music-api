import type { OperationHandler } from './types';

// src/routes/operations/getOwnedPlaylistSongs.ts
// 登录态歌单详情。宽松的 parseInt、零值回默认以及集合回包都照旧。
// 带 playCount=1 时从同一次回包的 dirinfo.listennum 补 play_cnt，不多打上游；「我喜欢」官方不显示，这里也不给。

const LIKED_SONGS_DIRID = 201;

const isDictionary = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const playCountOf = (data: Record<string, unknown>, dirid: number): number | undefined => {
  if (dirid === LIKED_SONGS_DIRID || !isDictionary(data.dirinfo)) return undefined;
  const { listennum, dirid: shownDirid } = data.dirinfo;
  if (shownDirid === LIKED_SONGS_DIRID) return undefined;
  return typeof listennum === 'number' && Number.isSafeInteger(listennum) && listennum >= 0
    ? listennum
    : undefined;
};

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
  const playCount = request.query('playCount') === '1' ? playCountOf(data, dirid) : undefined;
  return {
    status: 200,
    headers: {},
    body: {
      code: 200,
      songs,
      total,
      more: data.hasmore === true || Number(data.hasmore) === 1 || offset + songs.length < total,
      ...(playCount === undefined ? {} : { play_cnt: playCount }),
    },
  };
};
