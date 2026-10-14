import type { UpstreamOperation } from '../../protocol/businessCodes';
import { QqApiError } from '../../protocol/errors';
import { credentialMusicId } from '../auth/androidDevice';
import type { AuthSession } from '../auth/qrLogin';
import { isDictionary } from '../auth/values';
import { failureResult, type NewRouteResult, okResult } from '../recommend/newRouteResult';
import { createSessionMusicuClient, type SessionMusicuOptions } from '../recommend/sessionMusicu';
import { albumOwnerOf } from './albumOwner';
import { exactObjectOf, positiveIntegerOf } from './writeInput';

export const playlistSubscribeResult = async (
  session: AuthSession | null,
  raw: unknown,
  options: SessionMusicuOptions = {},
): Promise<NewRouteResult> => {
  try {
    if (!session) throw new QqApiError('auth-missing');
    const input = exactObjectOf(raw, ['tid', 'subscribed']);
    const tid = positiveIntegerOf(input.tid);
    if (!tid || typeof input.subscribed !== 'boolean') throw new QqApiError('input');
    await createSessionMusicuClient(session, options).execute({
      module: 'music.musicasset.PlaylistFavWrite',
      method: input.subscribed ? 'FavPlaylist' : 'CancelFavPlaylist',
      param: { uin: credentialMusicId(session.credential), v_playlistId: [tid] },
      readOnly: false,
      operation: input.subscribed ? 'playlist.subscribe' : 'playlist.unsubscribe',
      decode: (data) => {
        if (
          !isDictionary(data) ||
          !Array.isArray(data.v_failedPlaylistId) ||
          typeof data.result !== 'number'
        )
          throw new QqApiError('invalid-response');
        if (data.result !== 0 || data.v_failedPlaylistId.length)
          throw new QqApiError('upstream-business');
        return undefined;
      },
    });
    return okResult({ subscribed: input.subscribed });
  } catch (error) {
    return failureResult('playlist-subscribe', error);
  }
};

/** 三类各自有 Android 多 id 的实测；新增类型需自己的协议及验证，不能通用替换参数名。 */
const STATUS_PROTOCOLS: Record<
  string,
  {
    module: string;
    method: string;
    operation: UpstreamOperation;
    param: (ids: string[], session: AuthSession) => Record<string, unknown>;
  }
> = {
  playlist: {
    module: 'music.musicasset.PlaylistFavRead',
    method: 'IsPlaylistFan',
    operation: 'subscription.playlist-status',
    param: (ids) => ({ v_tid: ids.map(Number) }),
  },
  album: {
    module: 'music.musicasset.AlbumFavRead',
    method: 'IsAlbumFan',
    operation: 'subscription.album-status',
    param: (ids, session) => {
      return { uin: albumOwnerOf(session.credential).statusUin, v_albumMid: ids };
    },
  },
  song: {
    module: 'music.musicasset.SongFavRead',
    method: 'IsSongFanByMid',
    operation: 'subscription.song-status',
    param: (ids) => ({ v_songMid: ids }),
  },
};

export const subscriptionStatusResult = async (
  session: AuthSession | null,
  type: unknown,
  rawIds: unknown,
  options: SessionMusicuOptions = {},
): Promise<NewRouteResult> => {
  try {
    if (!session) throw new QqApiError('auth-missing');
    const protocol =
      typeof type === 'string' && Object.hasOwn(STATUS_PROTOCOLS, type)
        ? STATUS_PROTOCOLS[type]
        : undefined;
    if (!protocol || typeof rawIds !== 'string') throw new QqApiError('input');
    const requested = rawIds.split(',');
    if (
      !requested.length ||
      requested.length > 100 ||
      requested.some((id) =>
        type === 'playlist' ? positiveIntegerOf(id) === undefined : !/^[A-Za-z0-9]{1,64}$/.test(id),
      )
    )
      throw new QqApiError('input');
    const ids = [
      ...new Set(requested.map((id) => (type === 'playlist' ? String(positiveIntegerOf(id)) : id))),
    ];
    const fan = await createSessionMusicuClient(session, options).execute({
      module: protocol.module,
      method: protocol.method,
      operation: protocol.operation,
      param: protocol.param(ids, session),
      readOnly: true,
      decode: (data) => {
        if (!isDictionary(data) || !isDictionary(data.m_fan))
          throw new QqApiError('invalid-response');
        return data.m_fan;
      },
    });
    return okResult({
      type,
      items: ids.map((id) => ({
        id,
        status: fan[id] === true ? 'subscribed' : fan[id] === false ? 'not-subscribed' : 'unknown',
      })),
    });
  } catch (error) {
    return failureResult('subscription-status', error);
  }
};
