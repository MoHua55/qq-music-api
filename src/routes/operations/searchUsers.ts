import { searchUsersResult } from '../../services/search/users';
import { requiredSession } from './requestValues';
import type { OperationHandler } from './types';

export const searchUsers: OperationHandler = async (request) =>
  searchUsersResult(
    {
      keyword: request.query('keyword'),
      page: request.query('page'),
      limit: request.query('limit'),
    },
    await requiredSession(request),
  );
