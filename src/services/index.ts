// album
import getAlbumInfo from './album/getAlbumInfo';
// comments
import getComments from './comments/getComments';
// DigitalAlbum
import getDigitalAlbumLists from './digitalAlbum/getDigitalAlbumLists';
import downloadQQMusic from './downloadQQMusic';
// music
import getLyric from './music/getLyric';
// MV
// radio
import getRadioLists from './radio/getRadioLists';
// getTopLists
import getTopLists from './rank/getTopLists';
import getGuessYouLike from './recommend/getGuessYouLike';
import getRadar from './recommend/getRadar';
import { getRadioList, getRadioTracks } from './recommend/getRadio';
import getRecommendPlaylists from './recommend/getRecommendPlaylists';
import { getRelatedPlaylists, getSimilarSongs } from './recommend/getSongRelations';
// search
import getSearch from './search/getSearch';
import getSmartbox from './search/getSmartbox';
// singer
import getAuthenticatedSongListDetail from './songLists/getAuthenticatedSongListDetail';
import songListCategories from './songLists/songListCategories';
import songListDetail from './songLists/songListDetail';
// song list
import songLists from './songLists/songLists';
// UCommon
import UCommon from './UCommon/UCommon';
import getOwnedPlaylistSongs from './user/getOwnedPlaylistSongs';
import getUserAlbums from './user/getUserAlbums';
import getUserLikedSongs from './user/getUserLikedSongs';
import getUserPlaylist from './user/getUserPlaylist';

export default {
  downloadQQMusic,
  // search
  getSmartbox,
  // song lists
  songLists,
  songListCategories,
  songListDetail,
  getAuthenticatedSongListDetail,
  // MV
  // singer
  // radio
  getRadioLists,
  // DigitalAlbum
  getDigitalAlbumLists,
  // music
  getLyric,
  // album
  getAlbumInfo,
  // comments
  getComments,
  // UCommon
  UCommon,
  // getTopLists
  getTopLists,
  getOwnedPlaylistSongs,
  getUserAlbums,
  getUserLikedSongs,
  getUserPlaylist,
  // recommend
  getGuessYouLike,
  getRecommendPlaylists,
  getRadar,
  getSimilarSongs,
  getRelatedPlaylists,
  getRadioList,
  getRadioTracks,
  // search
  getSearch,
};
