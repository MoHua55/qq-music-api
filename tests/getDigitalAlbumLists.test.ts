import { legacyCgiContract } from './helpers/legacyCgiContract';

legacyCgiContract({
  route: '/getDigitalAlbumLists',
  endpoint: '/v8/fcg-bin/musicmall.fcg',
  params: {
    format: 'json',
    outCharset: 'utf-8',
    cmd: 'pc_index_new',
  },
  reply: {
    code: 0,
    data: {
      albumlist: [
        {
          album_mid: 'synthetic-album',
          album_name: 'Synthetic Album',
        },
      ],
    },
  },
});
