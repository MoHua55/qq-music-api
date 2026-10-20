import { QqApiError } from '../../protocol/errors';
import { isDictionary } from '../../util/values';
import type { AuthSession } from '../auth/qrLogin';
import { failureResult, type NewRouteResult, okResult } from '../recommend/newRouteResult';
import { createSessionMusicuClient, type SessionMusicuOptions } from '../recommend/sessionMusicu';
import { albumOwnerOf } from './albumOwner';
import { exactObjectOf } from './writeInput';

export const albumSubscribeResult = async (
  session: AuthSession | null,
  raw: unknown,
  options: SessionMusicuOptions = {},
): Promise<NewRouteResult> => {
  try {
    if (!session) throw new QqApiError('auth-missing');
    const input = exactObjectOf(raw, ['id', 'subscribed']);
    if (
      typeof input.id !== 'string' ||
      !/^[A-Za-z0-9]{1,64}$/.test(input.id) ||
      typeof input.subscribed !== 'boolean'
    )
      throw new QqApiError('input');
    const id = input.id,
      subscribed = input.subscribed;
    const { uin, statusUin } = albumOwnerOf(session.credential);
    const client = createSessionMusicuClient(session, { ...options, maxRetries: 0 });
    const read = () =>
      client.execute({
        module: 'music.musicasset.AlbumFavRead',
        method: 'IsAlbumFan',
        param: { uin: statusUin, v_albumMid: [id] },
        readOnly: true,
        operation: 'subscription.album-status',
        decode: (data) => {
          if (
            !isDictionary(data) ||
            !isDictionary(data.m_fan) ||
            typeof data.m_fan[id] !== 'boolean'
          )
            throw new QqApiError('invalid-response');
          return data.m_fan[id] as boolean;
        },
      });
    if ((await read()) === subscribed) return okResult({ subscribed });
    await client.execute({
      module: 'music.musicasset.AlbumFavWrite',
      method: subscribed ? 'FavAlbum' : 'CancelFavAlbum',
      param: { uin, v_albumMid: [id] },
      readOnly: false,
      operation: subscribed ? 'album.subscribe' : 'album.unsubscribe',
      decode: (data) => {
        if (
          !isDictionary(data) ||
          data.result !== 0 ||
          !Array.isArray(data.v_failedAlbumId) ||
          data.v_failedAlbumId.length ||
          !Array.isArray(data.v_failedAlbumMid) ||
          data.v_failedAlbumMid.length
        )
          throw new QqApiError('invalid-response');
        return undefined;
      },
    });
    if ((await read()) !== subscribed) throw new QqApiError('invalid-response');
    return okResult({ subscribed });
  } catch (error) {
    const safe =
      error instanceof QqApiError
        ? error.kind === 'rate-limited'
          ? new QqApiError('upstream-business', {
              ...error.toJSON(),
              errorKey: 'upstream.unknown',
              retryable: false,
            })
          : error
        : new QqApiError('invalid-response');
    const result = failureResult('album-subscribe', safe);
    return { ...result, body: { ...(result.body as Record<string, unknown>), retryable: false } };
  }
};
