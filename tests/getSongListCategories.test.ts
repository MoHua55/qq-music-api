import { legacyCgiContract } from './helpers/legacyCgiContract';

legacyCgiContract({
  route: '/getSongListCategories',
  endpoint: '/splcloud/fcgi-bin/fcg_get_diss_tag_conf.fcg',
  params: {
    format: 'json',
    outCharset: 'utf-8',
  },
  reply: {
    code: 0,
    data: {
      categories: [
        {
          items: [
            {
              categoryId: 90001,
              categoryName: 'Synthetic Category',
            },
          ],
        },
      ],
    },
  },
});
