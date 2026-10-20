import { QqApiError } from '../../protocol/errors';
import {
  anonymousResult,
  arrayOf,
  countOf,
  fieldsOf,
  integerOf,
  objectOf,
  readAnonymousCgi,
} from '../catalog/anonymous';
import { okResult } from '../recommend/newRouteResult';

const COMMENT_FIELDS = [
  'commentid',
  'rootcommentcontent',
  'nick',
  'rootcommentnick',
  'avatarurl',
  'praisenum',
  'time',
  'score',
  'is_hot',
  'is_hot_cmt',
  'is_stick',
  'vipicon',
  'user_type',
  'root_identity_pic',
  'root_identity_type',
  'identity_pic',
  'identity_type',
  'album_mid',
  'album_pmid',
  'albumid',
  'singerid',
  'singerids',
  'singername',
  'songid',
  'songname',
  'songtype',
] as const;
const REPLY_FIELDS = [
  'subcommentid',
  'subcommentcontent',
  'replynick',
  'replyednick',
  'reply_identity_pic',
  'reply_identity_type',
  'replyed_identity_pic',
  'replyed_identity_type',
  'album_mid',
  'album_pmid',
  'albumid',
  'singerid',
  'singerids',
  'singername',
  'songid',
  'songname',
  'songtype',
] as const;

// 上游偶尔有一条评论不带 rootcommentid（真账号见过一般评论的最后一条缺这个字段）。
// 这条照样交出、只是不带它；续页游标只认真的有 rootcommentid 的末条，不拿别的字段顶替。
const commentOf = (raw: unknown) => {
  const item = objectOf(raw);
  const root =
    typeof item.rootcommentid === 'string' && item.rootcommentid ? item.rootcommentid : undefined;
  const middle = item.middlecommentcontent;
  return {
    ...(root === undefined ? {} : { rootcommentid: root }),
    ...fieldsOf(item, COMMENT_FIELDS),
    ...(middle === undefined
      ? {}
      : {
          middlecommentcontent:
            middle === null
              ? null
              : arrayOf(middle).map((value) => fieldsOf(objectOf(value), REPLY_FIELDS)),
        }),
  };
};

/** 数字参数按调用者给的值传递；不猜歌曲、专辑、歌单的类型码。 */
export const commentListResult = (query: {
  id?: unknown;
  page?: unknown;
  limit?: unknown;
  cursor?: unknown;
  biztype?: unknown;
  cid?: unknown;
  cmd?: unknown;
  reqtype?: unknown;
}) =>
  anonymousResult('get-comment-list', async () => {
    const id = String(integerOf(query.id, undefined, 1));
    const page = integerOf(query.page, 0);
    const limit = integerOf(query.limit, 25, 1, 50);
    const cursor = query.cursor === undefined ? '' : query.cursor;
    if (
      typeof cursor !== 'string' ||
      cursor.length > 256 ||
      Array.from(cursor).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
      (page > 0 && !cursor)
    )
      throw new QqApiError('input');
    const biztype = integerOf(query.biztype, 1);
    const cid = integerOf(query.cid, 205360772);
    const cmd = integerOf(query.cmd, 8);
    const reqtype = integerOf(query.reqtype, 2);
    const source = await readAnonymousCgi(
      '/base/fcgi-bin/fcg_global_comment_h5.fcg',
      {
        topid: id,
        pagenum: page,
        pagesize: limit,
        lasthotcommentid: cursor,
        biztype,
        cid,
        cmd,
        reqtype,
        domain: 'qq.com',
        ct: 24,
        cv: 10101010,
        needmusiccrit: 0,
      },
      'comment.list',
    );
    const data: Record<string, unknown> = fieldsOf(source, [
      'morecomment',
      'allow_comment',
      'allow_song',
      'no_copyright',
      'showYuerenTip',
      'topic_name',
    ]);
    let count = 0;
    let nextCursor: string | undefined;
    for (const key of ['comment', 'hot_comment']) {
      if (source[key] === undefined) continue;
      const group = objectOf(source[key]);
      const entries = arrayOf(group.commentlist).map(commentOf);
      count += entries.length;
      data[key] = {
        commentlist: entries,
        ...(countOf(group.commenttotal) === undefined ? {} : { commenttotal: group.commenttotal }),
      };
      if (key === 'comment' && entries.length)
        nextCursor = entries[entries.length - 1].rootcommentid;
    }
    if (source.comment === undefined && source.hot_comment === undefined)
      throw new QqApiError('invalid-response');
    if (!count) throw new QqApiError('not-found');
    return okResult({ data, ...(nextCursor === undefined ? {} : { nextCursor }) });
  });
