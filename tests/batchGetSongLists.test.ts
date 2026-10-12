import { CGI_ENDPOINT, networkError, useLegacyRouteUpstream } from './helpers/legacyRouteUpstream';

describe('POST /batchGetSongLists', () => {
  const upstream = useLegacyRouteUpstream();
  it('requests each category and preserves the existing numeric-zero response wrapper', async () => {
    const first = { code: 0, data: { list: [{ dissid: 'synthetic-playlist' }] } };
    const second = { code: 987654, data: {} };
    upstream.respond(first, second);
    const response = await upstream.post('/batchGetSongLists', {
      categoryIds: [90001, 90002],
      page: 2,
      limit: 7,
      sortId: 4,
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 200, data: [first, second] });
    expect(upstream.calls).toHaveLength(2);
    for (const [index, categoryId] of [90001, 90002].entries()) {
      expect(upstream.calls[index]).toEqual({
        endpoint: `${CGI_ENDPOINT}/splcloud/fcgi-bin/fcg_get_diss_by_tag.fcg`,
        method: 'get',
        params: {
          sortId: 4,
          sin: 2,
          ein: 7,
          categoryId,
          format: 'json',
          outCharset: 'utf-8',
          picmid: 1,
        },
      });
    }
  });
  it('unwraps data only for the existing string-zero success branch', async () => {
    upstream.respond({ code: '0', data: { list: [] } });
    const response = await upstream.post('/batchGetSongLists', {});
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 200, data: [{ list: [] }] });
    expect(upstream.calls[0].params).toEqual({
      sortId: 5,
      sin: 0,
      ein: 19,
      categoryId: 10000000,
      format: 'json',
      outCharset: 'utf-8',
      picmid: 1,
    });
  });
  it('returns an empty category batch without contacting upstream', async () => {
    const response = await upstream.post('/batchGetSongLists', { categoryIds: [] });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 200, data: [] });
    expect(upstream.calls).toHaveLength(0);
  });
  it('preserves the existing null item when a service transport fails', async () => {
    upstream.fail(networkError());
    const response = await upstream.post('/batchGetSongLists', { categoryIds: [90001] });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 200, data: [null] });
    expect(upstream.calls).toHaveLength(1);
  });
  it('keeps the existing 500 for a malformed category batch', async () => {
    const response = await upstream.post('/batchGetSongLists', { categoryIds: 'invalid' });
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Service request failed' });
    expect(upstream.calls).toHaveLength(0);
  });
  it('keeps successful items and a transport-failed null item in their input positions', async () => {
    const first = { list: [{ dissid: 'synthetic-first' }] };
    const third = { code: 0, data: { list: [{ dissid: 'synthetic-third' }] } };
    upstream.respondWith(
      { body: { code: '0', data: first } },
      { error: networkError() },
      { body: third },
    );
    const response = await upstream.post('/batchGetSongLists', {
      categoryIds: [90001, 90002, 90003],
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 200, data: [first, null, third] });
    expect(upstream.calls).toHaveLength(3);
    expect(upstream.calls.map((call) => call.params.categoryId)).toEqual([90001, 90002, 90003]);
  });
  it('requires POST rather than issuing upstream requests for GET', async () => {
    const response = await upstream.get('/batchGetSongLists');
    expect(response.status).toBe(405);
    expect(upstream.calls).toHaveLength(0);
  });
});
