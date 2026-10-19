import { albumSubscribe } from '../routes/operations/albumSubscribe';
import { getAlbumInfo } from '../routes/operations/getAlbumInfo';
import { getOwnedPlaylistSongs } from '../routes/operations/getOwnedPlaylistSongs';
import { getSingerAlbum } from '../routes/operations/getSingerAlbum';
import { getSingerHotsong } from '../routes/operations/getSingerHotsong';
import { getSongInfo } from '../routes/operations/getSongInfo';
import { getSongListDetail } from '../routes/operations/getSongListDetail';
import { getUserAlbums } from '../routes/operations/getUserAlbums';
import { getUserLikedSongs } from '../routes/operations/getUserLikedSongs';
import { getUserPlaylist } from '../routes/operations/getUserPlaylist';
import { loginChannels } from '../routes/operations/loginChannels';
import { loginRefresh } from '../routes/operations/loginRefresh';
import { loginStatus } from '../routes/operations/loginStatus';
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
} from '../routes/operations/mediaCatalog';
import {
  playlistCreate,
  playlistDelete,
  playlistRename,
} from '../routes/operations/playlistManagement';
import { playlistTracks } from '../routes/operations/playlistTracks';
import { qrCancel } from '../routes/operations/qrCancel';
import { qrCreate } from '../routes/operations/qrCreate';
import { qrKey } from '../routes/operations/qrKey';
import {
  getGuessYouLike,
  getRadioList,
  getRadioTracks,
  getRecommendPlaylists,
  getRecommendRadar,
  getRelatedPlaylists,
  getSimilarSongs,
} from '../routes/operations/recommendations';
import {
  getCategoryPlaylists,
  getNewAlbums,
  getNewSongs,
  getPlaylistCategories,
  getRecommendToplistSongs,
  getRecommendToplists,
} from '../routes/operations/recommendCatalog';
import {
  getHotSearches,
  getSearch,
  getSearchSuggestions,
} from '../routes/operations/searchCatalog';
import { songLike } from '../routes/operations/songLike';
import { playlistSubscribe, subscriptionStatus } from '../routes/operations/subscriptions';
import { userCloud } from '../routes/operations/userCloud';
import { userDailySongs } from '../routes/operations/userDailySongs';
import { userDetail } from '../routes/operations/userDetail';
import { userVip } from '../routes/operations/userVip';
import { withControllerLogging } from '../util/observability';
import batchGetSongInfo from './batchGetSongInfo';
import batchGetSongLists from './batchGetSongLists';
import cookies from './cookies';
import getComments from './getComments';
import getDigitalAlbumLists from './getDigitalAlbumLists';
import getDownloadQQMusic from './getDownloadQQMusic';
import getImageUrl from './getImageUrl';
import getLyric from './getLyric';
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

const { get: getCookie, set: setCookie } = cookies;

