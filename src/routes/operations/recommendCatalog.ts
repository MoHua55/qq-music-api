import {
  categoryPlaylistsResult,
  newAlbumsResult,
  newSongsResult,
  playlistCategoriesResult,
  toplistSongsResult,
  toplistsResult,
} from '../../services/recommend/catalog';
import { rawQuery } from './requestValues';
import type { OperationHandler } from './types';

// src/routes/operations/recommendCatalog.ts
//
// 歌单分类、分类歌单、新歌、新碟、排行榜：公开内容，一律匿名读，没设会话密钥也能用。

export const getPlaylistCategories: OperationHandler = () => playlistCategoriesResult();

export const getCategoryPlaylists: OperationHandler = (request) =>
  categoryPlaylistsResult({
    id: rawQuery(request, 'id'),
    page: rawQuery(request, 'page'),
    limit: rawQuery(request, 'limit'),
  });

export const getNewSongs: OperationHandler = (request) => newSongsResult(rawQuery(request, 'area'));

export const getNewAlbums: OperationHandler = (request) =>
  newAlbumsResult({
    area: rawQuery(request, 'area'),
    offset: rawQuery(request, 'offset'),
    limit: rawQuery(request, 'limit'),
  });

export const getRecommendToplists: OperationHandler = () => toplistsResult();

export const getRecommendToplistSongs: OperationHandler = (request) =>
  toplistSongsResult({
    id: rawQuery(request, 'id'),
    period: rawQuery(request, 'period'),
    offset: rawQuery(request, 'offset'),
    limit: rawQuery(request, 'limit'),
  });
