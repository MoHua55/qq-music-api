import { useLegacyRouteUpstream } from './helpers/legacyRouteUpstream';

describe('GET /getImageUrl', () => {
  const upstream = useLegacyRouteUpstream();
  it.each([
    [
      '/getImageUrl?id=synthetic-album',
      'https://y.gtimg.cn/music/photo_new/T002R300x300M000synthetic-album.jpg?max_age=2592000',
    ],
    [
      '/getImageUrl?id=synthetic-album&size=500x500&maxAge=60',
      'https://y.gtimg.cn/music/photo_new/T002R500x500M000synthetic-album.jpg?max_age=60',
    ],
  ])('constructs the image URL locally for %s', async (path, imageUrl) => {
    const response = await upstream.get(path);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ response: { code: 0, data: { imageUrl } } });
    expect(upstream.calls).toHaveLength(0);
  });
  it('rejects a missing ID without requesting an image', async () => {
    const response = await upstream.get('/getImageUrl');
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ response: 'no id~~' });
    expect(upstream.calls).toHaveLength(0);
  });
});
