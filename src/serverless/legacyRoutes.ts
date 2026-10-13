import getAlbumInfoService from '../services/album/getAlbumInfo';
import type { QrLoginService } from '../services/auth/qrLogin';
import songListDetailService from '../services/songLists/songListDetail';
import u_common from '../services/u_common';
import { toUserPlaylistBody, userPlaylistOptionsOf } from '../services/user/userPlaylistResponse';
import { AUTH_COOKIE_NAME, json, LOGIN_REQUIRED } from './response';

// src/serverless/legacyRoutes.ts
//
// 正在换成共用实现的 serverless 旧路由，原样搬到这里。换过去之前入口照常用它们；换过去之后留着
// 给新旧比对测试当基准，等所有路由都换完、测试全过，再和 Node 的旧 controller 一起删掉。
// 这里的代码只搬不改：要改行为就改新的共用实现。

interface LegacyRouteContext {
  env?: { QQ_SESSION_SECRET?: string };
  url: URL;
  params: Record<string, string>;
  token: string | undefined;
  service: () => Promise<QrLoginService>;
}

type LegacyRouteHandler = (context: LegacyRouteContext) => Promise<Response>;

export const legacyRoutes = {
  '/getSongListDetail/:disstid': async ({ url, params, service: getService, token, env = {} }) => {
    const disstid = params.disstid ?? url.searchParams.get('disstid') ?? undefined;
    const { status, body } = await songListDetailService({
      method: 'get',
      params: { disstid },
      option: {},
      ...(token && env.QQ_SESSION_SECRET
        ? {
            readWithCredential: async (id: string) =>
              (await getService()).getAuthenticatedSongListDetail(token, id),
          }
        : {}),
    });
    return json(body, status);
  },

  '/getMusicPlay/:songmid?': async ({ url, params, service: getService, token }) => {
    const songmid = (params.songmid ?? url.searchParams.get('songmid') ?? '').trim();
    if (!songmid) return json({ data: { message: 'no songmid' } }, 400);
    // Only the authenticated branch is served here. The Node controller also has an anonymous
    // fallback that builds a guessed URL from `config.user`, which a serverless deployment has
    // no configuration file for; without a session there is nothing honest to answer.
    if (!token) return json(LOGIN_REQUIRED, 401);
    const playUrl = await (await getService()).getMusicPlay(
      token,
      songmid,
      url.searchParams.get('quality') ?? '128',
      url.searchParams.get('mediaId') ?? undefined,
    );
    return playUrl ? json({ data: { playUrl } }) : json(LOGIN_REQUIRED, 401);
  },

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
  '/login/status': async ({ service: getService, token }) => {
    // §5.3 #3: never 401 here. Folia decides by whether `data.profile` exists.
    const profile = await (await getService()).getLoginStatus(token);
    return json({ code: 200, data: profile ? { profile } : {} });
  },

  '/logout': async ({ service: getService, token }) => {
    // 🔴 Under `sealed` this cannot delete anything: the session lives in the token the client
    // holds. `revoke()` is a documented no-op and logout means the client discarding it. The
    // expired cookie below is what actually ends the session for a same-origin caller.
    await (await getService()).logout(token);
    return json({ code: 200 }, 200, { 'set-cookie': `${AUTH_COOKIE_NAME}=; Max-Age=0; Path=/` });
  },

  '/user/detail': async ({ service: getService, token }) => {
    const profile = await (await getService()).getUserDetail(token);
    return profile ? json({ code: 200, profile }) : json(LOGIN_REQUIRED, 401);
  },

  '/user/playlist': async ({ url, service: getService, token }) => {
    const data = await (await getService()).getUserPlaylists(
      token,
      url.searchParams.get('uid') ?? undefined,
      userPlaylistOptionsOf(url.searchParams.get('favoriteOffset')),
    );
    if (!data) return json(LOGIN_REQUIRED, 401);
    return json(toUserPlaylistBody(data));
  },

  '/user/albums': async ({ url, service: getService, token }) => {
    const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset') ?? '0', 10) || 0);
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '20', 10) || 20),
    );
    const data = await (await getService()).getUserAlbums(token, offset, limit);
    if (!data) return json(LOGIN_REQUIRED, 401);
    const albums = Array.isArray(data.albumlist) ? data.albumlist : [];
    const total = typeof data.totalalbum === 'number' ? data.totalalbum : albums.length;
    return json({
      code: 200,
      albums,
      total,
      more: Number(data.has_more) === 1 || offset + albums.length < total,
    });
  },

  '/user/liked-songs': async ({ url, service: getService, token }) => {
    const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset') ?? '0', 10) || 0);
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '100', 10) || 100),
    );
    const data = await (await getService()).getUserLikedSongs(token, offset, limit);
    if (!data) return json(LOGIN_REQUIRED, 401);
    const songs = Array.isArray(data.songlist) ? data.songlist : [];
    const total = typeof data.total_song_num === 'number' ? data.total_song_num : songs.length;
    return json({
      code: 200,
      songs,
      total,
      more: data.hasmore === true || Number(data.hasmore) === 1 || offset + songs.length < total,
    });
  },

  '/user/playlist-detail': async ({ url, service: getService, token }) => {
    const idOf = (name: string): number => {
      const value = url.searchParams.get(name) ?? '';
      return /^\d+$/.test(value) ? Number(value) : 0;
    };
    const disstid = idOf('tid');
    const dirid = idOf('dirid');
    if (!disstid && !dirid) return json({ code: 400, message: 'tid or dirid is required' }, 400);
    const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset') ?? '0', 10) || 0);
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '100', 10) || 100),
    );
    const data = await (await getService()).getOwnedPlaylistSongs(token, {
      disstid,
      dirid,
      offset,
      limit,
    });
    if (!data) return json(LOGIN_REQUIRED, 401);
    const songs = Array.isArray(data.songlist) ? data.songlist : [];
    const total = typeof data.total_song_num === 'number' ? data.total_song_num : songs.length;
    return json({
      code: 200,
      songs,
      total,
      more: data.hasmore === true || Number(data.hasmore) === 1 || offset + songs.length < total,
    });
  },
} satisfies Record<string, LegacyRouteHandler>;
