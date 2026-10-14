import { QqApiError } from '../../protocol/errors';
import type { AuthSession } from '../auth/qrLogin';
import { isDictionary } from '../auth/values';
import { type NewRouteResult, okResult } from '../recommend/newRouteResult';
import { createSessionMusicuClient, type SessionMusicuOptions } from '../recommend/sessionMusicu';
import { ordinaryOwnedPlaylistOf, ownedPlaylistsDescriptor } from './ownedPlaylist';
import { failedPlaylistWrite, playlistWriteResultOf } from './playlistManagement';
import { exactObjectOf, positiveIntegerOf } from './writeInput';

interface EditValues {
  title: string;
  desc: string;
  picurl: string;
  picurl2: string;
  tag: Array<{ id: number; name: string }>;
  dir_show: 1 | 2;
}
const editValuesOf = (data: unknown, dirId: number): EditValues => {
  if (!isDictionary(data) || !isDictionary(data.dirinfo)) throw new QqApiError('invalid-response');
  const value = data.dirinfo;
  if (
    value.dirid !== dirId ||
    typeof value.title !== 'string' ||
    typeof value.desc !== 'string' ||
    typeof value.picurl !== 'string' ||
    value.picurl2 !== '' ||
    (value.dir_show !== 1 && value.dir_show !== 2) ||
    !Array.isArray(value.tag) ||
    value.tag.length > 3
  )
    throw new QqApiError('invalid-response');
  // 非空第二封面尚无写后保留实测，不能用静态映射保证此设置不变。
  const tag = value.tag.map((item) => {
    if (
      !isDictionary(item) ||
      typeof item.id !== 'number' ||
      !positiveIntegerOf(item.id) ||
      typeof item.name !== 'string'
    )
      throw new QqApiError('invalid-response');
    return { id: item.id, name: item.name };
  });
  return {
    title: value.title,
    desc: value.desc,
    picurl: value.picurl,
    picurl2: '',
    tag,
    dir_show: value.dir_show,
  };
};
const editReadDescriptor = (dirId: number) => ({
  module: 'music.srfDissInfo.aiDissInfo',
  method: 'uniform_get_Dissinfo',
  param: { dirid: dirId, optype: 3, tag: 1, userinfo: 0, pic_dpi: 300 },
  readOnly: true,
  operation: 'playlist.edit-read' as const,
});

export const playlistRenameResult = async (
  session: AuthSession | null,
  raw: unknown,
  options: SessionMusicuOptions = {},
): Promise<NewRouteResult> => {
  let writeAttempted = false;
  const known: Record<string, number> = {};
  try {
    if (!session) throw new QqApiError('auth-missing');
    const input = exactObjectOf(raw, ['tid', 'name']);
    const tid = positiveIntegerOf(input.tid),
      name = input.name;
    if (
      !tid ||
      typeof name !== 'string' ||
      !name.trim() ||
      [...name].length > 20 ||
      [...name].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    )
      throw new QqApiError('input');
    const client = createSessionMusicuClient(session, options);
    const { dirId } = ordinaryOwnedPlaylistOf(
      await client.execute(ownedPlaylistsDescriptor(session)),
      tid,
      session,
    );
    Object.assign(known, { tid, dirId });
    const descriptor = editReadDescriptor(dirId);
    const before = editValuesOf(await client.execute(descriptor), dirId);
    writeAttempted = true;
    const result = playlistWriteResultOf(
      await client.execute({
        module: 'music.musicasset.PlaylistBaseWrite',
        method: 'EditPlaylist',
        param: {
          dirId,
          mask: 95,
          dirNewName: name,
          dirNewDesc: before.desc,
          dirNewPicUrl: before.picurl,
          dirNewPicUrl2: before.picurl2,
          dirNewtaglist: before.tag.map((item) => item.id).join(','),
          dirShow: before.dir_show,
        },
        readOnly: false,
        operation: 'playlist.rename',
      }),
    );
    if (positiveIntegerOf(result.dirId) !== dirId || positiveIntegerOf(result.tid) !== tid)
      throw new QqApiError('invalid-response');
    const after = editValuesOf(await client.execute(descriptor), dirId);
    if (
      after.title !== name ||
      after.desc !== before.desc ||
      after.picurl !== before.picurl ||
      after.picurl2 !== before.picurl2 ||
      after.dir_show !== before.dir_show ||
      JSON.stringify(after.tag) !== JSON.stringify(before.tag)
    )
      throw new QqApiError('invalid-response');
    return okResult({ tid, name: after.title, verified: true });
  } catch (error) {
    return failedPlaylistWrite('playlist-rename', error, writeAttempted, known);
  }
};
