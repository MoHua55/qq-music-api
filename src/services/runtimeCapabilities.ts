import type { RuntimeCapabilities } from './auth/qrLogin';

export type BackendRuntime = 'node' | 'serverless';

// These flags describe implemented backend methods, independent of login or upstream availability.
// Keep client-only predicates and diagnostics out of this declaration.
const featuresFor = (runtime: BackendRuntime) => ({
  user: { getVip: true },
  playlistManagement: { createPlaylist: true, renamePlaylist: true, deletePlaylist: true },
  auth: {
    getLoginStatus: true,
    logout: true,
    getQrKey: true,
    createQr: true,
    checkQr: true,
    cancelQr: true,
  },
  library: {
    getUserPlaylists: true,
    getUserAlbums: true,
    getLikedSongIds: true,
    getLikedSongs: true,
    getCloudCollection: false,
  },
  catalog: {
    getPlaylistTracks: true,
    getPlaylistDetail: false,
    getAlbumDetail: true,
    getAlbumTracks: true,
    getArtistDetail: true,
    getArtistSongs: true,
    getArtistAlbums: true,
    getCloudTracks: false,
    getSubscriptionStatus: true,
  },
  playback: {
    getSongDetail: true,
    getAudioSource: true,
    getReplacement: false,
    preview: true,
  },
  search: { searchSongs: runtime === 'node' },
  lyrics: { getLyrics: runtime === 'node', getChorusRanges: false },
  recommendations: {
    getPersonalFm: true,
    getDailySongs: true,
    getRecommendedCollections: true,
    getHistoryEntries: false,
    getHistoryDates: false,
    getHistorySongs: false,
    dislikeSong: false,
    personalFmModes: true,
    getPlaylistCategories: true,
    getCategoryPlaylists: true,
    getNewSongs: true,
  },
  radio: { getRadioList: true, getRadioTracks: true },
  mutations: {
    updatePlaylistTracks: true,
    likeSong: true,
    subscribePlaylist: true,
    subscribeAlbum: true,
  },
  playbackReports: { reportPlayback: false },
});

export type BackendFeatures = ReturnType<typeof featuresFor>;

export interface BackendCapabilityDeclaration extends RuntimeCapabilities {
  readonly configured: boolean;
  readonly features: BackendFeatures;
}

/** Shared wire shape; existing channel order, session mode and configuration meaning stay intact. */
export const describeRuntimeCapabilities = (
  runtime: BackendRuntime,
  capabilities: RuntimeCapabilities,
  configured: boolean,
): BackendCapabilityDeclaration => ({
  channels: [...capabilities.channels],
  sessionMode: capabilities.sessionMode,
  configured,
  features: featuresFor(runtime),
});
