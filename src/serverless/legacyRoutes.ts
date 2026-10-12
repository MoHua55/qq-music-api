import getAlbumInfoService from '../services/album/getAlbumInfo';
import u_common from '../services/u_common';
import { json } from './response';

// src/serverless/legacyRoutes.ts
//
// 正在换成共用实现的 serverless 旧路由，原样搬到这里。换过去之前入口照常用它们；换过去之后留着
// 给新旧比对测试当基准，等所有路由都换完、测试全过，再和 Node 的旧 controller 一起删掉。
// 这里的代码只搬不改：要改行为就改新的共用实现。

interface LegacyRouteContext {
  url: URL;
  params: Record<string, string>;
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

  '/getSongInfo/:songmid/:songid?': async ({ url, params }) => {
    const song_mid = params.songmid ?? url.searchParams.get('songmid') ?? undefined;
    const song_id = params.songid ?? url.searchParams.get('songid') ?? '';
    const response = await u_common({
      method: 'get',
      options: {
        params: {
          format: 'json',
          data: JSON.stringify({
            comm: { ct: 24, cv: 0 },
            songinfo: {
              method: 'get_song_detail_yqq',
              param: { song_type: 0, song_mid, song_id },
              module: 'music.pf_song_detail_svr',
            },
          }),
        },
      },
    });
    return json({ response: response.data });
  },

  '/getSingerAlbum': async ({ url }) => {
    const singermid = url.searchParams.get('singermid');
    if (!singermid) return json({ data: { message: 'no singermid' } }, 400);
    const num = +(url.searchParams.get('limit') || 5);
    const begin = +(url.searchParams.get('page') || 0);
    const response = await u_common({
      method: 'get',
      options: {
        params: {
          format: 'json',
          singermid,
          data: JSON.stringify({
            comm: { ct: 24, cv: 0 },
            singer: {
              method: 'GetAlbumList',
              param: { sort: 5, singermid, begin, num },
              module: 'music.musichallAlbum.AlbumListServer',
            },
          }),
        },
      },
    });
    return json({ response: response.data });
  },

  '/getSingerHotsong': async ({ url }) => {
    const singermid = url.searchParams.get('singermid');
    if (!singermid) return json({ data: { message: 'no singermid' } }, 400);
    const num = +(url.searchParams.get('limit') || 5);
    const page = +(url.searchParams.get('page') || 0);
    const response = await u_common({
      method: 'get',
      options: {
        params: {
          format: 'json',
          singermid,
          data: JSON.stringify({
            comm: { ct: 24, cv: 0 },
            singer: {
              method: 'get_singer_detail_info',
              param: { sort: 5, singermid, sin: (page - 1) * num, num },
              module: 'music.web_singer_info_svr',
            },
          }),
        },
      },
    });
    return json({ response: response.data });
  },
} satisfies Record<string, LegacyRouteHandler>;
