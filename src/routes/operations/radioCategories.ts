import { radioCategoriesResult } from '../../services/radio/categories';
import { anonymousGet } from './anonymousGet';

export const radioCategories = anonymousGet(() => radioCategoriesResult());
