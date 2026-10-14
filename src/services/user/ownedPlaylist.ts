import { QqApiError } from '../../protocol/errors';
import type { MusicuDescriptor } from '../../protocol/musicu';
import { credentialMusicId } from '../auth/androidDevice';
import type { AuthSession } from '../auth/qrLogin';
import { isDictionary } from '../auth/values';
import { positiveIntegerOf } from './writeInput';

export const ownedPlaylistsDescriptor = (session: AuthSession): MusicuDescriptor<unknown[]> => ({
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
/** 只在本人自建清单的唯一对应中选择已知普通目录；不接受收藏条目的目录号。 */
export const ordinaryOwnedPlaylistOf = (list: unknown[], tid: number, session: AuthSession) => {
  const matches = list.filter((item) => isDictionary(item) && positiveIntegerOf(item.tid) === tid);
  if (matches.length !== 1 || !isDictionary(matches[0])) throw new QqApiError('input');
  const entry = matches[0];
  const dirId = positiveIntegerOf(entry.dirId);
  const ownIds = [
    credentialMusicId(session.credential),
    String(session.credential.musicid),
    String(session.credential.str_musicid),
  ];
  if (
    !dirId ||
    dirId >= 200 ||
    (entry.dirType !== undefined && entry.dirType !== 0) ||
    (entry.uin !== undefined && !ownIds.includes(String(entry.uin)))
  )
    throw new QqApiError('input');
  return { entry, dirId };
};
