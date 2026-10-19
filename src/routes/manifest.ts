import { albumSubscribe } from './operations/albumSubscribe';
import { getAlbumInfo } from './operations/getAlbumInfo';
import { getLyricOperation } from './operations/getLyric';
import { getMusicPlay } from './operations/getMusicPlay';
import { getOwnedPlaylistSongs } from './operations/getOwnedPlaylistSongs';
import { getSingerAlbum } from './operations/getSingerAlbum';
import { getSingerHotsong } from './operations/getSingerHotsong';
import { getSongInfo } from './operations/getSongInfo';
import { getSongListDetail } from './operations/getSongListDetail';
import { getUserAlbums } from './operations/getUserAlbums';
import { getUserLikedSongs } from './operations/getUserLikedSongs';
import { getUserPlaylist } from './operations/getUserPlaylist';
import { loginChannels } from './operations/loginChannels';
import { loginRefresh } from './operations/loginRefresh';
import { loginStatus } from './operations/loginStatus';
import { logout } from './operations/logout';
import {
  getCommentCount,
  getHotComments,
  getMvDetail,
  getMvList,
  getMvUrl,
  getNewComments,
  getSimilarSingers,
  getSingerDetail,
  getSingerHomepage,
  getSingerMvs,
  getSingerSongs,
  getSongLabels,
  getSongMvs,
  listSingers,
} from './operations/mediaCatalog';
import { playlistCreate, playlistDelete, playlistRename } from './operations/playlistManagement';
import { playlistTracks } from './operations/playlistTracks';
import { qrCancel } from './operations/qrCancel';
import { qrCheck } from './operations/qrCheck';
import { qrCreate } from './operations/qrCreate';
import { qrKey } from './operations/qrKey';
import {
  getGuessYouLike,
  getRadioList,
  getRadioTracks,
  getRecommendPlaylists,
  getRecommendRadar,
  getRelatedPlaylists,
  getSimilarSongs,
} from './operations/recommendations';
import {
  getCategoryPlaylists,
  getNewAlbums,
  getNewSongs,
  getPlaylistCategories,
  getRecommendToplistSongs,
  getRecommendToplists,
} from './operations/recommendCatalog';
import { getHotSearches, getSearch, getSearchSuggestions } from './operations/searchCatalog';
import { songLike } from './operations/songLike';
import { playlistSubscribe, subscriptionStatus } from './operations/subscriptions';
import type { OperationHandler } from './operations/types';
import { userCloud } from './operations/userCloud';
import { userDailySongs } from './operations/userDailySongs';
import { userDetail } from './operations/userDetail';
import { userVip } from './operations/userVip';

// src/routes/manifest.ts
//
// 全部路由的清单，一条路由一行。Koa 的路由表、controllers 的导出、Serverless 的路由表和
// 要密钥的路由、API Explorer 的路由列表都从这里生成，加一条路由只改这里和 handler。
// 顺序就是 Explorer 里的顺序。Serverless 也会打包这个文件，所以只能引入 operations 下的
// handler，不能引入 Koa、axios、`node:*` 或 `qrLogin.node`。

export type RouteMethod = 'GET' | 'POST';

interface RouteBase {
  /** controllers 的导出名，也是 Explorer 里显示的名字。 */
  name: string;
  method: RouteMethod;
  /** Koa 的路径写法。 */
  path: string;
  /** Explorer 里的分类。 */
  category: string;
}

/** 两边都有的路由，业务写在共用 handler 里。 */
export interface SharedRoute extends RouteBase {
  handler: OperationHandler;
  /** Serverless 路由表里的写法；和 Koa 一样时不写。两边原有的样式不同就照旧各写一份。 */
  serverlessPath?: string;
  /** Serverless 没设 `QQ_SESSION_SECRET` 时直接回 501。 */
  needsSecret?: true;
}

/** 只有 Node 有的旧路由，Serverless 回 501。controller 在 controllers/index.ts，退役时两边一起删。 */
export interface NodeOnlyRoute extends RouteBase {
  nodeOnly: true;
}

