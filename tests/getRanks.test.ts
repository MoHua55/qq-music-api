import { legacyMusicuContract } from './helpers/legacyMusicuContract';

legacyMusicuContract({
  route: '/getRanks',
  path: '/getRanks?topId=90001&limit=3&page=4&period=2024-01-08',
  payload: {
    comm: expect.objectContaining({
      ct: 24,
      cv: 4747474,
      format: 'json',
      inCharset: 'utf-8',
      needNewCode: 1,
      uin: 0,
    }),
    req_1: {
      module: 'musicToplist.ToplistInfoServer',
      method: 'GetDetail',
      param: { topId: 90001, num: 3, offset: 4, period: '2024_2' },
    },
  },
  reply: { code: 0, req_1: { code: 0, data: { song: [{ mid: 'synthetic-song', rank: 1 }] } } },
});
