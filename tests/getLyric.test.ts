import {
  CGI_ENDPOINT,
  NETWORK_ERROR_BODY,
  networkError,
  useLegacyRouteUpstream,
} from './helpers/legacyRouteUpstream';

describe('GET /getLyric', () => {
  const upstream = useLegacyRouteUpstream();
  const lyric = '[ti:Synthetic Song]\n[00:01.25]synthetic line';
  const reply = {
    code: 0,
    lyric: Buffer.from(lyric).toString('base64'),
    trans: 'synthetic translation',
  };
  it('decodes base64 lyrics and preserves other upstream fields', async () => {
    upstream.respond(reply);
    const response = await upstream.get('/getLyric?songmid=synthetic-song');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ response: { ...reply, lyric } });
    expect(upstream.calls).toEqual([
      {
        endpoint: `${CGI_ENDPOINT}/lyric/fcgi-bin/fcg_query_lyric_new.fcg`,
        method: 'get',
        params: {
          songmid: 'synthetic-song',
          format: 'json',
          outCharset: 'utf-8',
          pcachetime: expect.any(Number),
        },
      },
    ]);
  });
  it.each(['true', '1'])('formats lyrics for isFormat=%s', async (format) => {
    upstream.respond(reply);
    const response = await upstream.get(`/getLyric?songmid=synthetic-song&isFormat=${format}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      response: {
        ...reply,
        lyric: {
          lyric,
          tags: { title: 'Synthetic Song', artist: '', album: '', offset: '', by: '' },
          lines: [{ time: 1250, txt: 'synthetic line' }],
        },
      },
    });
    expect(upstream.calls).toHaveLength(1);
  });
  it('keeps business failure without inventing lyrics', async () => {
    upstream.respond({ code: 987654 });
    const response = await upstream.get('/getLyric?songmid=synthetic-song');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ response: { code: 987654 } });
  });
  it('formats missing lyric data into the existing empty lyric object', async () => {
    upstream.respond({ code: 0 });
    const response = await upstream.get('/getLyric?songmid=synthetic-song&isFormat=true');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      response: {
        code: 0,
        lyric: {
          lyric: '',
          tags: { title: '', artist: '', album: '', offset: '', by: '' },
          lines: [],
        },
      },
    });
    expect(upstream.calls).toHaveLength(1);
  });
  it('returns the safe transport failure without retrying', async () => {
    upstream.fail(networkError());
    const response = await upstream.get('/getLyric?songmid=synthetic-song');
    expect(response.status).toBe(500);
    expect(response.body).toEqual(NETWORK_ERROR_BODY);
    expect(upstream.calls).toHaveLength(1);
  });
  it('rejects a missing song ID before contacting upstream', async () => {
    const response = await upstream.get('/getLyric');
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ response: 'no songmid' });
    expect(upstream.calls).toHaveLength(0);
  });
  it('preserves the existing rejection of a path-only song ID', async () => {
    const response = await upstream.get('/getLyric/synthetic-song');
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ response: 'no songmid' });
    expect(upstream.calls).toHaveLength(0);
  });
});
