import { songVersionsResult } from '../../services/song/versions';
import type { OperationHandler } from './types';

export const songVersions: OperationHandler = (request) =>
  songVersionsResult({ id: request.query('id'), mid: request.query('mid') });
