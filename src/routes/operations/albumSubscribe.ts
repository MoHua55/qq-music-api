import { albumSubscribeResult } from '../../services/user/albumSubscribe';
import { unverifiedWrite } from './unverifiedWrite';

export const albumSubscribe = unverifiedWrite(albumSubscribeResult);
