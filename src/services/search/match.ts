import { QqApiError } from '../../protocol/errors';
import {
  anonymousResult,
  arrayOf,
  countOf,
  fieldsOf,
  objectOf,
  readAnonymousCgi,
} from '../catalog/anonymous';
import { okResult } from '../recommend/newRouteResult';
import { keywordOf } from './search';

/** 实体命中保留歌曲、歌手、专辑和 MV 分组；与纯文字搜索建议分开。 */
export const searchMatchResult = (rawKeyword: unknown) =>
  anonymousResult('get-search-match', async () => {
    const keyword = keywordOf(rawKeyword);
    const response = await readAnonymousCgi(
      '/splcloud/fcgi-bin/smartbox_new.fcg',
      { key: keyword, is_xml: 0 },
      'search.match',
    );
    const source = objectOf(response.data);
    const data: Record<string, unknown> = {};
    let entries = 0;
    for (const name of ['song', 'singer', 'album', 'mv']) {
      if (source[name] === undefined) continue;
      const group = objectOf(source[name]);
      const items = arrayOf(group.itemlist);
      const itemlist = items.map((entry) =>
        fieldsOf(objectOf(entry), ['docid', 'id', 'mid', 'name', 'singer', 'pic', 'vid']),
      );
      if (itemlist.some((item) => !Object.keys(item).length))
        throw new QqApiError('invalid-response');
      entries += itemlist.length;
      data[name] = {
        ...fieldsOf(group, ['name', 'order', 'type']),
        ...(countOf(group.count) === undefined ? {} : { count: group.count }),
        itemlist,
      };
    }
    if (!Object.keys(data).length) throw new QqApiError('invalid-response');
    if (!entries) throw new QqApiError('not-found');
    return okResult({ keyword, data });
  });
