import { legacyCgiContract } from './helpers/legacyCgiContract';

legacyCgiContract({
  route: '/getRadioLists',
  endpoint: '/v8/fcg-bin/fcg_v8_radiolist.fcg',
  params: {
    format: 'json',
    outCharset: 'utf-8',
    channel: 'radio',
    page: 'index',
    tpl: 'wk',
    'new': 1,
    p: 1,
  },
  reply: {
    code: 0,
    data: {
      radioList: [
        {
          id: 90001,
          name: 'Synthetic Radio',
        },
      ],
    },
  },
});
