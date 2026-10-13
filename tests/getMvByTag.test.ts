import { legacyCgiContract } from './helpers/legacyCgiContract';

legacyCgiContract({
  route: '/getMvByTag',
  endpoint: '/mv/fcgi-bin/getmv_by_tag',
  params: {
    format: 'json',
    outCharset: 'GB2312',
    cmd: 'shoubo',
    lan: 'all',
  },
  reply: {
    code: 0,
    data: {
      mvlist: [
        {
          vid: 'synthetic-video',
          name: 'Synthetic MV',
        },
      ],
    },
  },
});
