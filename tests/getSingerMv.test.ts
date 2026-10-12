import { legacyCgiContract } from './helpers/legacyCgiContract';
import { useLegacyRouteUpstream } from './helpers/legacyRouteUpstream';

legacyCgiContract({
  route: '/getSingerMv',
  path: '/getSingerMv?singermid=synthetic-singer&order=time&num=3',
  endpoint: '/mv/fcgi-bin/fcg_singer_mv.fcg',
  params: {
    singermid: 'synthetic-singer',
    order: 'time',
    num: '3',
    cmd: 1,
    format: 'json',
    outCharset: 'utf-8',
    cid: 205360581,
    begin: 0,
  },
  reply: {
    code: 0,
    data: {
      list: [
        {
          vid: 'synthetic-video',
          name: 'Synthetic MV',
        },
      ],
    },
  },
  missing: {
    status: 400,
    body: {
      response: 'no singermid',
    },
  },
});

describe('GET /getSingerMv order', () => {
  const upstream = useLegacyRouteUpstream();
  it('keeps the default count and omits cmd for listen order', async () => {
    upstream.respond({ code: 0, data: { list: [] } });
    const response = await upstream.get('/getSingerMv?singermid=synthetic-singer&order=listen');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ response: { code: 0, data: { list: [] } } });
    expect(upstream.calls[0].params).toEqual({
      singermid: 'synthetic-singer',
      order: 'listen',
      num: 5,
      format: 'json',
      outCharset: 'utf-8',
      cid: 205360581,
      begin: 0,
    });
  });
});
