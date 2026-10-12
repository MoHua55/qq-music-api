import { legacyCgiContract } from './helpers/legacyCgiContract';

legacyCgiContract({
  route: '/getSmartbox',
  path: '/getSmartbox?key=synthetic',
  endpoint: '/splcloud/fcgi-bin/smartbox_new.fcg',
  params: {
    key: 'synthetic',
    format: 'json',
    outCharset: 'utf-8',
    is_xml: 0,
  },
  reply: {
    code: 0,
    data: {
      song: {
        itemlist: [
          {
            mid: 'synthetic-song',
            name: 'Synthetic Song',
          },
        ],
      },
    },
  },
  missing: {
    status: 200,
    body: {
      response: null,
    },
  },
});
