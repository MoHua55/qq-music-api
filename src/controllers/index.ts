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
  playlistCreate,
  playlistDelete,
  playlistRename,
} from '../routes/operations/playlistManagement';
import { playlistTracks } from '../routes/operations/playlistTracks';
import { qrCancel } from '../routes/operations/qrCancel';
import { qrCreate } from '../routes/operations/qrCreate';
import { qrKey } from '../routes/operations/qrKey';
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
import getGuessYouLike from './getGuessYouLike';
import getHotKey from './getHotkey';
import getImageUrl from './getImageUrl';
import getLyric from './getLyric';
import getMv from './getMv';
import getMvByTag from './getMvByTag';
import getMvPlay from './getMvPlay';
import getNewDisks from './getNewDisks';
import { getRadioList, getRadioTracks } from './getRadio';
import getRadioLists from './getRadioLists';
import getRanks from './getRanks';
import getRecommend from './getRecommend';
import {
  getCategoryPlaylists,
  getNewAlbums,
  getNewSongs,
  getPlaylistCategories,
  getRecommendToplistSongs,
  getRecommendToplists,
} from './getRecommendCatalog';
import getRecommendPlaylists from './getRecommendPlaylists';
import getRecommendRadar from './getRecommendRadar';
import getSearch from './getSearch';
import { getHotSearches, getSearchSuggestions } from './getSearchSuggest';
import getSimilarSinger from './getSimilarSinger';
import {
  getSimilarSingers,
  getSingerDetail,
  getSingerHomepage,
  getSingerMvs,
  getSingerSongs,
  listSingers,
} from './getSingerCatalog';
import getSingerDesc from './getSingerDesc';
import getSingerList from './getSingerList';
import getSingerMv from './getSingerMv';
import getSingerStarNum from './getSingerStarNum';
import getSmartbox from './getSmartbox';
import getSongListCategories from './getSongListCategories';
import getSongLists from './getSongLists';
import { getRelatedPlaylists, getSimilarSongs } from './getSongRelations';
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
  getHotKey: withControllerLogging('getHotKey', getHotKey),
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
  getGuessYouLike: withControllerLogging('getGuessYouLike', getGuessYouLike),
  getRecommendPlaylists: withControllerLogging('getRecommendPlaylists', getRecommendPlaylists),
  getRecommendRadar: withControllerLogging('getRecommendRadar', getRecommendRadar),
  getSimilarSongs: withControllerLogging('getSimilarSongs', getSimilarSongs),
  getRelatedPlaylists: withControllerLogging('getRelatedPlaylists', getRelatedPlaylists),
  getRadioList: withControllerLogging('getRadioList', getRadioList),
  getRadioTracks: withControllerLogging('getRadioTracks', getRadioTracks),
  getPlaylistCategories: withControllerLogging('getPlaylistCategories', getPlaylistCategories),
  getCategoryPlaylists: withControllerLogging('getCategoryPlaylists', getCategoryPlaylists),
  getNewSongs: withControllerLogging('getNewSongs', getNewSongs),
  getNewAlbums: withControllerLogging('getNewAlbums', getNewAlbums),
  getRecommendToplists: withControllerLogging('getRecommendToplists', getRecommendToplists),
  getRecommendToplistSongs: withControllerLogging(
    'getRecommendToplistSongs',
    getRecommendToplistSongs,
  ),
  getSearch: withControllerLogging('getSearch', getSearch),
  getHotSearches: withControllerLogging('getHotSearches', getHotSearches),
  getSearchSuggestions: withControllerLogging('getSearchSuggestions', getSearchSuggestions),
  listSingers: withControllerLogging('listSingers', listSingers),
  getSingerDetail: withControllerLogging('getSingerDetail', getSingerDetail),
  getSingerHomepage: withControllerLogging('getSingerHomepage', getSingerHomepage),
  getSimilarSingers: withControllerLogging('getSimilarSingers', getSimilarSingers),
  getSingerSongs: withControllerLogging('getSingerSongs', getSingerSongs),
  getSingerMvs: withControllerLogging('getSingerMvs', getSingerMvs),
};
