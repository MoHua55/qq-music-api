import { QqApiError } from '../../protocol/errors';
import type { MusicuDescriptor } from '../../protocol/musicu';
import { type Dictionary, dictionaryOf, isDictionary } from '../../util/values';
import { failureResult, type NewRouteResult, okResult } from '../recommend/newRouteResult';
import { createSessionMusicuClient, type SessionMusicuOptions } from '../recommend/sessionMusicu';
import { keywordOf, searchIdOf } from './search';

// src/services/search/suggest.ts
//
// `/search/hot`、`/search/suggest`：公开内容，一律匿名读，带了会话也不用。Node 与 serverless 共用。
// 实测（2026-10，匿名网页 comm）：热搜是 `HotkeyService.GetHotkeyForQQMusicMobile {}` → `vec_hotkey[]`
// （`query`、`title`、`description`…）；搜索建议是 `SmartBoxCgi.GetSmartBoxResult` → `items[]`，
// 搜索词是 `type 0`，同一个列表里还会夹别的条目（例如 AI 助手），只留搜索词。

const decodeDictionary = (data: unknown): Dictionary => {
  if (!isDictionary(data)) throw new QqApiError('invalid-response');
  return data;
};

const listOf = (value: unknown): unknown[] => {
  if (value !== null && value !== undefined && !Array.isArray(value))
    throw new QqApiError('invalid-response');
  return Array.isArray(value) ? value : [];
};

const textOf = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value : undefined;

const anonymous = (options: SessionMusicuOptions) => createSessionMusicuClient(null, options);

// ---- 热搜 ----

const HOT_SEARCHES: MusicuDescriptor<Dictionary> = {
  module: 'music.musicsearch.HotkeyService',
  method: 'GetHotkeyForQQMusicMobile',
  param: {},
  readOnly: true,
  operation: 'search.hot',
  decode: decodeDictionary,
};

/** 关键字去掉头尾空白；标题、说明只在是非空文字时给。跳转链接不给。 */
const toHotkey = (entry: unknown): Dictionary | null => {
  const item = dictionaryOf(entry);
  const keyword = textOf(item.query)?.trim();
  if (keyword === undefined) return null;
  const optional: Array<[string, unknown]> = [
    ['title', textOf(item.title)],
    ['description', textOf(item.description)],
  ];
  return {
    keyword,
    ...Object.fromEntries(optional.filter(([, value]) => value !== undefined)),
  };
};

/** 上游给空清单回 422，给了条目却一个关键字都读不出来回 502。 */
export const hotSearchesResult = async (
  options: SessionMusicuOptions = {},
): Promise<NewRouteResult> => {
  try {
    const entries = listOf((await anonymous(options).execute(HOT_SEARCHES)).vec_hotkey);
    if (!entries.length) throw new QqApiError('not-found');
    const hotkeys = entries.map(toHotkey).filter(Boolean);
    if (!hotkeys.length) throw new QqApiError('invalid-response');
    return okResult({ hotkeys });
  } catch (error) {
    return failureResult('get-hot-searches', error);
  }
};

// ---- 搜索建议 ----

/** 搜索词条目的 `type`；其他值（例如 AI 助手的 7）不是搜索词。 */
const SUGGESTION_TYPE = 0;

const searchSuggestions = (keyword: string): MusicuDescriptor<Dictionary> => ({
  module: 'music.smartboxCgi.SmartBoxCgi',
  method: 'GetSmartBoxResult',
  param: { search_id: searchIdOf(), query: keyword, num_per_page: 0, page_idx: 0 },
  readOnly: true,
  operation: 'search.suggest',
  decode: decodeDictionary,
});

/**
 * 关键字和 `/search` 一样：去掉头尾空白后不能是空的，最多 60 个字，不对就回 400、不请求上游。
 * 没有任何搜索词条目回 422；有搜索词条目却一个都读不出来回 502。建议去掉头尾空白、去重。
 */
export const searchSuggestionsResult = async (
  rawKeyword: unknown,
  options: SessionMusicuOptions = {},
): Promise<NewRouteResult> => {
  try {
    const keyword = keywordOf(rawKeyword);
    const data = await anonymous(options).execute(searchSuggestions(keyword));
    const candidates = listOf(data.items).filter(
      (entry) => dictionaryOf(entry).type === SUGGESTION_TYPE,
    );
    if (!candidates.length) throw new QqApiError('not-found');
    const suggestions = [
      ...new Set(
        candidates
          .map((entry) => textOf(dictionaryOf(entry).hint)?.trim())
          .filter((hint): hint is string => hint !== undefined),
      ),
    ];
    if (!suggestions.length) throw new QqApiError('invalid-response');
    return okResult({ keyword, suggestions });
  } catch (error) {
    return failureResult('get-search-suggestions', error);
  }
};
