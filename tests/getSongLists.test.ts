import { legacyCgiContract } from './helpers/legacyCgiContract';
import { useLegacyRouteUpstream } from './helpers/legacyRouteUpstream';

legacyCgiContract({
  route: '/getSongLists',
  path: '/getSongLists?page=2&limit=3&sortId=4&categoryId=90001',
  endpoint: '/splcloud/fcgi-bin/fcg_get_diss_by_tag.fcg',
  params: {
    categoryId: '90001',
    sortId: '4',
    sin: 6,
    ein: 8,
    picmid: 1,
    format: 'json',
    outCharset: 'utf-8',
  },
  reply: {
    code: 0,
    data: {
      list: [
        {
          dissid: 'synthetic-playlist',
          dissname: 'Synthetic Playlist',
        },
      ],
    },
  },
});

describe('GET /getSongLists defaults and JSONP', () => {
  const upstream = useLegacyRouteUpstream();
  it.each([
    '/getSongLists',
    '/getSongLists?page=0&limit=20',
  ])('uses the initial inclusive range for %s', async (path) => {
    const reply = { code: 0, data: { list: [] } };
    upstream.respond(`MusicJsonCallback(${JSON.stringify(reply)})`);
    const response = await upstream.get(path);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ response: reply });
    expect(upstream.calls[0].params).toMatchObject({
      categoryId: 10000000,
      sortId: 5,
      sin: 0,
      ein: 19,
    });
  });
  it('returns a safe error when JSONP contains invalid JSON', async () => {
    upstream.respond('MusicJsonCallback({invalid})');
    const response = await upstream.get('/getSongLists');
    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: { name: 'SyntaxError', message: 'Service request failed' },
    });
    expect(upstream.calls).toHaveLength(1);
  });
});
