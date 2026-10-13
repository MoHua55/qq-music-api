import {
  MUSICU_ENDPOINT,
  networkError,
  useLegacyRouteUpstream,
} from './helpers/legacyRouteUpstream';

describe('POST /batchGetSongInfo', () => {
  const upstream = useLegacyRouteUpstream();
  it('requests each song in input order and preserves each complete response', async () => {
    const first = {
      code: 0,
      songinfo: { code: 0, data: { track_info: { mid: 'synthetic-first', id: 90001 } } },
    };
    const second = { code: 0, songinfo: { code: 104400, data: {} } };
    upstream.respond(first, second);
    const response = await upstream.post('/batchGetSongInfo', {
      songs: [['synthetic-first', '90001'], ['synthetic-second']],
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 200, data: [first, second] });
    expect(upstream.calls).toHaveLength(2);
    for (const [index, [song_mid, song_id]] of [
      ['synthetic-first', '90001'],
      ['synthetic-second', ''],
    ].entries()) {
      expect(upstream.calls[index]).toMatchObject({
        endpoint: MUSICU_ENDPOINT,
        method: 'get',
        params: { format: 'json' },
        payload: {
          comm: { ct: 24, cv: 0 },
          songinfo: {
            module: 'music.pf_song_detail_svr',
            method: 'get_song_detail_yqq',
            param: { song_type: 0, song_mid, song_id },
          },
        },
      });
    }
  });
  it.each([
    {},
    { songs: [] },
  ])('returns an empty batch without contacting upstream', async (body) => {
    const response = await upstream.post('/batchGetSongInfo', body);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 200, data: [] });
    expect(upstream.calls).toHaveLength(0);
  });
  it('keeps the existing 500 for a malformed batch', async () => {
    const response = await upstream.post('/batchGetSongInfo', { songs: 'invalid' });
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Service request failed' });
    expect(upstream.calls).toHaveLength(0);
  });
  it('propagates a failed item without retrying or fabricating batch data', async () => {
    upstream.fail(networkError());
    const response = await upstream.post('/batchGetSongInfo', { songs: [['synthetic-first']] });
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Upstream request failed (ECONNRESET)' });
    expect(upstream.calls).toHaveLength(1);
  });
  it('returns the existing whole-batch failure when a successful item is followed by transport failure', async () => {
    upstream.respondWith(
      {
        body: { code: 0, songinfo: { code: 0, data: { track_info: { mid: 'synthetic-first' } } } },
      },
      { error: networkError() },
    );
    const response = await upstream.post('/batchGetSongInfo', {
      songs: [['synthetic-first'], ['synthetic-second']],
    });
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Upstream request failed (ECONNRESET)' });
    expect(upstream.calls).toHaveLength(2);
    expect(upstream.calls.map((call) => call.payload)).toEqual([
      {
        comm: { ct: 24, cv: 0 },
        songinfo: {
          module: 'music.pf_song_detail_svr',
          method: 'get_song_detail_yqq',
          param: { song_type: 0, song_mid: 'synthetic-first', song_id: '' },
        },
      },
      {
        comm: { ct: 24, cv: 0 },
        songinfo: {
          module: 'music.pf_song_detail_svr',
          method: 'get_song_detail_yqq',
          param: { song_type: 0, song_mid: 'synthetic-second', song_id: '' },
        },
      },
    ]);
  });
  it('requires POST rather than issuing upstream requests for GET', async () => {
    const response = await upstream.get('/batchGetSongInfo');
    expect(response.status).toBe(405);
    expect(upstream.calls).toHaveLength(0);
  });
});
