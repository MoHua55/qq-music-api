import { getAlbumInfo } from '../routes/operations/getAlbumInfo';
import { getSongInfo } from '../routes/operations/getSongInfo';
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
import getMusicPlay from './getMusicPlay';
import getMv from './getMv';
import getMvByTag from './getMvByTag';
import getMvPlay from './getMvPlay';
import getNewDisks from './getNewDisks';
import getOwnedPlaylistSongs from './getOwnedPlaylistSongs';
import getRadioLists from './getRadioLists';
import getRanks from './getRanks';
import getRecommend from './getRecommend';
import getRecommendPlaylists from './getRecommendPlaylists';
import getSearchByKey from './getSearchByKey';
import getSimilarSinger from './getSimilarSinger';
import getSingerAlbum from './getSingerAlbum';
import getSingerDesc from './getSingerDesc';
import getSingerHotsong from './getSingerHotsong';
import getSingerList from './getSingerList';
import getSingerMv from './getSingerMv';
import getSingerStarNum from './getSingerStarNum';
import getSmartbox from './getSmartbox';
import getSongListCategories from './getSongListCategories';
import getSongListDetail from './getSongListDetail';
import getSongLists from './getSongLists';
import getTicketInfo from './getTicketInfo';
import getTopLists from './getTopLists';
import getUserAlbums from './getUserAlbums';
import getUserLikedSongs from './getUserLikedSongs';
import getUserPlaylist from './getUserPlaylist';
import {
  loginChannels,
  loginStatus,
  logout,
  qrCancel,
  qrCheck,
  qrCreate,
  qrKey,
  userDetail,
} from './login';
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
  getSongListDetail: withControllerLogging('getSongListDetail', getSongListDetail),
  getNewDisks: withControllerLogging('getNewDisks', getNewDisks),
  getMvByTag: withControllerLogging('getMvByTag', getMvByTag),
  getMv: withControllerLogging('getMv', getMv),
  getSingerList: withControllerLogging('getSingerList', getSingerList),
  getSimilarSinger: withControllerLogging('getSimilarSinger', getSimilarSinger),
  getSingerAlbum: withControllerLogging('getSingerAlbum', getSingerAlbum),
  getSingerHotsong: withControllerLogging('getSingerHotsong', getSingerHotsong),
  getSingerMv: withControllerLogging('getSingerMv', getSingerMv),
  getSingerDesc: withControllerLogging('getSingerDesc', getSingerDesc),
  getSingerStarNum: withControllerLogging('getSingerStarNum', getSingerStarNum),
  getRadioLists: withControllerLogging('getRadioLists', getRadioLists),
  getDigitalAlbumLists: withControllerLogging('getDigitalAlbumLists', getDigitalAlbumLists),
  getLyric: withControllerLogging('getLyric', getLyric),
  getMusicPlay: withControllerLogging('getMusicPlay', getMusicPlay),
  getAlbumInfo: withControllerLogging('getAlbumInfo', operationController(getAlbumInfo)),
  getComments: withControllerLogging('getComments', getComments),
  getRecommend: withControllerLogging('getRecommend', getRecommend),
  getMvPlay: withControllerLogging('getMvPlay', getMvPlay),
  getTopLists: withControllerLogging('getTopLists', getTopLists),
  getRanks: withControllerLogging('getRanks', getRanks),
  getTicketInfo: withControllerLogging('getTicketInfo', getTicketInfo),
  getImageUrl: withControllerLogging('getImageUrl', getImageUrl),
  qrKey: withControllerLogging('qrKey', qrKey),
  qrCreate: withControllerLogging('qrCreate', qrCreate),
  qrCheck: withControllerLogging('qrCheck', qrCheck),
  qrCancel: withControllerLogging('qrCancel', qrCancel),
  loginStatus: withControllerLogging('loginStatus', loginStatus),
  loginChannels: withControllerLogging('loginChannels', loginChannels),
  logout: withControllerLogging('logout', logout),
  userDetail: withControllerLogging('userDetail', userDetail),
  getUserAlbums: withControllerLogging('getUserAlbums', getUserAlbums),
  getUserLikedSongs: withControllerLogging('getUserLikedSongs', getUserLikedSongs),
  getOwnedPlaylistSongs: withControllerLogging('getOwnedPlaylistSongs', getOwnedPlaylistSongs),
  getUserPlaylist: withControllerLogging('getUserPlaylist', getUserPlaylist),
  getGuessYouLike: withControllerLogging('getGuessYouLike', getGuessYouLike),
  getRecommendPlaylists: withControllerLogging('getRecommendPlaylists', getRecommendPlaylists),
};
