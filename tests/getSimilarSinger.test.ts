import { legacyCgiContract } from './helpers/legacyCgiContract';

legacyCgiContract({
  route: '/getSimilarSinger',
  path: '/getSimilarSinger?singermid=synthetic-singer',
  endpoint: '/v8/fcg-bin/fcg_v8_simsinger.fcg',
  params: {
    singer_mid: 'synthetic-singer',
    format: 'json',
    outCharset: 'utf-8',
    utf8: 1,
    start: 0,
    num: 5,
  },
  reply: {
    code: 0,
    singers: {
      items: [
        {
          mid: 'synthetic-neighbor',
          name: 'Synthetic Singer',
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
