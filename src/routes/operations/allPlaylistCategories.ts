import { allCategoriesResult } from '../../services/recommend/allCategories';
import { anonymousGet } from './anonymousGet';

export const allPlaylistCategories = anonymousGet(() => allCategoriesResult());
