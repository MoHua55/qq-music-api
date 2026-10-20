import { QqApiError } from '../../protocol/errors';
import { isDictionary } from '../../util/values';
import type { AuthSession } from '../auth/qrLogin';
import { failureResult, type NewRouteResult, okResult } from '../recommend/newRouteResult';
import { createSessionMusicuClient, type SessionMusicuOptions } from '../recommend/sessionMusicu';
import { exactObjectOf, positiveIntegerOf } from './writeInput';

export const songLikeResult = async (
  session: AuthSession | null,
  raw: unknown,
  options: SessionMusicuOptions = {},
): Promise<NewRouteResult> => {
  try {
    if (!session) throw new QqApiError('auth-missing');
    const input = exactObjectOf(raw, ['song', 'liked']);
    const song = exactObjectOf(input.song, ['id', 'mid', 'type']);
    if (
      typeof song.id !== 'number' ||
      positiveIntegerOf(song.id) === undefined ||
      typeof song.mid !== 'string' ||
      !/^[A-Za-z0-9]{1,64}$/.test(song.mid) ||
      song.type !== 0 ||
      typeof input.liked !== 'boolean'
    )
      throw new QqApiError('input');
    const id = song.id,
      mid = song.mid,
      liked = input.liked;
    const client = createSessionMusicuClient(session, { ...options, maxRetries: 0 });
    // 用已存在的详情协议核对关系；关联读不到时不猜、不执行写入。
    const track = await client.execute({
      module: 'music.pf_song_detail_svr',
      method: 'get_song_detail_yqq',
      param: { song_type: 0, song_mid: mid },
      readOnly: true,
      operation: 'song.identity-check',
      decode: (data) => {
        if (!isDictionary(data) || !isDictionary(data.track_info))
          throw new QqApiError('invalid-response');
        return data.track_info;
      },
    });
    if (positiveIntegerOf(track.id) === undefined || typeof track.mid !== 'string')
      throw new QqApiError('invalid-response');
    // 读取条目的 type/songtype 不是写入 songType 的编码，输入类型已单独验证为 0。
    if (positiveIntegerOf(track.id) !== id || track.mid !== mid) throw new QqApiError('input');
    const read = () =>
      client.execute({
        module: 'music.musicasset.SongFavRead',
        method: 'IsSongFanByMid',
        param: { v_songMid: [mid] },
        readOnly: true,
        operation: 'subscription.song-status',
        decode: (data) => {
          if (
            !isDictionary(data) ||
            !isDictionary(data.m_fan) ||
            typeof data.m_fan[mid] !== 'boolean'
          )
            throw new QqApiError('invalid-response');
          return data.m_fan[mid] as boolean;
        },
      });
    if ((await read()) === liked) return okResult({ liked });
    await client.execute({
      module: 'music.musicasset.PlaylistDetailWrite',
      method: liked ? 'AddSonglist' : 'DelSonglist',
      param: { dirId: 201, v_songInfo: [{ songId: id, songType: 0 }] },
      readOnly: false,
      operation: liked ? 'song.like' : 'song.unlike',
      decode: (data) => {
        if (!isDictionary(data) || data.retCode !== 0 || !isDictionary(data.result))
          throw new QqApiError('invalid-response');
        const result = data.result;
        if (
          !(result.dirId === 201 && positiveIntegerOf(result.tid) !== undefined) &&
          !(result.dirId === 0 && (result.tid === 0 || result.tid === '0'))
        )
          throw new QqApiError('invalid-response');
        return undefined;
      },
    });
    if ((await read()) !== liked) throw new QqApiError('invalid-response');
    return okResult({ liked });
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
    const result = failureResult('song-like', safe);
    return { ...result, body: { ...(result.body as Record<string, unknown>), retryable: false } };
  }
};
