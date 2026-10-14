export type ApiExplorerMethod = 'GET' | 'POST';

export type ApiExplorerInputType = 'text' | 'number' | 'boolean' | 'textarea';

export interface ApiExplorerField {
  key: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  description?: string;
  defaultValue?: string | number | boolean;
  inputType?: ApiExplorerInputType;
}

export interface ApiExplorerEndpoint {
  id: string;
  name: string;
  category: string;
  description: string;
  method: ApiExplorerMethod;
  routePath: string;
  path: string;
  pathParams?: ApiExplorerField[];
  queryParams?: ApiExplorerField[];
  bodyExample?: Record<string, unknown>;
  bodyDescription?: string;
}

export interface ApiExplorerMetadata {
  title: string;
  description: string;
  endpoints: ApiExplorerEndpoint[];
}

export const API_EXPLORER_ROUTE_PATH = '/explorer';
export const API_EXPLORER_INDEX_PATH = '/explorer/index.html';
export const API_EXPLORER_METADATA_PATH = '/explorer/metadata';

export interface ApiExplorerBaseRoute {
  name: string;
  method: ApiExplorerMethod;
  routePath: string;
  category: string;
}

const humanizeFieldLabel = (value: string): string =>
  value
    .split('_')
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');

export const createApiExplorerId = (name: string): string =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase();

export const stripRouteParams = (routePath: string): string => {
  const strippedPath = routePath.replace(/\/:[A-Za-z0-9_]+\??/g, '');
  return strippedPath || '/';
};

export const extractRouteParams = (routePath: string): ApiExplorerField[] => {
  const matches = [...routePath.matchAll(/:([A-Za-z0-9_]+)(\?)?/g)];

  return matches.map((match) => {
    const key = match[1];
    const isOptional = match[2] === '?';

    return {
      key,
      label: humanizeFieldLabel(key),
      required: !isOptional,
      placeholder: key,
      description: `Route parameter: ${key}`,
    };
  });
};

