import {
  CATALOG_RUNTIMES,
  callRoute,
  MUSICU_URL,
  useCatalogUpstream,
} from './helpers/catalogRoutes';

const songinfo = {
  code: 0,
  songinfo: { code: 0, data: { track_info: { mid: 'fixture-song-a', name: 'Fixture song A' } } },
};

const songCall = (param: Record<string, unknown>) => ({
  endpoint: MUSICU_URL,
  format: 'json',
  payload: {
    comm: { ct: 24, cv: 0 },
    songinfo: {
      method: 'get_song_detail_yqq',
      param: { song_type: 0, ...param },
      module: 'music.pf_song_detail_svr',
    },
  },
});

describe.each(CATALOG_RUNTIMES)('GET /getSongInfo (%s)', (runtime) => {
  const upstream = useCatalogUpstream(runtime);

  it('passes the upstream reply through unchanged for the path form Folia uses', async () => {
    upstream.respond(songinfo);

    const result = await callRoute(runtime, '/getSongInfo/fixture-song-a/42');

    expect(result).toEqual({ status: 200, body: { response: songinfo } });
    expect(upstream.calls).toEqual([songCall({ song_mid: 'fixture-song-a', song_id: '42' })]);
  });

  it('sends an empty song_id when only the songmid is given', async () => {
    upstream.respond(songinfo);

    await callRoute(runtime, '/getSongInfo/fixture-song-a');

    expect(upstream.calls).toEqual([songCall({ song_mid: 'fixture-song-a', song_id: '' })]);
  });

  it('prefers path parameters over query parameters', async () => {
    upstream.respond(songinfo);

    await callRoute(runtime, '/getSongInfo/fixture-song-a?songmid=fixture-song-b&songid=7');

    expect(upstream.calls).toEqual([songCall({ song_mid: 'fixture-song-a', song_id: '7' })]);
  });

  it('forwards an unusual songmid as an opaque string', async () => {
    upstream.respond(songinfo);

    await callRoute(runtime, `/getSongInfo/${encodeURIComponent('invalid_!@#')}`);

    expect(upstream.calls).toEqual([songCall({ song_mid: 'invalid_!@#', song_id: '' })]);
  });

  // Folia reads `response.songinfo.data.track_info`; an upstream rejection stays inside a 200 body.
  it('keeps an upstream rejection inside a 200 body', async () => {
    const rejected = { code: 0, songinfo: { code: 104003, data: {} } };
    upstream.respond(rejected);

    const result = await callRoute(runtime, '/getSongInfo/fixture-song-a');

    expect(result).toEqual({ status: 200, body: { response: rejected } });
  });

  it('answers the safe 500 when the upstream cannot be reached', async () => {
    upstream.fail(Object.assign(new Error('fixture-private-message'), { code: 'ECONNRESET' }));

    const result = await callRoute(runtime, '/getSongInfo/fixture-song-a');

    expect(result).toEqual({
      status: 500,
      body: { error: 'Upstream request failed (ECONNRESET)' },
    });
  });
});

// Without any songmid the two hosts already differ: Node still asks upstream (the parameter is
// optional in its route), serverless has no matching route. Both are pinned so a refactor that
// changes either one is a visible decision.
describe('GET /getSongInfo without a songmid', () => {
  describe('node', () => {
    const upstream = useCatalogUpstream('node');

    it('asks upstream without a song_mid', async () => {
      upstream.respond(songinfo);

      const result = await callRoute('node', '/getSongInfo');

      expect(result).toEqual({ status: 200, body: { response: songinfo } });
      expect(upstream.calls).toEqual([songCall({ song_id: '' })]);
    });
  });

  describe('serverless', () => {
    const upstream = useCatalogUpstream('serverless');

    it('answers that the route is not implemented', async () => {
      const result = await callRoute('serverless', '/getSongInfo');

      expect(result.status).toBe(501);
      expect(result.body).toEqual({
        code: 501,
        message:
          '/getSongInfo is not implemented by the serverless runtime. See /login/channels for what this deployment serves.',
      });
      expect(upstream.calls).toEqual([]);
    });
  });
});
