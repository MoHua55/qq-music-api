import { legacyMusicuContract } from './helpers/legacyMusicuContract';

legacyMusicuContract({
  route: '/getTicketInfo',
  payload: {
    comm: { ct: 24, cv: 0 },
    getFirstData: {
      module: 'mall.ticket_index_page_svr',
      method: 'GetTicketIndexPage',
      param: { city_id: -1 },
    },
    getTag: { module: 'mall.ticket_index_page_svr', method: 'GetShowTypeList', param: {} },
  },
  reply: {
    code: 0,
    getFirstData: { code: 0, data: { shows: [{ id: 90001 }] } },
    getTag: { code: 0, data: { tags: [{ id: 2 }] } },
  },
});
