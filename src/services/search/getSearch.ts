import qrLoginService from '../auth/qrLogin.node';
import { searchResult } from './search';

// Node 版：会话解不开就是 null；歌曲会回 401，其他类型照样匿名搜。业务实现与 serverless 共用。
export default async ({
  token,
  ...query
}: {
  token?: string;
  keyword?: string;
  type?: string;
  page?: string;
  limit?: string;
}) => searchResult(query, await qrLoginService.resolveSession(token));
