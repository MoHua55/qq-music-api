import { sortedCategoryPlaylistsResult } from '../../services/recommend/sortedCategoryPlaylists';
import { anonymousGet } from './anonymousGet';

export const sortedCategoryPlaylists = anonymousGet((request) =>
  sortedCategoryPlaylistsResult({
    id: request.query('id'),
    offset: request.query('offset'),
    limit: request.query('limit'),
    sortId: request.query('sortId'),
  }),
);
