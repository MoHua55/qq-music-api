import { QqApiError } from '../../protocol/errors';
import {
  anonymousResult,
  arrayOf,
  countOf,
  objectOf,
  readAnonymousCgi,
  textOf,
} from '../catalog/anonymous';
import { okResult } from './newRouteResult';

/** 完整字典固定读旧 CGI；不与热门分类或单个分类详情拼接。 */
export const allCategoriesResult = () =>
  anonymousResult('get-all-playlist-categories', async () => {
    const response = await readAnonymousCgi(
      '/splcloud/fcgi-bin/fcg_get_diss_tag_conf.fcg',
      {},
      'recommend.categories-all',
    );
    const entries = arrayOf(objectOf(response.data).categories);
    if (!entries.length) throw new QqApiError('not-found');
    const groups = entries
      .map((entry) => {
        const group = objectOf(entry);
        const categories = arrayOf(group.items).flatMap((entry) => {
          const item = objectOf(entry);
          const id = countOf(item.categoryId);
          if (!id) return [];
          const sorts =
            item.allsorts === undefined
              ? undefined
              : arrayOf(item.allsorts).flatMap((entry) => {
                  const sort = objectOf(entry);
                  const id = countOf(sort.sortId);
                  return id === undefined ? [] : [{ id, name: textOf(sort.sortName) }];
                });
          return [
            {
              id,
              name: textOf(item.categoryName),
              ...(countOf(item.usable) === undefined ? {} : { usable: item.usable }),
              ...(sorts === undefined ? {} : { sorts }),
            },
          ];
        });
        return {
          name: textOf(group.categoryGroupName),
          ...(countOf(group.usable) === undefined ? {} : { usable: group.usable }),
          categories,
        };
      })
      .filter((group) => group.categories.length);
    if (!groups.length) throw new QqApiError('invalid-response');
    return okResult({ groups });
  });