export const apiExplorerBaseRoutes: ApiExplorerBaseRoute[] = [
  { name: 'getCookie', method: 'GET', routePath: '/user/getCookie', category: 'User' },
  { name: 'setCookie', method: 'GET', routePath: '/user/setCookie', category: 'User' },
  { name: 'qrKey', method: 'GET', routePath: '/login/qr/key', category: 'Login' },
  { name: 'qrCreate', method: 'GET', routePath: '/login/qr/create', category: 'Login' },
  { name: 'qrCheck', method: 'GET', routePath: '/login/qr/check', category: 'Login' },
  { name: 'qrCancel', method: 'GET', routePath: '/login/qr/cancel', category: 'Login' },
  { name: 'loginStatus', method: 'GET', routePath: '/login/status', category: 'Login' },
  { name: 'loginChannels', method: 'GET', routePath: '/login/channels', category: 'Login' },
  { name: 'logout', method: 'GET', routePath: '/logout', category: 'Login' },
  { name: 'userDetail', method: 'GET', routePath: '/user/detail', category: 'User' },
  { name: 'getUserPlaylist', method: 'GET', routePath: '/user/playlist', category: 'User' },
  { name: 'getUserAlbums', method: 'GET', routePath: '/user/albums', category: 'User' },
  { name: 'getUserLikedSongs', method: 'GET', routePath: '/user/liked-songs', category: 'User' },
  {
    name: 'getOwnedPlaylistSongs',
    method: 'GET',
    routePath: '/user/playlist-detail',
    category: 'User',
  },
  { name: 'getGuessYouLike', method: 'GET', routePath: '/user/guess-you-like', category: 'User' },
  {
    name: 'getRecommendPlaylists',
    method: 'GET',
    routePath: '/recommend/playlists',
    category: 'Recommend',
  },
  {
    name: 'getPlaylistCategories',
    method: 'GET',
    routePath: '/recommend/categories',
    category: 'Recommend',
  },
  {
    name: 'getCategoryPlaylists',
    method: 'GET',
    routePath: '/recommend/category-playlists',
    category: 'Recommend',
  },
  { name: 'getNewSongs', method: 'GET', routePath: '/recommend/new-songs', category: 'Recommend' },
  { name: 'getRadioList', method: 'GET', routePath: '/radio/list', category: 'Recommend' },
  { name: 'getRadioTracks', method: 'GET', routePath: '/radio/tracks', category: 'Recommend' },
  { name: 'getDownloadQQMusic', method: 'GET', routePath: '/downloadQQMusic', category: 'Song' },
  { name: 'getHotkey', method: 'GET', routePath: '/getHotkey', category: 'Search' },
  {
    name: 'getSearchByKey',
    method: 'GET',
    routePath: '/getSearchByKey/:key?/:limit?/:page?/:catZhida?',
    category: 'Search',
  },
  { name: 'getSmartbox', method: 'GET', routePath: '/getSmartbox/:key?', category: 'Search' },
  {
    name: 'getSongListCategories',
    method: 'GET',
    routePath: '/getSongListCategories',
    category: 'Song Lists',
  },
  {
    name: 'getSongLists',
    method: 'GET',
    routePath: '/getSongLists/:page?/:limit?/:categoryId?/:sortId?',
    category: 'Song Lists',
  },
  {
    name: 'batchGetSongLists',
    method: 'POST',
    routePath: '/batchGetSongLists',
    category: 'Batch',
  },
  {
    name: 'getSongInfo',
    method: 'GET',
    routePath: '/getSongInfo/:songmid?/:songid?',
    category: 'Song',
  },
  {
    name: 'batchGetSongInfo',
    method: 'POST',
    routePath: '/batchGetSongInfo',
    category: 'Batch',
  },
  {
    name: 'getSongListDetail',
    method: 'GET',
    routePath: '/getSongListDetail/:disstid?',
    category: 'Song Lists',
  },
  {
    name: 'getNewDisks',
    method: 'GET',
    routePath: '/getNewDisks/:page?/:limit?',
    category: 'Album',
  },
  { name: 'getMvByTag', method: 'GET', routePath: '/getMvByTag', category: 'MV' },
  {
    name: 'getMv',
    method: 'GET',
    routePath: '/getMv/:area_id?/:version_id?/:limit?/:page?',
    category: 'MV',
  },
  {
    name: 'getSingerList',
    method: 'GET',
    routePath: '/getSingerList/:area?/:sex?/:genre?/:index?/:page?',
    category: 'Singer',
  },
  {
    name: 'getSimilarSinger',
    method: 'GET',
    routePath: '/getSimilarSinger/:singermid?',
    category: 'Singer',
  },
  {
    name: 'getSingerAlbum',
    method: 'GET',
    routePath: '/getSingerAlbum/:singermid?/:limit?/:page?',
    category: 'Singer',
  },
  {
    name: 'getSingerHotsong',
    method: 'GET',
    routePath: '/getSingerHotsong/:singermid?/:limit?/:page?',
    category: 'Singer',
  },
  {
    name: 'getSingerMv',
    method: 'GET',
    routePath: '/getSingerMv/:singermid?/:limit?/:order?',
    category: 'Singer',
  },
  {
    name: 'getSingerDesc',
    method: 'GET',
    routePath: '/getSingerDesc/:singermid?',
    category: 'Singer',
  },
  {
    name: 'getSingerStarNum',
    method: 'GET',
    routePath: '/getSingerStarNum/:singermid?',
    category: 'Singer',
  },
  { name: 'getRadioLists', method: 'GET', routePath: '/getRadioLists', category: 'Radio' },
  {
    name: 'getDigitalAlbumLists',
    method: 'GET',
    routePath: '/getDigitalAlbumLists',
    category: 'Digital Album',
  },
  {
    name: 'getLyric',
    method: 'GET',
    routePath: '/getLyric/:songmid?/:isFormat?',
    category: 'Song',
  },
  {
    name: 'getMusicPlay',
    method: 'GET',
    routePath: '/getMusicPlay/:songmid?',
    category: 'Song',
  },
  {
    name: 'getAlbumInfo',
    method: 'GET',
    routePath: '/getAlbumInfo/:albummid?',
    category: 'Album',
  },
  {
    name: 'getComments',
    method: 'GET',
    routePath:
      '/getComments/:id?/:rootcommentid?/:cid?/:pagesize?/:pagenum?/:cmd?/:reqtype?/:biztype?',
    category: 'Common',
  },
  { name: 'getRecommend', method: 'GET', routePath: '/getRecommend', category: 'Recommend' },
  { name: 'getMvPlay', method: 'GET', routePath: '/getMvPlay/:vid?', category: 'MV' },
  { name: 'getTopLists', method: 'GET', routePath: '/getTopLists', category: 'Rank' },
  {
    name: 'getRanks',
    method: 'GET',
    routePath: '/getRanks/:topId?/:limit?/:page?',
    category: 'Rank',
  },
  { name: 'getTicketInfo', method: 'GET', routePath: '/getTicketInfo', category: 'Ticket' },
  { name: 'getImageUrl', method: 'GET', routePath: '/getImageUrl', category: 'Common' },
];

