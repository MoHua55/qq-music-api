import { QqApiError } from '../src/protocol/errors';
import type { HttpRequest } from '../src/protocol/http';
import { createMusicuClient } from '../src/protocol/musicu';
import { createTokenBucket } from '../src/protocol/tokenBucket';
import {
  PLAYBACK_OBSERVATIONS,
  PLAYLIST_WRITE_OBSERVATION,
  VIP_OBSERVATIONS,
} from './fixtures/protocol/negativeResponses';

describe('synthetic protocol observations through the real musicu decoder', () => {
  it.each(PLAYBACK_OBSERVATIONS)('preserves entry-level observations for $name', async ({
    response,
  }) => {
    const http = jest.fn(async (_request: HttpRequest) => ({ status: 200, body: response }));
    const client = createMusicuClient({ http, comm: {}, limiter: createTokenBucket() });
    const data = await client.execute({
      module: 'music.vkey.GetEVkey',
      method: 'GetUrl',
      param: { songmid: response.req_0.data.midurlinfo.map((item) => item.songmid) },
      readOnly: true,
    });
    expect(data).toEqual(response.req_0.data);
    expect(http).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(http.mock.calls[0][0].body);
    expect(sent.req_0.method).toBe('GetUrl');
  });

  // The VIP service is not registered yet. This guards raw decoding, not membership semantics.
  it.each(VIP_OBSERVATIONS)('preserves raw VIP fields without inventing isSvip for $name', async ({
    response,
  }) => {
    const http = jest.fn(async () => ({ status: 200, body: response }));
    const data = await createMusicuClient({ http, comm: {} }).execute({
      module: 'userInfo.VipQueryServer',
      method: 'SRFVipQuery_V2',
      param: { uin_list: ['10000'] },
      readOnly: true,
    });
    expect(data).toEqual(response.req_0.data);
    expect(data).not.toHaveProperty('isSvip');
    expect(http).toHaveBeenCalledTimes(1);
  });

  it('rejects business 2001 despite retCode 0 and never replays a playlist write', async () => {
    const http = jest.fn(async () => ({ status: 200, body: PLAYLIST_WRITE_OBSERVATION }));
    const client = createMusicuClient({ http, comm: {}, maxRetries: 2 });
    const failure = await client
      .execute({
        module: 'music.musicasset.PlaylistDetailWrite',
        method: 'DelSonglist',
        param: { dirId: 10, tid: 70001, bFmtUtf8: true, v_songInfo: [{ songId: 42, songType: 0 }] },
        operation: 'playlist.del-songs',
        readOnly: false,
      })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(QqApiError);
    // 删歌时见过的 2001 只登记为「见过、意思未知」：不是成功，也不是限流。
    expect(failure).toMatchObject({
      kind: 'upstream-business',
      errorKey: 'upstream.unknown',
      evidence: 'observed-response',
      upstreamCode: 2001,
      upstreamGlobalCode: 0,
      retryable: false,
    });
    expect(failure).not.toHaveProperty('retryAfterMs', expect.any(Number));
    expect(http).toHaveBeenCalledTimes(1);
  });
});
