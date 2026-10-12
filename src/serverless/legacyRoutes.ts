import getAlbumInfoService from '../services/album/getAlbumInfo';
import { json } from './response';

// src/serverless/legacyRoutes.ts
//
// 正在换成共用实现的 serverless 旧路由，原样搬到这里。换过去之前入口照常用它们；换过去之后留着
// 给新旧比对测试当基准，等所有路由都换完、测试全过，再和 Node 的旧 controller 一起删掉。
// 这里的代码只搬不改：要改行为就改新的共用实现。

interface LegacyRouteContext {
  url: URL;
}

type LegacyRouteHandler = (context: LegacyRouteContext) => Promise<Response>;

export const legacyRoutes = {
  '/getAlbumInfo': async ({ url }) => {
    const albummid = url.searchParams.get('albummid');
    if (!albummid) return json({ data: { message: 'no albummid' } }, 400);
    const { status, body } = await getAlbumInfoService({
      method: 'get',
      params: { albummid },
      options: {},
    });
    return json(body, status);
  },
} satisfies Record<string, LegacyRouteHandler>;
