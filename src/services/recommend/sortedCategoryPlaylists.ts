import { QqApiError } from '../../protocol/errors';
import {
  anonymousResult,
  arrayOf,
  countOf,
  fieldsOf,
  integerOf,
  objectOf,
  readAnonymousCgi,
  textOf,
} from '../catalog/anonymous';
import { okResult } from './newRouteResult';

export const sortedCategoryPlaylistsResult = (query: {
  id?: unknown;
  offset?: unknown;
  limit?: unknown;
  sortId?: unknown;
}) =>
  anonymousResult('get-sorted-category-playlists', async () => {
    const id = integerOf(query.id, 10000000, 1);
    const offset = integerOf(query.offset, 0);
    const limit = integerOf(query.limit, 20, 1, 60);
    const sortId = integerOf(query.sortId, 5);
    const end = offset + limit - 1;
    if (!Number.isSafeInteger(end)) throw new QqApiError('input');
    const response = await readAnonymousCgi(
      '/splcloud/fcgi-bin/fcg_get_diss_by_tag.fcg',
      { categoryId: id, sortId, sin: offset, ein: end, picmid: 1 },
      'recommend.category-playlists-sorted',
    );
    const data = objectOf(response.data);
    const entries = arrayOf(data.list);
    if (!entries.length) throw new QqApiError('not-found');
    const playlists = entries.flatMap((entry) => {
      const item = objectOf(entry);
      const idText =
        typeof item.dissid === 'string' || typeof item.dissid === 'number'
          ? String(item.dissid)
          : '';
      const tid = /^\d{1,15}$/.test(idText) ? Number(idText) : 0;
      if (!Number.isSafeInteger(tid) || tid <= 0) return [];
      const source = item.creator === undefined ? {} : objectOf(item.creator);
      const creator = fieldsOf(
        {
          nick: source.name,
          avatar: source.avatarUrl,
          encrypt_uin: source.encrypt_uin,
        },
        ['nick', 'avatar', 'encrypt_uin'],
      );
      return [
        {
          tid,
          title: textOf(item.dissname),
          desc: textOf(item.introduction),
          picurl: textOf(item.imgurl),
          ...(countOf(item.listennum) === undefined ? {} : { play_cnt: item.listennum }),
          creator,
        },
      ];
    });
    if (!playlists.length) throw new QqApiError('invalid-response');
    const total = countOf(data.sum);
    return okResult({
      playlists,
      ...(total === undefined ? {} : { total }),
      more: total !== undefined && offset + entries.length < total,
    });
  });
