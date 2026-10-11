import {
  CATALOG_RUNTIMES,
  callRoute,
  MUSICU_URL,
  useCatalogUpstream,
} from './helpers/catalogRoutes';

const albums = {
  code: 0,
  singer: { code: 0, data: { list: [{ album_mid: 'fixture-album-a' }], total: 1 } },
};

const albumCall = (singermid: string, begin: number, num: number) => ({
  endpoint: MUSICU_URL,
  format: 'json',
  singermid,
  payload: {
    comm: { ct: 24, cv: 0 },
    singer: {
      method: 'GetAlbumList',
      param: { sort: 5, singermid, begin, num },
      module: 'music.musichallAlbum.AlbumListServer',
    },
  },
});

// The two hosts already answer a missing singermid with different 400 bodies; both are kept.
const missingSingerBody = {
  node: { response: 'no singermid' },
  serverless: { data: { message: 'no singermid' } },
};

describe.each(CATALOG_RUNTIMES)('GET /getSingerAlbum (%s)', (runtime) => {
  const upstream = useCatalogUpstream(runtime);

  it('passes the upstream reply through unchanged', async () => {
    upstream.respond(albums);

    const result = await callRoute(runtime, '/getSingerAlbum?singermid=fixture-singer');

    expect(result).toEqual({ status: 200, body: { response: albums } });
    expect(upstream.calls).toEqual([albumCall('fixture-singer', 0, 5)]);
  });

  it('maps limit and page to num and begin', async () => {
    upstream.respond(albums);

    await callRoute(runtime, '/getSingerAlbum?singermid=fixture-singer&limit=20&page=3');

    expect(upstream.calls).toEqual([albumCall('fixture-singer', 3, 20)]);
  });

  // limit arrives as the string '0', which is truthy, so it is sent as num 0 rather than the default.
  it('keeps the existing handling of limit=0 and page=-1', async () => {
    upstream.respond(albums);

    await callRoute(runtime, '/getSingerAlbum?singermid=fixture-singer&limit=0&page=-1');

    expect(upstream.calls).toEqual([albumCall('fixture-singer', -1, 0)]);
  });

  // Folia reads `response.code` and `response.singer.code` here, so a rejection has to stay inside
  // an HTTP 200 body instead of turning into another status.
  it('keeps an upstream rejection inside a 200 body', async () => {
    const rejected = { code: 0, singer: { code: 104003, data: {} } };
    upstream.respond(rejected);

    const result = await callRoute(runtime, '/getSingerAlbum?singermid=fixture-singer');

    expect(result).toEqual({ status: 200, body: { response: rejected } });
  });

  it.each([
    '/getSingerAlbum',
    '/getSingerAlbum?id=invalid_!@#',
  ])('answers 400 without calling upstream for %s', async (path) => {
    const result = await callRoute(runtime, path);

    expect(result).toEqual({ status: 400, body: missingSingerBody[runtime] });
    expect(upstream.calls).toEqual([]);
  });

  it('answers the safe 500 when the upstream cannot be reached', async () => {
    upstream.fail(Object.assign(new Error('fixture-private-message'), { code: 'ECONNRESET' }));

    const result = await callRoute(runtime, '/getSingerAlbum?singermid=fixture-singer');

    expect(result).toEqual({
      status: 500,
      body: { error: 'Upstream request failed (ECONNRESET)' },
    });
  });
});
