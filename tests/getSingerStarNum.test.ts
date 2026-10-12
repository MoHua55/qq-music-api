import { legacyCgiContract } from './helpers/legacyCgiContract';

legacyCgiContract({
  route: '/getSingerStarNum',
  path: '/getSingerStarNum?singermid=synthetic-singer',
  endpoint: '/rsc/fcgi-bin/fcg_order_singer_getnum.fcg',
  params: {
    singermid: 'synthetic-singer',
    format: 'json',
    outCharset: 'utf-8',
    utf8: 1,
    rnd: expect.any(Number),
  },
  reply: {
    code: 0,
    num: 42,
  },
  missing: {
    status: 400,
    body: {
      response: 'no singermid',
    },
  },
});
