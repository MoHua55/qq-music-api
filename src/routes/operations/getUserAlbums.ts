import type { OperationHandler } from './types';

// src/routes/operations/getUserAlbums.ts
// 收藏专辑。宽松的 parseInt、零值回默认以及集合回包都照旧。
export const getUserAlbums: OperationHandler = async (request) => {
  const offset = Math.max(0, Number.parseInt(String(request.queryRaw('offset') ?? '0'), 10) || 0);
  const limit = Math.min(
    100,
    Math.max(1, Number.parseInt(String(request.queryRaw('limit') ?? '20'), 10) || 20),
  );
  const data = await (await request.service()).getUserAlbums(request.token, offset, limit);
  if (!data) return { status: 401, headers: {}, body: { code: 401, message: 'Login required' } };
  const albums = Array.isArray(data.albumlist) ? data.albumlist : [];
  const total = typeof data.totalalbum === 'number' ? data.totalalbum : albums.length;
  return {
    status: 200,
    headers: {},
    body: {
      code: 200,
      albums,
      total,
      more: Number(data.has_more) === 1 || offset + albums.length < total,
    },
  };
};
