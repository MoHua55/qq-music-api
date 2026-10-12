import { legacyCgiContract } from './helpers/legacyCgiContract';
import { useLegacyRouteUpstream } from './helpers/legacyRouteUpstream';

legacyCgiContract({
  route: '/getSearchByKey',
  path: '/getSearchByKey?key=synthetic&limit=3&page=2&catZhida=2&remoteplace=album',
  endpoint: '/soso/fcgi-bin/client_search_cp',
  params: {
    w: 'synthetic',
    n: 3,
    p: 2,
    catZhida: 2,
    format: 'json',
    outCharset: 'utf-8',
    ct: 24,
    qqmusic_ver: 1298,
    new_json: 1,
    remoteplace: 'txt.yqq.song',
    t: 0,
    aggr: 1,
    cr: 1,
    lossless: 0,
    flag_qc: 0,
    platform: 'yqq.json',
  },
  reply: {
    code: 0,
    data: {
      song: {
        list: [
          {
            mid: 'synthetic-song',
            name: 'Synthetic Song',
          },
        ],
      },
    },
  },
  missing: {
    status: 400,
    body: {
      response: 'search key is null',
    },
  },
});

describe('GET /getSearchByKey defaults', () => {
  const upstream = useLegacyRouteUpstream();
  it.each([
    '',
    '&limit=0&page=0&catZhida=0',
    '&limit=invalid&page=invalid&catZhida=invalid',
  ])('uses current defaults for %s', async (suffix) => {
    upstream.respond({ code: 0, data: { song: { list: [] } } });
    const response = await upstream.get(`/getSearchByKey?key=synthetic${suffix}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ response: { code: 0, data: { song: { list: [] } } } });
    expect(upstream.calls[0].params).toMatchObject({
      w: 'synthetic',
      n: 10,
      p: 1,
      catZhida: 1,
      remoteplace: 'txt.yqq.song',
    });
  });
});
