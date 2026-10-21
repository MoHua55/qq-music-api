import { songFavCountResult } from '../../services/song/favCount';
import type { OperationHandler } from './types';

export const songFavCount: OperationHandler = (request) => songFavCountResult(request.query('ids'));