export const routeManifest = [
  { name: 'getCookie', method: 'GET', path: '/user/getCookie', category: 'User', nodeOnly: true },
  { name: 'setCookie', method: 'GET', path: '/user/setCookie', category: 'User', nodeOnly: true },

  // 扫码登录与会话
  {
    name: 'qrKey',
    method: 'GET',
    path: '/login/qr/key',
    category: 'Login',
    handler: qrKey,
    needsSecret: true,
  },
  {
    name: 'qrCreate',
    method: 'GET',
    path: '/login/qr/create',
    category: 'Login',
    handler: qrCreate,
    needsSecret: true,
  },
  {
    name: 'qrCheck',
    method: 'GET',
    path: '/login/qr/check',
    category: 'Login',
    handler: qrCheck,
    needsSecret: true,
  },
  {
    name: 'qrCancel',
    method: 'GET',
    path: '/login/qr/cancel',
    category: 'Login',
    handler: qrCancel,
    needsSecret: true,
  },
  {
    name: 'loginStatus',
    method: 'GET',
    path: '/login/status',
    category: 'Login',
    handler: loginStatus,
    needsSecret: true,
  },
  {
    name: 'loginChannels',
    method: 'GET',
    path: '/login/channels',
    category: 'Login',
    handler: loginChannels,
  },
  {
    name: 'logout',
    method: 'GET',
    path: '/logout',
    category: 'Login',
    handler: logout,
    needsSecret: true,
  },
  {
    name: 'loginRefresh',
    method: 'POST',
    path: '/login/refresh',
    category: 'Login',
    handler: loginRefresh,
    needsSecret: true,
  },

  // 用户资料与写入，都要登录
  {
    name: 'userDetail',
    method: 'GET',
    path: '/user/detail',
    category: 'User',
    handler: userDetail,
    needsSecret: true,
  },
  {
    name: 'userVip',
    method: 'GET',
    path: '/user/vip',
    category: 'User',
    handler: userVip,
    needsSecret: true,
  },
  {
    name: 'songLike',
    method: 'POST',
    path: '/user/song/like',
    category: 'User',
    handler: songLike,
    needsSecret: true,
  },
  {
    name: 'albumSubscribe',
    method: 'POST',
    path: '/user/album/subscribe',
    category: 'User',
    handler: albumSubscribe,
    needsSecret: true,
  },
  {
    name: 'playlistTracks',
    method: 'POST',
    path: '/user/playlist/tracks',
    category: 'User',
    handler: playlistTracks,
    needsSecret: true,
  },
  {
    name: 'playlistCreate',
    method: 'POST',
    path: '/user/playlist/create',
    category: 'User',
    handler: playlistCreate,
    needsSecret: true,
  },
  {
    name: 'playlistRename',
    method: 'POST',
    path: '/user/playlist/rename',
    category: 'User',
    handler: playlistRename,
    needsSecret: true,
  },
  {
    name: 'playlistDelete',
    method: 'POST',
    path: '/user/playlist/delete',
    category: 'User',
    handler: playlistDelete,
    needsSecret: true,
  },
  {
    name: 'playlistSubscribe',
    method: 'POST',
    path: '/user/playlist/subscribe',
    category: 'User',
    handler: playlistSubscribe,
    needsSecret: true,
  },
  {
    name: 'subscriptionStatus',
    method: 'GET',
    path: '/user/subscription-status',
    category: 'User',
    handler: subscriptionStatus,
    needsSecret: true,
  },
  {
    name: 'getUserPlaylist',
    method: 'GET',
    path: '/user/playlist',
    category: 'User',
    handler: getUserPlaylist,
    needsSecret: true,
  },
  {
    name: 'getUserAlbums',
    method: 'GET',
    path: '/user/albums',
    category: 'User',
    handler: getUserAlbums,
    needsSecret: true,
  },
  {
    name: 'getUserLikedSongs',
    method: 'GET',
    path: '/user/liked-songs',
    category: 'User',
    handler: getUserLikedSongs,
    needsSecret: true,
  },
  // 用户自己的歌单，带凭证读。匿名的 /getSongListDetail 读不公开歌单只会拿到空壳。
  {
    name: 'getOwnedPlaylistSongs',
    method: 'GET',
    path: '/user/playlist-detail',
    category: 'User',
    handler: getOwnedPlaylistSongs,
    needsSecret: true,
  },
  {
    name: 'getGuessYouLike',
    method: 'GET',
    path: '/user/guess-you-like',
    category: 'User',
    handler: getGuessYouLike,
    needsSecret: true,
  },
  {
    name: 'userDailySongs',
    method: 'GET',
    path: '/user/daily-songs',
    category: 'User',
    handler: userDailySongs,
    needsSecret: true,
  },
  {
    name: 'userCloud',
    method: 'GET',
    path: '/user/cloud',
    category: 'User',
    handler: userCloud,
    needsSecret: true,
  },

  // 推荐与电台；有会话就带上
  {
    name: 'getRecommendPlaylists',
    method: 'GET',
    path: '/recommend/playlists',
    category: 'Recommend',
    handler: getRecommendPlaylists,
  },
  {
    name: 'getPlaylistCategories',
    method: 'GET',
    path: '/recommend/categories',
    category: 'Recommend',
    handler: getPlaylistCategories,
  },
  {
    name: 'getCategoryPlaylists',
    method: 'GET',
    path: '/recommend/category-playlists',
    category: 'Recommend',
    handler: getCategoryPlaylists,
  },
  {
    name: 'getNewSongs',
    method: 'GET',
    path: '/recommend/new-songs',
    category: 'Recommend',
    handler: getNewSongs,
  },
  {
    name: 'getSimilarSongs',
    method: 'GET',
    path: '/song/similar',
    category: 'Song',
    handler: getSimilarSongs,
    needsSecret: true,
  },
  {
    name: 'getRelatedPlaylists',
    method: 'GET',
    path: '/song/related-playlists',
    category: 'Song',
    handler: getRelatedPlaylists,
    needsSecret: true,
  },
  {
    name: 'getRecommendRadar',
    method: 'GET',
    path: '/recommend/radar',
    category: 'Recommend',
    handler: getRecommendRadar,
  },
  {
    name: 'getNewAlbums',
    method: 'GET',
    path: '/recommend/new-albums',
    category: 'Recommend',
    handler: getNewAlbums,
  },
  {
    name: 'getRecommendToplists',
    method: 'GET',
    path: '/recommend/toplists',
    category: 'Recommend',
    handler: getRecommendToplists,
  },
  {
    name: 'getRecommendToplistSongs',
    method: 'GET',
    path: '/recommend/toplist',
    category: 'Recommend',
    handler: getRecommendToplistSongs,
  },
  {
    name: 'getRadioList',
    method: 'GET',
    path: '/radio/list',
    category: 'Recommend',
    handler: getRadioList,
    needsSecret: true,
  },
  {
    name: 'getRadioTracks',
    method: 'GET',
    path: '/radio/tracks',
    category: 'Recommend',
    handler: getRadioTracks,
    needsSecret: true,
  },
  {
    name: 'getDownloadQQMusic',
    method: 'GET',
    path: '/downloadQQMusic',
    category: 'Song',
    nodeOnly: true,
  },

  // 搜索
  {
    name: 'getSmartbox',
    method: 'GET',
    path: '/getSmartbox/:key?',
    category: 'Search',
    nodeOnly: true,
  },
  { name: 'getSearch', method: 'GET', path: '/search', category: 'Search', handler: getSearch },
  {
    name: 'getHotSearches',
    method: 'GET',
    path: '/search/hot',
    category: 'Search',
    handler: getHotSearches,
  },
  {
    name: 'getSearchSuggestions',
    method: 'GET',
    path: '/search/suggest',
    category: 'Search',
    handler: getSearchSuggestions,
  },

  // 曲库
  {
    name: 'getSongListCategories',
    method: 'GET',
    path: '/getSongListCategories',
    category: 'Song Lists',
    nodeOnly: true,
  },
  {
    name: 'getSongLists',
    method: 'GET',
    path: '/getSongLists/:page?/:limit?/:categoryId?/:sortId?',
    category: 'Song Lists',
    nodeOnly: true,
  },
  {
    name: 'batchGetSongLists',
    method: 'POST',
    path: '/batchGetSongLists',
    category: 'Batch',
    nodeOnly: true,
  },
  {
    name: 'getSongInfo',
    method: 'GET',
    path: '/getSongInfo/:songmid?/:songid?',
    serverlessPath: '/getSongInfo/:songmid/:songid?',
    category: 'Song',
    handler: getSongInfo,
  },
  {
    name: 'batchGetSongInfo',
    method: 'POST',
    path: '/batchGetSongInfo',
    category: 'Batch',
    nodeOnly: true,
  },
  // 默认匿名读，没设密钥也能用。匿名读不到（QQ 自己的算法歌单回 code 10）且能开会话时才带凭证重读。
  {
    name: 'getSongListDetail',
    method: 'GET',
    path: '/getSongListDetail/:disstid?',
    serverlessPath: '/getSongListDetail/:disstid',
    category: 'Song Lists',
    handler: getSongListDetail,
  },
  {
    name: 'getNewDisks',
    method: 'GET',
    path: '/getNewDisks/:page?/:limit?',
    category: 'Album',
    nodeOnly: true,
  },
  {
    name: 'listSingers',
    method: 'GET',
    path: '/singer/list',
    category: 'Singer',
    handler: listSingers,
  },
  {
    name: 'getSingerDetail',
    method: 'GET',
    path: '/singer/detail',
    category: 'Singer',
    handler: getSingerDetail,
  },
  {
    name: 'getSingerHomepage',
    method: 'GET',
    path: '/singer/homepage',
    category: 'Singer',
    handler: getSingerHomepage,
  },
  {
    name: 'getSimilarSingers',
    method: 'GET',
    path: '/singer/similar',
    category: 'Singer',
    handler: getSimilarSingers,
  },
  {
    name: 'getSingerSongs',
    method: 'GET',
    path: '/singer/songs',
    category: 'Singer',
    handler: getSingerSongs,
  },
  {
    name: 'getSingerMvs',
    method: 'GET',
    path: '/singer/mvs',
    category: 'Singer',
    handler: getSingerMvs,
  },
  {
    name: 'getHotComments',
    method: 'GET',
    path: '/comment/hot',
    category: 'Common',
    handler: getHotComments,
  },
  {
    name: 'getNewComments',
    method: 'GET',
    path: '/comment/new',
    category: 'Common',
    handler: getNewComments,
  },
  {
    name: 'getCommentCount',
    method: 'GET',
    path: '/comment/count',
    category: 'Common',
    handler: getCommentCount,
  },
  { name: 'getMvList', method: 'GET', path: '/mv/list', category: 'MV', handler: getMvList },
  { name: 'getMvDetail', method: 'GET', path: '/mv/detail', category: 'MV', handler: getMvDetail },
  { name: 'getMvUrl', method: 'GET', path: '/mv/url', category: 'MV', handler: getMvUrl },
  { name: 'getSongMvs', method: 'GET', path: '/song/mvs', category: 'MV', handler: getSongMvs },
  {
    name: 'getSongLabels',
    method: 'GET',
    path: '/song/labels',
    category: 'Song',
    handler: getSongLabels,
  },
  {
    name: 'getSingerAlbum',
    method: 'GET',
    path: '/getSingerAlbum/:singermid?/:limit?/:page?',
    serverlessPath: '/getSingerAlbum',
    category: 'Singer',
    handler: getSingerAlbum,
  },
  {
    name: 'getSingerHotsong',
    method: 'GET',
    path: '/getSingerHotsong/:singermid?/:limit?/:page?',
    serverlessPath: '/getSingerHotsong',
    category: 'Singer',
    handler: getSingerHotsong,
  },
  {
    name: 'getRadioLists',
    method: 'GET',
    path: '/getRadioLists',
    category: 'Radio',
    nodeOnly: true,
  },
  {
    name: 'getDigitalAlbumLists',
    method: 'GET',
    path: '/getDigitalAlbumLists',
    category: 'Digital Album',
    nodeOnly: true,
  },
  {
    name: 'getLyric',
    method: 'GET',
    path: '/getLyric/:songmid?/:isFormat?',
    serverlessPath: '/getLyric',
    category: 'Song',
    handler: getLyricOperation,
  },
  {
    name: 'getMusicPlay',
    method: 'GET',
    path: '/getMusicPlay/:songmid?',
    category: 'Song',
    handler: getMusicPlay,
    needsSecret: true,
  },
  {
    name: 'getAlbumInfo',
    method: 'GET',
    path: '/getAlbumInfo/:albummid?',
    serverlessPath: '/getAlbumInfo',
    category: 'Album',
    handler: getAlbumInfo,
  },
  {
    name: 'getComments',
    method: 'GET',
    path: '/getComments/:id?/:rootcommentid?/:cid?/:pagesize?/:pagenum?/:cmd?/:reqtype?/:biztype?',
    category: 'Common',
    nodeOnly: true,
  },
  {
    name: 'getRecommend',
    method: 'GET',
    path: '/getRecommend',
    category: 'Recommend',
    nodeOnly: true,
  },
  { name: 'getTopLists', method: 'GET', path: '/getTopLists', category: 'Rank', nodeOnly: true },
  {
    name: 'getRanks',
    method: 'GET',
    path: '/getRanks/:topId?/:limit?/:page?',
    category: 'Rank',
    nodeOnly: true,
  },
  {
    name: 'getTicketInfo',
    method: 'GET',
    path: '/getTicketInfo',
    category: 'Ticket',
    nodeOnly: true,
  },
  { name: 'getImageUrl', method: 'GET', path: '/getImageUrl', category: 'Common', nodeOnly: true },
] as const satisfies readonly (SharedRoute | NodeOnlyRoute)[];

export type RouteEntry = (typeof routeManifest)[number];
export type RouteName = RouteEntry['name'];
export type NodeOnlyRouteName = Extract<RouteEntry, { nodeOnly: true }>['name'];

const isNodeOnly = (route: SharedRoute | NodeOnlyRoute): route is NodeOnlyRoute =>
  'nodeOnly' in route;

/** 两边都有的路由。 */
export const sharedRoutes: readonly SharedRoute[] = routeManifest.filter(
  (route): route is Extract<RouteEntry, SharedRoute> => !isNodeOnly(route),
);

/** Serverless 路由表里的写法。 */
export const serverlessPathOf = (route: SharedRoute): string => route.serverlessPath ?? route.path;
