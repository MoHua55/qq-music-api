import {
  commentCountResult,
  hotCommentsResult,
  newCommentsResult,
} from '../../services/comments/catalog';
import {
  mvDetailResult,
  mvListResult,
  mvUrlResult,
  songMvsResult,
} from '../../services/mv/catalog';
import { songLabelsResult } from '../../services/recommend/songLabels';
import {
  similarSingersResult,
  singerDetailResult,
  singerHomepageResult,
  singerListResult,
  singerMvsResult,
  singerSongsResult,
} from '../../services/singers/catalog';
import { optionalSession, rawQuery } from './requestValues';
import type { OperationHandler } from './types';

// src/routes/operations/mediaCatalog.ts
//
// 歌手、歌曲评论、MV、歌曲标签：公开内容，没设会话密钥也能用。除了 MV 播放链接有会话就带凭证读，其余一律匿名。

const pageOf = (request: Parameters<OperationHandler>[0], key: 'mid' | 'id') => ({
  [key]: rawQuery(request, key),
  offset: rawQuery(request, 'offset'),
  limit: rawQuery(request, 'limit'),
});

export const listSingers: OperationHandler = (request) =>
  singerListResult({
    area: rawQuery(request, 'area'),
    sex: rawQuery(request, 'sex'),
    genre: rawQuery(request, 'genre'),
    index: rawQuery(request, 'index'),
    offset: rawQuery(request, 'offset'),
    limit: rawQuery(request, 'limit'),
  });

export const getSingerDetail: OperationHandler = (request) =>
  singerDetailResult(rawQuery(request, 'mid'));

export const getSingerHomepage: OperationHandler = (request) =>
  singerHomepageResult(rawQuery(request, 'mid'));

export const getSimilarSingers: OperationHandler = (request) =>
  similarSingersResult(rawQuery(request, 'mid'));

export const getSingerSongs: OperationHandler = (request) =>
  singerSongsResult(pageOf(request, 'mid'));

export const getSingerMvs: OperationHandler = (request) => singerMvsResult(pageOf(request, 'mid'));

export const getHotComments: OperationHandler = (request) =>
  hotCommentsResult(pageOf(request, 'id'));

export const getNewComments: OperationHandler = (request) =>
  newCommentsResult(pageOf(request, 'id'));

export const getCommentCount: OperationHandler = (request) =>
  commentCountResult(rawQuery(request, 'id'));

export const getMvList: OperationHandler = (request) =>
  mvListResult({
    area: rawQuery(request, 'area'),
    version: rawQuery(request, 'version'),
    offset: rawQuery(request, 'offset'),
    limit: rawQuery(request, 'limit'),
  });

export const getMvDetail: OperationHandler = (request) => mvDetailResult(rawQuery(request, 'vid'));

export const getMvUrl: OperationHandler = async (request) =>
  mvUrlResult(rawQuery(request, 'vid'), await optionalSession(request));

export const getSongMvs: OperationHandler = (request) => songMvsResult(rawQuery(request, 'id'));

export const getSongLabels: OperationHandler = (request) =>
  songLabelsResult(rawQuery(request, 'id'));
