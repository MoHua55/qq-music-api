import type { RuntimeCapabilities } from './auth/qrLogin';

export type BackendRuntime = 'node' | 'serverless';

// These flags describe implemented backend methods, independent of login or upstream availability.
// Keep client-only predicates and diagnostics out of this declaration.
const featuresFor = (runtime: BackendRuntime) => ({
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
    getSubscriptionStatus: false,
  },
  playback: {
    getSongDetail: true,
    getAudioSource: true,
    getReplacement: false,
  },
  search: { searchSongs: runtime === 'node' },
  lyrics: { getLyrics: runtime === 'node', getChorusRanges: false },
  recommendations: {
    getPersonalFm: true,
    getDailySongs: false,
    getRecommendedCollections: true,
    getHistoryEntries: false,
    getHistoryDates: false,
    getHistorySongs: false,
    dislikeSong: false,
    personalFmModes: true,
  },
  radio: { getRadioList: true, getRadioTracks: true },
  mutations: {
    updatePlaylistTracks: false,
    likeSong: false,
    subscribePlaylist: false,
    subscribeAlbum: false,
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
