import { legacyCgiContract } from './helpers/legacyCgiContract';
import { useLegacyRouteUpstream } from './helpers/legacyRouteUpstream';

legacyCgiContract({
  route: '/getTopLists',
  endpoint: '/v8/fcg-bin/fcg_myqq_toplist.fcg',
  params: {
    format: 'json',
    outCharset: 'utf-8',
    platform: 'h5',
    needNewCode: 1,
  },
  reply: {
    code: 0,
    data: {
      topList: [
        {
          id: 90001,
          topTitle: 'Synthetic Chart',
        },
      ],
    },
  },
});

describe('GET /getTopLists JSONP', () => {
  const upstream = useLegacyRouteUpstream();
  it('decodes a JSONP chart response', async () => {
    const reply = { code: 0, data: { topList: [{ id: 90001, topTitle: 'Synthetic Chart' }] } };
    upstream.respond(`MusicJsonCallback(${JSON.stringify(reply)})`);
    const response = await upstream.get('/getTopLists');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ response: reply });
    expect(upstream.calls).toHaveLength(1);
  });
  it('returns a safe parse error for invalid JSONP', async () => {
    upstream.respond('MusicJsonCallback({invalid})');
    const response = await upstream.get('/getTopLists');
    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: { name: 'SyntaxError', message: 'Service request failed' },
    });
    expect(upstream.calls).toHaveLength(1);
  });
});
