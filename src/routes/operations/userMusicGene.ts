import { userMusicGeneResult } from '../../services/user/musicGene';
import { requiredSession } from './requestValues';
import type { OperationHandler } from './types';

export const userMusicGene: OperationHandler = async (request) =>
  userMusicGeneResult(await requiredSession(request));
