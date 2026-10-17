import Router from 'koa-router';

const router = new Router();

import context from '../controllers';

// cookies
router.get('/user/getCookie', context.getCookie);
router.get('/user/setCookie', context.setCookie);

// native QQ Music QR login
router.get('/login/qr/key', context.qrKey);
router.get('/login/qr/create', context.qrCreate);
router.get('/login/qr/check', context.qrCheck);
router.get('/login/qr/cancel', context.qrCancel);
router.get('/login/status', context.loginStatus);
router.get('/login/channels', context.loginChannels);
router.get('/logout', context.logout);
router.post('/login/refresh', context.loginRefresh);
router.get('/user/detail', context.userDetail);
router.get('/user/vip', context.userVip);
router.post('/user/song/like', context.songLike);
router.post('/user/album/subscribe', context.albumSubscribe);
router.post('/user/playlist/tracks', context.playlistTracks);
router.post('/user/playlist/create', context.playlistCreate);
router.post('/user/playlist/rename', context.playlistRename);
router.post('/user/playlist/delete', context.playlistDelete);
router.post('/user/playlist/subscribe', context.playlistSubscribe);
router.get('/user/subscription-status', context.subscriptionStatus);
router.get('/user/playlist', context.getUserPlaylist);
router.get('/user/albums', context.getUserAlbums);
router.get('/user/liked-songs', context.getUserLikedSongs);
router.get('/user/playlist-detail', context.getOwnedPlaylistSongs);
router.get('/user/guess-you-like', context.getGuessYouLike);
router.get('/user/daily-songs', context.userDailySongs);
router.get('/user/cloud', context.userCloud);

// recommendations; a login session is used when present
router.get('/recommend/playlists', context.getRecommendPlaylists);

// public catalog recommendations; always anonymous
router.get('/recommend/categories', context.getPlaylistCategories);
router.get('/recommend/category-playlists', context.getCategoryPlaylists);
router.get('/recommend/new-songs', context.getNewSongs);
router.get('/recommend/new-albums', context.getNewAlbums);
router.get('/recommend/radar', context.getRecommendRadar);
router.get('/recommend/toplists', context.getRecommendToplists);
router.get('/recommend/toplist', context.getRecommendToplistSongs);

// keyword search; a login session is used when present
router.get('/search', context.getSearch);

// radio; a login session is required
router.get('/radio/list', context.getRadioList);
router.get('/radio/tracks', context.getRadioTracks);

// downloadQQMusic
router.get('/downloadQQMusic', context.getDownloadQQMusic);

router.get('/getHotkey', context.getHotKey);

// search smartbox
router.get('/getSmartbox/:key?', context.getSmartbox);

// 1
router.get('/getSongListCategories', context.getSongListCategories);

router.get('/getSongLists/:page?/:limit?/:categoryId?/:sortId?', context.getSongLists);

router.post('/batchGetSongLists', context.batchGetSongLists);

// getSongInfo
router.get('/getSongInfo/:songmid?/:songid?', context.getSongInfo);
router.post('/batchGetSongInfo', context.batchGetSongInfo);

// 4
// disstid=7011264340
router.get('/getSongListDetail/:disstid?', context.getSongListDetail);

// newDisk
router.get('/getNewDisks/:page?/:limit?', context.getNewDisks);

// getMvByTag
router.get('/getMvByTag', context.getMvByTag);

// MV
// area_id=15&version_id=7
router.get('/getMv/:area_id?/:version_id?/:limit?/:page?', context.getMv);

// getSingerList
router.get('/getSingerList/:area?/:sex?/:genre?/:index?/:page?', context.getSingerList);

// getSimilarSinger
// singermid=0025NhlN2yWrP4
router.get('/getSimilarSinger/:singermid?', context.getSimilarSinger);

// getSingerAlbum
// singermid=0025NhlN2yWrP4
router.get('/getSingerAlbum/:singermid?/:limit?/:page?', context.getSingerAlbum);

router.get('/getSingerHotsong/:singermid?/:limit?/:page?', context.getSingerHotsong);

/**
 * @description: getSingerMv
 * @param order: time(fan upload) || listen(singer all)
 */
router.get('/getSingerMv/:singermid?/:limit?/:order?', context.getSingerMv);

router.get('/getSingerDesc/:singermid?', context.getSingerDesc);

router.get('/getSingerStarNum/:singermid?', context.getSingerStarNum);

// radio
router.get('/getRadioLists', context.getRadioLists);

// DigitalAlbum
router.get('/getDigitalAlbumLists', context.getDigitalAlbumLists);

// music
// getLyric
// songmid=003rJSwm3TechU
router.get('/getLyric/:songmid?/:isFormat?', context.getLyric);

// songmid=003rJSwm3TechU
router.get('/getMusicPlay/:songmid?', context.getMusicPlay);

// album
// albummid=0016l2F430zMux
router.get('/getAlbumInfo/:albummid?', context.getAlbumInfo);

router.get(
  '/getComments/:id?/:rootcommentid?/:cid?/:pagesize?/:pagenum?/:cmd?/:reqtype?/:biztype?',
  context.getComments,
);

// recommend
router.get('/getRecommend', context.getRecommend);

// mv play
router.get('/getMvPlay/:vid?', context.getMvPlay);

// rankList: getTopLists
router.get('/getTopLists', context.getTopLists);

// ranks
router.get('/getRanks/:topId?/:limit?/:page?', context.getRanks);

// ticket
router.get('/getTicketInfo', context.getTicketInfo);

// getImageUrl
router.get('/getImageUrl', context.getImageUrl);

export default router;