export const apiExplorerOverrides: Record<string, Partial<ApiExplorerEndpoint>> = {
  getCookie: {
    description: 'Get safe cookie status information.',
  },
  setCookie: {
    description: 'Attempt to update cookie dynamically. Disabled by default for security.',
  },
  qrKey: {
    description: 'Create one short-lived native QQ Music QR login session.',
    queryParams: [
      {
        key: 'channel',
        label: 'Login Channel',
        description: 'qq (scan with mobile QQ, default) or wechat (scan with WeChat).',
      },
    ],
  },
  loginChannels: {
    description:
      'List login channels, session mode, configuration status and supported backend methods. No login or upstream request is needed. Feature flags describe implementation; check configured and login status separately.',
  },
  qrCreate: {
    description: 'Create the PNG QR image for an existing login session.',
    queryParams: [
      {
        key: 'key',
        label: 'QR Key',
        required: true,
        description: 'Opaque key returned by /login/qr/key.',
      },
    ],
  },
  qrCheck: {
    description:
      'Poll QR state: 800 expired or failed, 801 waiting, 802 scanned, or 803 confirmed. A failed 800 may add upstreamErrorKey for a registered code, and mobile QQ may add primaryFailure with fallbackAttempted when its fallback check overwrote the first failure. A recognised failure adds failureHint with a key and a default English message.',
    queryParams: [
      {
        key: 'key',
        label: 'QR Key',
        required: true,
        description: 'Opaque key returned by /login/qr/key.',
      },
    ],
  },
  qrCancel: {
    description: 'Release one QR login session by key. Unknown keys still return 200.',
    queryParams: [
      {
        key: 'key',
        label: 'QR Key',
        required: true,
        description: 'Opaque key returned by /login/qr/key.',
      },
    ],
  },
  loginStatus: {
    description: 'Get the authenticated QQ Music profile for the current session.',
  },
  logout: {
    description: 'Clear the current in-memory QQ Music login session.',
  },
  userDetail: {
    description:
      'Get the current authenticated QQ Music user detail. A gateway and credential-code conflict answers 502 without clearing the session; credential rejection alone remains 401.',
  },
  getUserPlaylist: {
    description:
      "Get created and collected playlists for the authenticated user. Collected playlists keep their original cover; QQ Music's official playlists use their first song's album cover.",
    queryParams: [
      {
        key: 'uid',
        label: 'User ID',
        description:
          'Defaults to the authenticated QQ Music account. Only that account is supported; another account answers 400.',
      },
      {
        key: 'favoriteOffset',
        label: 'Favourite offset',
        description:
          'Continue reading collected playlists from this position. Use the nextFavoriteOffset of the previous answer; that round returns collected playlists only.',
      },
    ],
  },
  getUserAlbums: {
    description: 'Get the albums the authenticated user has added to their favourites.',
    queryParams: [
      { key: 'offset', label: 'Offset', description: 'Zero-based album offset.' },
      { key: 'limit', label: 'Limit', description: 'Page size, up to 100.' },
    ],
  },
  getUserLikedSongs: {
    description: "Get the authenticated user's built-in liked songs.",
    queryParams: [
      { key: 'offset', label: 'Offset', description: 'Zero-based song offset.' },
      { key: 'limit', label: 'Limit', description: 'Page size, up to 100.' },
    ],
  },
  getOwnedPlaylistSongs: {
    description:
      "Get songs of the authenticated user's own playlist, including ones set to private.",
    queryParams: [
      {
        key: 'tid',
        label: 'Playlist ID',
        description:
          'The tid listed by /user/playlist. Always pass it; dirid alone only resolves your own folders.',
      },
      {
        key: 'dirid',
        label: 'Directory ID',
        description: 'The dirId listed by /user/playlist. 201 is the built-in liked songs.',
      },
      { key: 'offset', label: 'Offset', description: 'Zero-based song offset.' },
      { key: 'limit', label: 'Limit', description: 'Page size, up to 100.' },
    ],
  },
  getGuessYouLike: {
    description:
      "Get a few songs from QQ Music's Guess You Like radio for the authenticated user (usually 5 per call). Songs keep the upstream format; reasons, when given, are in extras. Without a session it answers 401; when the upstream returns no songs it answers 422.",
  },
  getRecommendPlaylists: {
    description:
      'Get recommended playlists from the QQ Music playlist square. Uses the login session when there is one, otherwise reads anonymously. more only repeats the upstream hint; there is no continuation offset.',
    queryParams: [
      { key: 'limit', label: 'Limit', description: 'How many playlists, 25 by default, up to 60.' },
    ],
  },
  getPlaylistCategories: {
    description:
      'List the official playlist categories in groups (id and name). Read anonymously; no session needed.',
  },
  getCategoryPlaylists: {
    description:
      'Get official playlists of one category, in the same shape as /recommend/playlists, plus total and more. Read anonymously.',
    queryParams: [
      { key: 'id', label: 'Category id', description: 'Category id from /recommend/categories.' },
      { key: 'page', label: 'Page', description: 'Page number starting at 1.' },
      { key: 'limit', label: 'Limit', description: 'Playlists per page, 20 by default, up to 40.' },
    ],
  },
  getNewSongs: {
    description:
      'Get new songs for one area (latest by default) with the list of areas. Songs keep the upstream format. Read anonymously.',
    queryParams: [
      {
        key: 'area',
        label: 'Area',
        description: 'Area id from the areas list; 5 (latest) by default.',
      },
    ],
  },
  getRadioList: {
    description:
      'List QQ Music radio stations in groups for the authenticated user. Each radio has id, title, picurl and listenNum when known. Without a session it answers 401.',
  },
  getRadioTracks: {
    description:
      'Get a few songs from one radio station for the authenticated user. Radio 99 is Guess You Like and may add extras with reasons. Songs keep the upstream format. Without a session it answers 401; a bad id answers 400.',
    queryParams: [{ key: 'id', label: 'Radio id', description: 'Radio id from /radio/list.' }],
  },
  getDownloadQQMusic: {
    description: 'Get download URL information for QQ Music.',
  },
  getHotkey: {
    id: 'get-hotkey',
    description: 'Get current hot search keywords.',
  },
  getSearchByKey: {
    id: 'get-search-by-key',
    description: 'Search songs, singers, or albums by keyword.',
    queryParams: [
      {
        key: 'key',
        label: 'Keyword',
        required: true,
        placeholder: '周杰伦',
        description: 'Search keyword.',
        defaultValue: '周杰伦',
      },
      {
        key: 'limit',
        label: 'Limit',
        inputType: 'number',
        placeholder: '10',
        description: 'Items per page.',
        defaultValue: 10,
      },
      {
        key: 'page',
        label: 'Page',
        inputType: 'number',
        placeholder: '1',
        description: 'Current page number.',
        defaultValue: 1,
      },
      {
        key: 'catZhida',
        label: 'Category',
        inputType: 'number',
        placeholder: '1',
        description: '1 song, 2 singer, 3 album.',
        defaultValue: 1,
      },
      {
        key: 'remoteplace',
        label: 'Remote Place',
        placeholder: 'song',
        description: 'Search routing hint.',
        defaultValue: 'song',
      },
    ],
  },
  getSmartbox: {
    description: 'Get search smartbox suggestion results.',
  },
  getSongLists: {
    description: 'Get song list results by page, limit, category, and sort.',
  },
  batchGetSongLists: {
    id: 'batch-get-song-lists',
    description: 'Batch fetch song lists by multiple category IDs.',
    bodyDescription: 'JSON body with category IDs and paging options.',
    bodyExample: {
      page: 0,
      limit: 19,
      sortId: 5,
      categoryIds: ['10000000'],
    },
  },
  getSongInfo: {
    description: 'Get song detail by song MID and optional song ID.',
  },
  batchGetSongInfo: {
    id: 'batch-get-song-info',
    description: 'Batch fetch song detail for a list of song IDs.',
    bodyDescription: 'JSON body with `songs` as `[[songmid, songid]]`.',
    bodyExample: {
      songs: [['001fNHEf1SFEFN', '']],
    },
  },
  getSongListDetail: {
    description:
      'Get song list detail by disstid. With a login session, also reads the QQ Music algorithmic playlists the anonymous CGI rejects with code 10.',
  },
  getMv: {
    description: 'Get MV list by area and version.',
  },
  getSingerAlbum: {
    description: 'Get album list for a singer.',
  },
  getLyric: {
    id: 'get-lyric',
    description: 'Get song lyric content, optionally formatted.',
    queryParams: [
      {
        key: 'songmid',
        label: 'Song MID',
        required: true,
        placeholder: '003rJSwm3TechU',
        description: 'Song MID used by QQ Music.',
        defaultValue: '003rJSwm3TechU',
      },
      {
        key: 'isFormat',
        label: 'Format Lyric',
        inputType: 'boolean',
        placeholder: 'false',
        description: 'true/1 to format LRC text.',
        defaultValue: false,
      },
    ],
  },
  getMusicPlay: {
    description:
      'Get playable music URL by song MID; an opaque QR session enables authenticated playback. A missing URL adds restriction (still url_unavailable) and a plain English hint. Authenticated m4a/128 failures may query up to 10 song details: only complete matching features suggest region or membership; unknown features stay unconfirmed. QQ_PLAYBACK_HINTS_ENABLED=0 disables these hints and lookups. WeChat matching features are supported but not yet verified with controlled live tests. ape checks size_ape first (up to 10 songs); no file and failed checks have different hints and optional restriction.failureReason, and neither asks for a URL. preview=1 takes priority, asking for a preview only when size_try is above 0 and a media id is known, marking successful entries preview: true.',
  },
  getAlbumInfo: {
    id: 'get-album-info',
    description: 'Get album detail by album MID.',
    queryParams: [
      {
        key: 'albummid',
        label: 'Album MID',
        required: true,
        placeholder: '0016l2F430zMux',
        description: 'Album MID.',
        defaultValue: '0016l2F430zMux',
      },
    ],
  },
  getComments: {
    description: 'Get comment list by content and pagination identifiers.',
  },
  getMvPlay: {
    description: 'Get MV playable stream URLs by video ID.',
  },
};

export const createApiExplorerEndpoint = (
  route: ApiExplorerBaseRoute,
  override: Partial<ApiExplorerEndpoint> = {},
): ApiExplorerEndpoint => {
  const generatedQueryParams = extractRouteParams(route.routePath);

  return {
    id: createApiExplorerId(route.name),
    name: route.name,
    category: route.category,
    description: `Call ${route.name} endpoint.`,
    method: route.method,
    routePath: route.routePath,
    path: stripRouteParams(route.routePath),
    queryParams: generatedQueryParams.length ? generatedQueryParams : undefined,
    ...override,
  };
};

export const apiExplorerEndpoints: ApiExplorerEndpoint[] = apiExplorerBaseRoutes.map((route) =>
  createApiExplorerEndpoint(route, apiExplorerOverrides[route.name]),
);

export const apiExplorerMetadata: ApiExplorerMetadata = {
  title: 'QQ Music API Explorer',
  description:
    'A lightweight local API explorer for quick request testing, parameter input, and response preview.',
  endpoints: apiExplorerEndpoints,
};
