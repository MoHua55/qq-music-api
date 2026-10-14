import { QqApiError } from '../../protocol/errors';
import type { MusicuDescriptor } from '../../protocol/musicu';
import { credentialMusicId } from '../auth/androidDevice';
import type { AuthSession } from '../auth/qrLogin';
import { isDictionary } from '../auth/values';
import { failureResult, type NewRouteResult, okResult } from '../recommend/newRouteResult';
import { createSessionMusicuClient, type SessionMusicuOptions } from '../recommend/sessionMusicu';
import { exactObjectOf, playlistSongOf, positiveIntegerOf } from './writeInput';

const ownedList = (session: AuthSession): MusicuDescriptor<unknown[]> => ({
  module: 'music.musicasset.PlaylistBaseRead',
  method: 'GetPlaylistByUin',
  param: { uin: credentialMusicId(session.credential) },
  readOnly: true,
  operation: 'playlist.owned-list',
  decode: (data) => {
    if (!isDictionary(data) || !Array.isArray(data.v_playlist))
      throw new QqApiError('invalid-response');
    return data.v_playlist;
  },
});

export const playlistTracksResult = async (
  session: AuthSession | null,
  raw: unknown,
  options: SessionMusicuOptions = {},
): Promise<NewRouteResult> => {
  try {
    if (!session) throw new QqApiError('auth-missing');
    const input = exactObjectOf(raw, ['tid', 'op', 'songs']);
    const tid = positiveIntegerOf(input.tid);
    if (
      !tid ||
      typeof input.op !== 'string' ||
      !['add', 'del'].includes(input.op) ||
      !Array.isArray(input.songs) ||
      input.songs.length < 1 ||
      input.songs.length > 100
    )
      throw new QqApiError('input');
    const songs = input.songs.map(playlistSongOf);
    const client = createSessionMusicuClient(session, options);
    const created = await client.execute(ownedList(session));
    const matched = created.filter(
      (item) => isDictionary(item) && positiveIntegerOf(item.tid) === tid,
    );
    if (matched.length !== 1 || !isDictionary(matched[0])) throw new QqApiError('input');
    const playlist = matched[0];
    const dirId = positiveIntegerOf(playlist.dirId);
    // 3.3.0 只接受自建清单中已知普通目录。系统目录或未知目录不尝试写入。
    if (!dirId || dirId >= 200 || (playlist.dirType !== undefined && playlist.dirType !== 0))
      throw new QqApiError('input');
    const add = input.op === 'add';
    const data = await client.execute({
      module: 'music.musicasset.PlaylistDetailWrite',
      method: add ? 'AddSonglist' : 'DelSonglist',
      param: { dirId, v_songInfo: songs },
      readOnly: false,
      operation: add ? 'playlist.add-songs' : 'playlist.del-songs',
      decode: (value) => {
        if (!isDictionary(value) || value.retCode !== 0 || !isDictionary(value.result))
          throw new QqApiError('invalid-response');
        return value.result;
      },
    });
    const changed = data.dirId === dirId && positiveIntegerOf(data.tid) === tid;
    if (!changed && !(data.dirId === 0 && (data.tid === 0 || data.tid === '0')))
      throw new QqApiError('invalid-response');
    if (!Array.isArray(data.songlist)) throw new QqApiError('invalid-response');
    const statuses = add
      ? data.songlist.map((item) => {
          if (
            !isDictionary(item) ||
            !songs.some((song) => song.songId === item.songId) ||
            ![0, 1].includes(item.existed as number)
          )
            throw new QqApiError('invalid-response');
          return { id: item.songId, existed: item.existed === 1 };
        })
      : undefined;
    if (
      statuses &&
      (statuses.length !== songs.length ||
        songs.some((song) => statuses.filter((item) => item.id === song.songId).length !== 1))
    )
      throw new QqApiError('invalid-response');
    return okResult({ changed, ...(statuses ? { songs: statuses } : {}) });
  } catch (error) {
    return failureResult('playlist-track-write', error);
  }
};
