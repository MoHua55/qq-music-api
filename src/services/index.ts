// album
import getAlbumInfo from './album/getAlbumInfo';
// comments
import getComments from './comments/getComments';
// DigitalAlbum
import getDigitalAlbumLists from './digitalAlbum/getDigitalAlbumLists';
import downloadQQMusic from './downloadQQMusic';
// music
// radio
import getRadioLists from './radio/getRadioLists';
// getTopLists
import getTopLists from './rank/getTopLists';
// search
import getSmartbox from './search/getSmartbox';
import songListCategories from './songLists/songListCategories';
import songListDetail from './songLists/songListDetail';
// song list
import songLists from './songLists/songLists';
// UCommon
import UCommon from './UCommon/UCommon';

export default {
  downloadQQMusic,
  // search
  getSmartbox,
  // song lists
  songLists,
  songListCategories,
  songListDetail,
  // radio
  getRadioLists,
  // DigitalAlbum
  getDigitalAlbumLists,
  // music
  // album
  getAlbumInfo,
  // comments
  getComments,
  // UCommon
  UCommon,
  // getTopLists
  getTopLists,
};
