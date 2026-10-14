import { songLikeResult } from '../../services/user/songLike';
import { unverifiedWrite } from './unverifiedWrite';

export const songLike = unverifiedWrite(songLikeResult);
