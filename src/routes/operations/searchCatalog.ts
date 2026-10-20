import { searchResult } from '../../services/search/search';
import { hotSearchesResult, searchSuggestionsResult } from '../../services/search/suggest';
import { optionalSession, rawQuery } from './requestValues';
import type { OperationHandler } from './types';

// src/routes/operations/searchCatalog.ts
//
// 关键字搜索有会话就带凭证、没有就匿名搜；热搜和搜索建议一律匿名读。

export const getSearch: OperationHandler = async (request) => {
  const query = {
    keyword: rawQuery(request, 'keyword'),
    type: rawQuery(request, 'type'),
    page: rawQuery(request, 'page'),
    limit: rawQuery(request, 'limit'),
  };
  return searchResult(query, await optionalSession(request));
};

export const getHotSearches: OperationHandler = () => hotSearchesResult();

export const getSearchSuggestions: OperationHandler = (request) =>
  searchSuggestionsResult(rawQuery(request, 'keyword'));
