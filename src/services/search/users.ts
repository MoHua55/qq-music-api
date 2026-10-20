import { QqApiError } from '../../protocol/errors';
import { isDictionary } from '../../util/values';
import type { AuthSession } from '../auth/qrLogin';
import { failureResult, okResult } from '../recommend/newRouteResult';
import { createSessionMusicuClient } from '../recommend/sessionMusicu';
import { keywordOf, searchIdOf } from './search';

const pageValue = (raw: unknown, fallback: number, max = Number.MAX_SAFE_INTEGER): number => {
  if (raw === undefined) return fallback;
  const value = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new QqApiError('input');
  return value;
};

export const searchUsersResult = async (
  raw: { keyword?: unknown; page?: unknown; limit?: unknown },
  session: AuthSession | null,
) => {
  try {
    if (!session) throw new QqApiError('auth-missing');
    const keyword = keywordOf(raw.keyword);
    const page = pageValue(raw.page, 1);
    const limit = pageValue(raw.limit, 10, 20);
    const data = await createSessionMusicuClient(session, { maxRetries: 0 }).execute({
      module: 'music.search.SearchCgiService',
      method: 'DoSearchForQQMusicMobile',
      param: {
        searchid: searchIdOf(),
        query: keyword,
        search_type: 8,
        num_per_page: limit,
        page_num: page,
        highlight: false,
        grp: true,
        selectors: {},
        vec_selectors: [],
      },
      readOnly: true,
    });
    if (!isDictionary(data) || !isDictionary(data.body) || !isDictionary(data.meta))
      throw new QqApiError('invalid-response');
    if (data.code !== undefined && data.code !== 0) throw new QqApiError('invalid-response');
    const users = data.body.item_user;
    if (!Array.isArray(users) || !users.every(isDictionary))
      throw new QqApiError('invalid-response');
    if (!users.length) throw new QqApiError('not-found');
    const sum = data.meta.sum;
    const total = typeof sum === 'number' && Number.isSafeInteger(sum) && sum >= 0 ? sum : null;
    return okResult({ users, total });
  } catch (error) {
    return failureResult('search-users', error);
  }
};
