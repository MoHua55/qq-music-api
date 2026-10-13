import {
  NETWORK_ERROR_BODY,
  networkError,
  useLegacyRouteUpstream,
} from './helpers/legacyRouteUpstream';

describe('GET /downloadQQMusic', () => {
  const upstream = useLegacyRouteUpstream();
  const reply = {
    code: 0,
    data: { pc: { url: 'https://download.example.test/synthetic-installer' } },
  };
  it.each([
    reply,
    `MusicJsonCallback(${JSON.stringify(reply)})`,
  ])('returns download metadata from JSON or JSONP', async (body) => {
    upstream.respond(body);
    const response = await upstream.get('/downloadQQMusic');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ response: reply });
    expect(upstream.calls).toEqual([
      {
        endpoint: 'https://y.qq.com/download/download.js',
        method: 'get',
        params: {
          format: 'jsonp',
          jsonpCallback: 'MusicJsonCallback',
          platform: 'yqq',
        },
      },
    ]);
  });
  it('preserves an unknown business failure in a successful HTTP response', async () => {
    const body = { code: 987654, data: {} };
    upstream.respond(body);
    const response = await upstream.get('/downloadQQMusic');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ response: body });
    expect(upstream.calls).toHaveLength(1);
  });
  it('returns a safe error when malformed JSONP fails to parse', async () => {
    upstream.respond('MusicJsonCallback({invalid})');
    const response = await upstream.get('/downloadQQMusic');
    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: { name: 'SyntaxError', message: 'Service request failed' },
    });
    expect(upstream.calls).toHaveLength(1);
  });
  it('returns the safe transport failure without retrying', async () => {
    upstream.fail(networkError());
    const response = await upstream.get('/downloadQQMusic');
    expect(response.status).toBe(500);
    expect(response.body).toEqual(NETWORK_ERROR_BODY);
    expect(upstream.calls).toHaveLength(1);
  });
  it('does not register the old test filename as a route', async () => {
    const response = await upstream.get('/getDownloadQQMusic');
    expect(response.status).toBe(404);
    expect(upstream.calls).toHaveLength(0);
  });
  it('requires GET and does not request download metadata for POST', async () => {
    const response = await upstream.post('/downloadQQMusic', {});
    expect(response.status).toBe(405);
    expect(upstream.calls).toHaveLength(0);
  });
});
