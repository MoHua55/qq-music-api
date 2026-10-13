import {
  CATALOG_RUNTIMES,
  callRoute,
  MUSICU_URL,
  useCatalogUpstream,
} from './helpers/catalogRoutes';

const hotsongs = {
  code: 0,
  singer: { code: 0, data: { songlist: [{ mid: 'fixture-song-a' }], total_song: 1 } },
};

const hotsongCall = (singermid: string, sin: number, num: number) => ({
  endpoint: MUSICU_URL,
  format: 'json',
  singermid,
  payload: {
    comm: { ct: 24, cv: 0 },
    singer: {
      method: 'get_singer_detail_info',
      param: { sort: 5, singermid, sin, num },
      module: 'music.web_singer_info_svr',
    },
  },
});

// The two hosts already answer a missing singermid with different 400 bodies; both are kept.
const missingSingerBody = {
  node: { response: 'no singermid' },
  serverless: { data: { message: 'no singermid' } },
};

describe.each(CATALOG_RUNTIMES)('GET /getSingerHotsong (%s)', (runtime) => {
  const upstream = useCatalogUpstream(runtime);

  it('passes the upstream reply through unchanged', async () => {
    upstream.respond(hotsongs);

    const result = await callRoute(runtime, '/getSingerHotsong?singermid=fixture-singer');

    expect(result).toEqual({ status: 200, body: { response: hotsongs } });
    // The offset is (page - 1) * num, so the default page 0 sends a negative offset. That is the
    // existing upstream request and is kept as-is here.
    expect(upstream.calls).toEqual([hotsongCall('fixture-singer', -5, 5)]);
  });

  it('maps limit and page to num and sin', async () => {
    upstream.respond(hotsongs);

    await callRoute(runtime, '/getSingerHotsong?singermid=fixture-singer&limit=20&page=3');

    expect(upstream.calls).toEqual([hotsongCall('fixture-singer', 40, 20)]);
  });

  // limit arrives as the string '0', which is truthy, so it is sent as num 0 rather than the default.
  it('keeps the existing handling of limit=0 and page=-1', async () => {
    upstream.respond(hotsongs);

    await callRoute(runtime, '/getSingerHotsong?singermid=fixture-singer&limit=0&page=-1');

    expect(upstream.calls).toEqual([hotsongCall('fixture-singer', 0, 0)]);
  });

  // Folia reads `response.code` and `response.singer.code` here, so a rejection has to stay inside
  // an HTTP 200 body instead of turning into another status.
  it('keeps an upstream rejection inside a 200 body', async () => {
    const rejected = { code: 0, singer: { code: 104003, data: {} } };
    upstream.respond(rejected);

    const result = await callRoute(runtime, '/getSingerHotsong?singermid=fixture-singer');

    expect(result).toEqual({ status: 200, body: { response: rejected } });
  });

  it.each([
    '/getSingerHotsong',
    '/getSingerHotsong?id=invalid_!@#',
  ])('answers 400 without calling upstream for %s', async (path) => {
    const result = await callRoute(runtime, path);

    expect(result).toEqual({ status: 400, body: missingSingerBody[runtime] });
    expect(upstream.calls).toEqual([]);
  });

  it('answers the safe 500 when the upstream cannot be reached', async () => {
    upstream.fail(Object.assign(new Error('fixture-private-message'), { code: 'ECONNRESET' }));

    const result = await callRoute(runtime, '/getSingerHotsong?singermid=fixture-singer');

    expect(result).toEqual({
      status: 500,
      body: { error: 'Upstream request failed (ECONNRESET)' },
    });
  });
});
