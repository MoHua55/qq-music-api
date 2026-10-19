import { searchMatchResult } from '../../services/search/match';
import { anonymousGet } from './anonymousGet';

export const searchMatch = anonymousGet((request) => searchMatchResult(request.query('keyword')));
