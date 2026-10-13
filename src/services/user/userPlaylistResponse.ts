import { type Dictionary, numberOf } from '../auth/values';

// src/services/user/userPlaylistResponse.ts
//
// `/user/playlist` 的参数解析与回应组装。Node 控制器与 serverless 共用同一份，
// 只依赖 `auth/values`，保持运行时中立。

export interface UserPlaylistOptions {
  /** 从收藏歌单的这个位置接着读；不给就是第一轮（自建＋收藏）。 */
  favoriteOffset?: number;
}

/**
 * 与其他路由的 offset 一样宽松：不是正整数（缺少、0、负数、乱码）就当作第一轮，返回 `undefined`，
 * 这样不带参数的调用方（包括 Folia）与以前完全相同。
 */
export const favoriteOffsetOf = (raw: unknown): number | undefined => {
  const value = Number.parseInt(String(raw ?? ''), 10);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
};

export const userPlaylistOptionsOf = (raw: unknown): UserPlaylistOptions | undefined => {
  const favoriteOffset = favoriteOffsetOf(raw);
  return favoriteOffset === undefined ? undefined : { favoriteOffset };
};

/**
 * `more` 表示列表还不能确认完整；只有读到上限、确实可以接着读时才带 `nextFavoriteOffset`。
 * 空页或重复页停下时 `more` 仍是 `true`，但不给续读位置，免得调用方一直重复同一件事。
 */
export const toUserPlaylistBody = (data: Dictionary) => {
  const playlist = Array.isArray(data.v_playlist) ? data.v_playlist : [];
  const nextFavoriteOffset = numberOf(data.nextFavoriteOffset);
  return {
    code: 200,
    playlist,
    total: typeof data.total === 'number' ? data.total : playlist.length,
    more: data.bFinish === false,
    ...(nextFavoriteOffset !== undefined && Number.isSafeInteger(nextFavoriteOffset)
      ? { nextFavoriteOffset }
      : {}),
  };
};
