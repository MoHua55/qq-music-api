import { commentListResult } from '../../services/comments/list';
import { anonymousGet } from './anonymousGet';

export const commentList = anonymousGet((request) =>
  commentListResult({
    id: request.query('id'),
    page: request.query('page'),
    limit: request.query('limit'),
    cursor: request.query('cursor'),
    biztype: request.query('biztype'),
    cid: request.query('cid'),
    cmd: request.query('cmd'),
    reqtype: request.query('reqtype'),
  }),
);
