import { legacyCgiContract } from './helpers/legacyCgiContract';

legacyCgiContract({
  route: '/getHotkey',
  endpoint: '/splcloud/fcgi-bin/gethotkey.fcg',
  params: {
    format: 'json',
    outCharset: 'utf-8',
    hostUin: 0,
    needNewCode: 0,
  },
  reply: {
    code: 0,
    data: {
      hotkey: [
        {
          k: 'synthetic keyword',
          n: 9,
        },
      ],
    },
  },
});
