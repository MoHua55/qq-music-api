import { legacyMusicuContract } from './helpers/legacyMusicuContract';
import { useLegacyRouteUpstream } from './helpers/legacyRouteUpstream';

legacyMusicuContract({
  route: '/getSingerList',
  path: '/getSingerList?area=1&sex=0&genre=2&index=3&page=2',
  payload: {
    comm: { ct: 24, cv: 0 },
    singerList: {
      module: 'Music.SingerListServer',
      method: 'get_singer_list',
      param: { area: 1, sex: 0, genre: 2, index: 3, sin: 80, cur_page: 2 },
    },
  },
  reply: {
    code: 0,
    singerList: { code: 0, data: { singerlist: [{ singer_mid: 'synthetic-singer' }] } },
  },
  bodyStatus: 200,
});

describe('GET /getSingerList defaults', () => {
  const upstream = useLegacyRouteUpstream();
  it('uses all filters and the first page by default', async () => {
    upstream.respond({ code: 0, singerList: { code: 0, data: { singerlist: [] } } });
    await upstream.get('/getSingerList').expect(200);
    expect(upstream.calls[0].payload).toMatchObject({
      singerList: {
        param: {
          area: -100,
          sex: -100,
          genre: -100,
          index: -100,
          sin: 0,
          cur_page: 1,
        },
      },
    });
  });
});