export default {
  getCookie: withControllerLogging('getCookie', getCookie),
  setCookie: withControllerLogging('setCookie', setCookie),
  getDownloadQQMusic: withControllerLogging('getDownloadQQMusic', getDownloadQQMusic),
  userVip: withControllerLogging('userVip', operationController(userVip)),
  loginRefresh: withControllerLogging('loginRefresh', operationController(loginRefresh)),
  songLike: withControllerLogging('songLike', operationController(songLike)),
  albumSubscribe: withControllerLogging('albumSubscribe', operationController(albumSubscribe)),
  userDailySongs: withControllerLogging('userDailySongs', operationController(userDailySongs)),
  userCloud: withControllerLogging('userCloud', operationController(userCloud)),
  playlistTracks: withControllerLogging('playlistTracks', operationController(playlistTracks)),
  playlistCreate: withControllerLogging('playlistCreate', operationController(playlistCreate)),
  playlistRename: withControllerLogging('playlistRename', operationController(playlistRename)),
  playlistDelete: withControllerLogging('playlistDelete', operationController(playlistDelete)),
  playlistSubscribe: withControllerLogging(
    'playlistSubscribe',
    operationController(playlistSubscribe),
  ),
  subscriptionStatus: withControllerLogging(
    'subscriptionStatus',
    operationController(subscriptionStatus),
  ),
  getSmartbox: withControllerLogging('getSmartbox', getSmartbox),
  getSongListCategories: withControllerLogging('getSongListCategories', getSongListCategories),
  getSongLists: withControllerLogging('getSongLists', getSongLists),
  batchGetSongLists: withControllerLogging('batchGetSongLists', batchGetSongLists),
  getSongInfo: withControllerLogging('getSongInfo', operationController(getSongInfo)),
  batchGetSongInfo: withControllerLogging('batchGetSongInfo', batchGetSongInfo),
  getSongListDetail: withControllerLogging(
    'getSongListDetail',
    operationController(getSongListDetail),
  ),
  getNewDisks: withControllerLogging('getNewDisks', getNewDisks),
  getSingerAlbum: withControllerLogging('getSingerAlbum', operationController(getSingerAlbum)),
  getSingerHotsong: withControllerLogging(
    'getSingerHotsong',
    operationController(getSingerHotsong),
  ),
  getRadioLists: withControllerLogging('getRadioLists', getRadioLists),
  getDigitalAlbumLists: withControllerLogging('getDigitalAlbumLists', getDigitalAlbumLists),
  getLyric: withControllerLogging('getLyric', getLyric),
  getMusicPlay: withControllerLogging('getMusicPlay', musicPlayOperationController),
  getAlbumInfo: withControllerLogging('getAlbumInfo', operationController(getAlbumInfo)),
  getComments: withControllerLogging('getComments', getComments),
  getRecommend: withControllerLogging('getRecommend', getRecommend),
  getTopLists: withControllerLogging('getTopLists', getTopLists),
  getRanks: withControllerLogging('getRanks', getRanks),
  getTicketInfo: withControllerLogging('getTicketInfo', getTicketInfo),
  getImageUrl: withControllerLogging('getImageUrl', getImageUrl),
  qrKey: withControllerLogging('qrKey', operationController(qrKey)),
  qrCreate: withControllerLogging('qrCreate', operationController(qrCreate)),
  qrCheck: withControllerLogging('qrCheck', qrCheckOperationController),
  qrCancel: withControllerLogging('qrCancel', operationController(qrCancel)),
  loginStatus: withControllerLogging('loginStatus', operationController(loginStatus)),
  loginChannels: withControllerLogging('loginChannels', operationController(loginChannels)),
  logout: withControllerLogging('logout', logoutOperationController),
  userDetail: withControllerLogging('userDetail', operationController(userDetail)),
  getUserAlbums: withControllerLogging('getUserAlbums', operationController(getUserAlbums)),
  getUserLikedSongs: withControllerLogging(
    'getUserLikedSongs',
    operationController(getUserLikedSongs),
  ),
  getOwnedPlaylistSongs: withControllerLogging(
    'getOwnedPlaylistSongs',
    operationController(getOwnedPlaylistSongs),
  ),
  getUserPlaylist: withControllerLogging('getUserPlaylist', operationController(getUserPlaylist)),
  getGuessYouLike: withControllerLogging('getGuessYouLike', operationController(getGuessYouLike)),
  getRecommendPlaylists: withControllerLogging(
    'getRecommendPlaylists',
    operationController(getRecommendPlaylists),
  ),
  getRecommendRadar: withControllerLogging(
    'getRecommendRadar',
    operationController(getRecommendRadar),
  ),
  getSimilarSongs: withControllerLogging('getSimilarSongs', operationController(getSimilarSongs)),
  getRelatedPlaylists: withControllerLogging(
    'getRelatedPlaylists',
    operationController(getRelatedPlaylists),
  ),
  getRadioList: withControllerLogging('getRadioList', operationController(getRadioList)),
  getRadioTracks: withControllerLogging('getRadioTracks', operationController(getRadioTracks)),
  getPlaylistCategories: withControllerLogging(
    'getPlaylistCategories',
    operationController(getPlaylistCategories),
  ),
  getCategoryPlaylists: withControllerLogging(
    'getCategoryPlaylists',
    operationController(getCategoryPlaylists),
  ),
  getNewSongs: withControllerLogging('getNewSongs', operationController(getNewSongs)),
  getNewAlbums: withControllerLogging('getNewAlbums', operationController(getNewAlbums)),
  getRecommendToplists: withControllerLogging(
    'getRecommendToplists',
    operationController(getRecommendToplists),
  ),
  getRecommendToplistSongs: withControllerLogging(
    'getRecommendToplistSongs',
    operationController(getRecommendToplistSongs),
  ),
  getSearch: withControllerLogging('getSearch', operationController(getSearch)),
  getHotSearches: withControllerLogging('getHotSearches', operationController(getHotSearches)),
  getSearchSuggestions: withControllerLogging(
    'getSearchSuggestions',
    operationController(getSearchSuggestions),
  ),
  listSingers: withControllerLogging('listSingers', operationController(listSingers)),
  getSingerDetail: withControllerLogging('getSingerDetail', operationController(getSingerDetail)),
  getSingerHomepage: withControllerLogging(
    'getSingerHomepage',
    operationController(getSingerHomepage),
  ),
  getSimilarSingers: withControllerLogging(
    'getSimilarSingers',
    operationController(getSimilarSingers),
  ),
  getSingerSongs: withControllerLogging('getSingerSongs', operationController(getSingerSongs)),
  getSingerMvs: withControllerLogging('getSingerMvs', operationController(getSingerMvs)),
  getHotComments: withControllerLogging('getHotComments', operationController(getHotComments)),
  getNewComments: withControllerLogging('getNewComments', operationController(getNewComments)),
  getCommentCount: withControllerLogging('getCommentCount', operationController(getCommentCount)),
  getMvList: withControllerLogging('getMvList', operationController(getMvList)),
  getMvDetail: withControllerLogging('getMvDetail', operationController(getMvDetail)),
  getMvUrl: withControllerLogging('getMvUrl', operationController(getMvUrl)),
  getSongMvs: withControllerLogging('getSongMvs', operationController(getSongMvs)),
  getSongLabels: withControllerLogging('getSongLabels', operationController(getSongLabels)),
};
