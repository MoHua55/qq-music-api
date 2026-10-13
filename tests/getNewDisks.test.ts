import { legacyMusicuContract } from './helpers/legacyMusicuContract';
import { useLegacyRouteUpstream } from './helpers/legacyRouteUpstream';

legacyMusicuContract({
  route: '/getNewDisks',
  path: '/getNewDisks?page=3&limit=4',
  payload: {
    comm: { ct: 24, cv: 0 },
    new_album: {
      module: 'newalbum.NewAlbumServer',
      method: 'get_new_album_info',
      param: { area: 1, start: 8, num: 4 },
    },
  },
  reply: { code: 0, new_album: { code: 0, data: { album_list: [{ mid: 'synthetic-album' }] } } },
  bodyStatus: 200,
});

describe('GET /getNewDisks first page', () => {
  const upstream = useLegacyRouteUpstream();
  it.each([
    '/getNewDisks',
    '/getNewDisks?page=0&limit=0',
  ])('uses the area operation for %s', async (path) => {
    const reply = { code: 0, new_album: { code: 0, data: { area: [{ id: 1 }] } } };
    upstream.respond(reply);
    const response = await upstream.get(path);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 200, response: reply });
    expect(upstream.calls[0].payload).toEqual({
      comm: { ct: 24, cv: 0 },
      new_album: {
        module: 'newalbum.NewAlbumServer',
        method: 'get_new_album_area',
        param: { area: 1, start: 0, num: 0 },
      },
    });
  });
});
