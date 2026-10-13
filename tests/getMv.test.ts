import { legacyMusicuContract } from './helpers/legacyMusicuContract';

legacyMusicuContract({
  route: '/getMv',
  path: '/getMv?area_id=1&version_id=2&limit=3&page=2',
  payload: {
    comm: { ct: 24 },
    mv_tag: { module: 'MvService.MvInfoProServer', method: 'GetAllocTag', param: {} },
    mv_list: {
      module: 'MvService.MvInfoProServer',
      method: 'GetAllocMvInfo',
      param: { start: 3, limit: 3, version_id: '2', area_id: '1', order: 1 },
    },
  },
  reply: {
    code: 0,
    mv_tag: { code: 0, data: { area: [{ id: 1 }] } },
    mv_list: { code: 0, data: { list: [{ vid: 'synthetic-video' }] } },
  },
  missing: { response: 'version_id or area_id is null' },
});
