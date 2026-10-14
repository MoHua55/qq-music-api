import { QqApiError } from '../../protocol/errors';
import type { AuthSession } from '../auth/qrLogin';
import { isDictionary } from '../auth/values';
import { failureResult, type NewRouteResult, okResult } from '../recommend/newRouteResult';
import { createSessionMusicuClient, type SessionMusicuOptions } from '../recommend/sessionMusicu';
import { ordinaryOwnedPlaylistOf, ownedPlaylistsDescriptor } from './ownedPlaylist';
import { exactObjectOf, positiveIntegerOf } from './writeInput';

export const playlistWriteResultOf = (data: unknown): Record<string, unknown> => {
  if (!isDictionary(data) || data.retCode !== 0 || !isDictionary(data.result))
    throw new QqApiError('invalid-response');
  return data.result;
};
export const failedPlaylistWrite = (
  phase: 'playlist-create' | 'playlist-delete' | 'playlist-rename',
  error: unknown,
  writeAttempted: boolean,
  known: Record<string, number>,
): NewRouteResult => {
  const result = failureResult(phase, error);
  return {
    ...result,
    body: {
      ...(result.body as Record<string, unknown>),
      retryable: false,
      ...(writeAttempted ? { writeAttempted: true, verification: 'unconfirmed', ...known } : {}),
    },
  };
};

export const playlistCreateResult = async (
  session: AuthSession | null,
  raw: unknown,
  options: SessionMusicuOptions = {},
): Promise<NewRouteResult> => {
  let writeAttempted = false;
  const known: Record<string, number> = {};
  try {
    if (!session) throw new QqApiError('auth-missing');
    const input = exactObjectOf(raw, ['name']);
    const name = input.name;
    if (
      typeof name !== 'string' ||
      !name.trim() ||
      [...name].length > 20 ||
      [...name].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    )
      throw new QqApiError('input');
    const client = createSessionMusicuClient(session, options);
    writeAttempted = true;
    const data = await client.execute({
      module: 'music.musicasset.PlaylistBaseWrite',
      method: 'AddPlaylist',
      param: { dirName: name },
      readOnly: false,
      operation: 'playlist.create',
    });
    const result = playlistWriteResultOf(data);
    const tid = positiveIntegerOf(result.tid),
      dirId = positiveIntegerOf(result.dirId);
    if (!tid || !dirId || dirId >= 200) throw new QqApiError('invalid-response');
    Object.assign(known, { tid, dirId });
    const list = await client.execute(ownedPlaylistsDescriptor(session));
    let read: ReturnType<typeof ordinaryOwnedPlaylistOf>;
    try {
      read = ordinaryOwnedPlaylistOf(list, tid, session);
    } catch {
      throw new QqApiError('invalid-response');
    }
    if (read.dirId !== dirId || typeof read.entry.dirName !== 'string')
      throw new QqApiError('invalid-response');
    const moderation: Record<string, boolean | number> = Object.fromEntries(
      ['bSafetyHitName', 'bSafetyHitDesc'].flatMap((key) =>
        typeof result[key] === 'boolean' ? [[key, result[key]]] : [],
      ),
    );
    if (isDictionary(data))
      for (const key of ['hit_type', 'hit_reason'])
        if (typeof data[key] === 'number' && Number.isSafeInteger(data[key]))
          moderation[key] = data[key];
    return okResult({
      tid,
      dirId,
      name: read.entry.dirName,
      verified: true,
      ...(Object.keys(moderation).length ? { moderation } : {}),
    });
  } catch (error) {
    return failedPlaylistWrite('playlist-create', error, writeAttempted, known);
  }
};

export const playlistDeleteResult = async (
  session: AuthSession | null,
  raw: unknown,
  options: SessionMusicuOptions = {},
): Promise<NewRouteResult> => {
  let writeAttempted = false;
  const known: Record<string, number> = {};
  try {
    if (!session) throw new QqApiError('auth-missing');
    const input = exactObjectOf(raw, ['tid']);
    const tid = positiveIntegerOf(input.tid);
    if (!tid) throw new QqApiError('input');
    const client = createSessionMusicuClient(session, options);
    const { dirId } = ordinaryOwnedPlaylistOf(
      await client.execute(ownedPlaylistsDescriptor(session)),
      tid,
      session,
    );
    Object.assign(known, { tid, dirId });
    writeAttempted = true;
    const result = playlistWriteResultOf(
      await client.execute({
        module: 'music.musicasset.PlaylistBaseWrite',
        method: 'DelPlaylist',
        param: { dirId },
        readOnly: false,
        operation: 'playlist.delete',
      }),
    );
    if (
      positiveIntegerOf(result.dirId) !== dirId ||
      positiveIntegerOf(result.tid) !== tid ||
      result.updateTime !== 0
    )
      throw new QqApiError('invalid-response');
    const read = await client.execute(ownedPlaylistsDescriptor(session));
    if (
      read.some(
        (item) =>
          isDictionary(item) &&
          (positiveIntegerOf(item.tid) === tid || positiveIntegerOf(item.dirId) === dirId),
      )
    )
      throw new QqApiError('invalid-response');
    return okResult({ tid, deleted: true, verified: true });
  } catch (error) {
    return failedPlaylistWrite('playlist-delete', error, writeAttempted, known);
  }
};
