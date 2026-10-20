import type { Context, Next } from 'koa';
import { type NodeOnlyRouteName, type RouteName, routeManifest } from '../routes/manifest';
import { withControllerLogging } from '../util/observability';
import batchGetSongInfo from './batchGetSongInfo';
import batchGetSongLists from './batchGetSongLists';
import cookies from './cookies';
import getComments from './getComments';
import getDigitalAlbumLists from './getDigitalAlbumLists';
import getDownloadQQMusic from './getDownloadQQMusic';
import getImageUrl from './getImageUrl';
import getNewDisks from './getNewDisks';
import getRadioLists from './getRadioLists';
import getRanks from './getRanks';
import getRecommend from './getRecommend';
import getSmartbox from './getSmartbox';
import getSongListCategories from './getSongListCategories';
import getSongLists from './getSongLists';
import getTicketInfo from './getTicketInfo';
import getTopLists from './getTopLists';
import logoutOperationController from './logoutOperation';
import musicPlayOperationController from './musicPlayOperation';
import { operationController } from './operation';
import qrCheckOperationController from './qrCheckOperation';

type Controller = (ctx: Context, next: Next) => Promise<unknown> | unknown;

const { get: getCookie, set: setCookie } = cookies;

/** 只有 Node 有的旧路由，一条对应一个旧 controller。 */
const nodeOnlyControllers: Record<NodeOnlyRouteName, Controller> = {
  getCookie,
  setCookie,
  getDownloadQQMusic,
  getSmartbox,
  getSongListCategories,
  getSongLists,
  batchGetSongLists,
  batchGetSongInfo,
  getNewDisks,
  getRadioLists,
  getDigitalAlbumLists,
  getComments,
  getRecommend,
  getTopLists,
  getRanks,
  getTicketInfo,
  getImageUrl,
};

/**
 * 共用路由在 Node 上另有转接的：要用 Koa 的 Cookie 等 API 的三条，以及 Node 上仍走原来
 * controller 的 /getLyric。其余的都直接用 `operationController(handler)`。
 */
const nodeAdapters: Partial<Record<RouteName, Controller>> = {
  qrCheck: qrCheckOperationController,
  logout: logoutOperationController,
  getMusicPlay: musicPlayOperationController,
};

const controllerOf = (route: (typeof routeManifest)[number]): Controller =>
  'nodeOnly' in route
    ? nodeOnlyControllers[route.name]
    : (nodeAdapters[route.name] ?? operationController(route.handler));

export default Object.fromEntries(
  routeManifest.map((route) => [
    route.name,
    withControllerLogging(route.name, controllerOf(route)),
  ]),
) as Record<RouteName, ReturnType<typeof withControllerLogging>>;
