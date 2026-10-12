import getAlbumInfoService from '../../services/album/getAlbumInfo';
import type { OperationHandler } from './types';

// src/routes/operations/getAlbumInfo.ts
//
// 专辑信息。上游有应答就照原样包在 `response` 里回 200，业务码不是 0 也一样（Folia 自己看
// `response.code`）；上游连不上才是旧路由的安全 500。
//
// albummid 读 `queryRaw`，保留两边原来的取法：Node 遇到重复的参数会把整个数组交给上游，
// serverless 只取第一个。要统一就是行为改变，不在这里做。

export const getAlbumInfo: OperationHandler = async ({ queryRaw }) => {
  const albummid = queryRaw('albummid');
  if (!albummid) return { status: 400, headers: {}, body: { data: { message: 'no albummid' } } };
  const { status, body } = await getAlbumInfoService({
    method: 'get',
    params: { albummid },
    options: {},
  });
  return { status, headers: {}, body };
};
