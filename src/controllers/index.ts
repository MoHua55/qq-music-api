import { getAlbumInfo } from '../routes/operations/getAlbumInfo';
import { getOwnedPlaylistSongs } from '../routes/operations/getOwnedPlaylistSongs';
import { getSingerAlbum } from '../routes/operations/getSingerAlbum';
import { getSingerHotsong } from '../routes/operations/getSingerHotsong';
import { getSongInfo } from '../routes/operations/getSongInfo';
import { getSongListDetail } from '../routes/operations/getSongListDetail';
import { getUserAlbums } from '../routes/operations/getUserAlbums';
import { getUserLikedSongs } from '../routes/operations/getUserLikedSongs';
import { getUserPlaylist } from '../routes/operations/getUserPlaylist';
import { loginStatus } from '../routes/operations/loginStatus';
import { qrCreate } from '../routes/operations/qrCreate';
import { qrKey } from '../routes/operations/qrKey';
import { userDetail } from '../routes/operations/userDetail';
import { withControllerLogging } from '../util/observability';
import batchGetSongInfo from './batchGetSongInfo';
import batchGetSongLists from './batchGetSongLists';
import cookies from './cookies';
import getComments from './getComments';
import getDigitalAlbumLists from './getDigitalAlbumLists';
import getDownloadQQMusic from './getDownloadQQMusic';
import getGuessYouLike from './getGuessYouLike';
import getHotKey from './getHotkey';
import getImageUrl from './getImageUrl';
import getLyric from './getLyric';
import getMv from './getMv';
import getMvByTag from './getMvByTag';
import getMvPlay from './getMvPlay';
import getNewDisks from './getNewDisks';
import getRadioLists from './getRadioLists';
import getRanks from './getRanks';
import getRecommend from './getRecommend';
import getRecommendPlaylists from './getRecommendPlaylists';
import getSearchByKey from './getSearchByKey';
import getSimilarSinger from './getSimilarSinger';
import getSingerDesc from './getSingerDesc';
import getSingerList from './getSingerList';
import getSingerMv from './getSingerMv';
import getSingerStarNum from './getSingerStarNum';
import getSmartbox from './getSmartbox';
import getSongListCategories from './getSongListCategories';
import getSongLists from './getSongLists';
import getTicketInfo from './getTicketInfo';
import getTopLists from './getTopLists';
import { loginChannels, qrCancel, qrCheck } from './login';
import logoutOperationController from './logoutOperation';
import musicPlayOperationController from './musicPlayOperation';
import { operationController } from './operation';

const { get: getCookie, set: setCookie } = cookies;

export default {
  getCookie: withControllerLogging('getCookie', getCookie),
  setCookie: withControllerLogging('setCookie', setCookie),
  getDownloadQQMusic: withControllerLogging('getDownloadQQMusic', getDownloadQQMusic),
  getHotKey: withControllerLogging('getHotKey', getHotKey),
  getSearchByKey: withControllerLogging('getSearchByKey', getSearchByKey),
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
  getMvByTag: withControllerLogging('getMvByTag', getMvByTag),
  getMv: withControllerLogging('getMv', getMv),
  getSingerList: withControllerLogging('getSingerList', getSingerList),
  getSimilarSinger: withControllerLogging('getSimilarSinger', getSimilarSinger),
  getSingerAlbum: withControllerLogging('getSingerAlbum', operationController(getSingerAlbum)),
  getSingerHotsong: withControllerLogging(
    'getSingerHotsong',
    operationController(getSingerHotsong),
  ),
  getSingerMv: withControllerLogging('getSingerMv', getSingerMv),
  getSingerDesc: withControllerLogging('getSingerDesc', getSingerDesc),
  getSingerStarNum: withControllerLogging('getSingerStarNum', getSingerStarNum),
  getRadioLists: withControllerLogging('getRadioLists', getRadioLists),
  getDigitalAlbumLists: withControllerLogging('getDigitalAlbumLists', getDigitalAlbumLists),
  getLyric: withControllerLogging('getLyric', getLyric),
  getMusicPlay: withControllerLogging('getMusicPlay', musicPlayOperationController),
  getAlbumInfo: withControllerLogging('getAlbumInfo', operationController(getAlbumInfo)),
  getComments: withControllerLogging('getComments', getComments),
  getRecommend: withControllerLogging('getRecommend', getRecommend),
  getMvPlay: withControllerLogging('getMvPlay', getMvPlay),
  getTopLists: withControllerLogging('getTopLists', getTopLists),
  getRanks: withControllerLogging('getRanks', getRanks),
  getTicketInfo: withControllerLogging('getTicketInfo', getTicketInfo),
  getImageUrl: withControllerLogging('getImageUrl', getImageUrl),
  qrKey: withControllerLogging('qrKey', operationController(qrKey)),
  qrCreate: withControllerLogging('qrCreate', operationController(qrCreate)),
  qrCheck: withControllerLogging('qrCheck', qrCheck),
  qrCancel: withControllerLogging('qrCancel', qrCancel),
  loginStatus: withControllerLogging('loginStatus', operationController(loginStatus)),
  loginChannels: withControllerLogging('loginChannels', loginChannels),
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
  getGuessYouLike: withControllerLogging('getGuessYouLike', getGuessYouLike),
  getRecommendPlaylists: withControllerLogging('getRecommendPlaylists', getRecommendPlaylists),
};
