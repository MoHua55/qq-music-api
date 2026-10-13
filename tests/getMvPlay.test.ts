import {
  MUSICU_ENDPOINT,
  networkError,
  useLegacyRouteUpstream,
} from './helpers/legacyRouteUpstream';

describe('GET /getMvPlay', () => {
  const upstream = useLegacyRouteUpstream();
  const required = [
    'vid',
    'type',
    'sid',
    'cover_pic',
    'duration',
    'singers',
    'video_switch',
    'msg',
    'name',
    'desc',
    'playcnt',
    'pubdate',
    'isfav',
    'gmid',
  ];
  const reply = {
    code: 0,
    getMVUrl: {
      code: 0,
      data: {
        'synthetic-video': {
          mp4: [
            {
              freeflow_url: [
                'https://video.example.test/clip.f10.mp4',
                'https://video.example.test/clip.f30.mp4',
              ],
            },
          ],
          hls: [
            {
              freeflow_url: [
                'https://video.example.test/clip.f20.mp4',
                'https://video.example.test/clip.f40.mp4',
                'https://video.example.test/clip.m3u8',
              ],
            },
          ],
        },
      },
    },
    mvinfo: { code: 0, data: { 'synthetic-video': { name: 'Synthetic MV' } } },
    other: { code: 0, data: { list: [] } },
  };
  it('requests URLs, metadata and recommendations and groups the returned qualities', async () => {
    upstream.respond(reply);
    const response = await upstream.get('/getMvPlay?vid=synthetic-video');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      response: {
        ...reply,
        playLists: {
          f10: ['https://video.example.test/clip.f10.mp4'],
          f20: ['https://video.example.test/clip.f20.mp4'],
          f30: ['https://video.example.test/clip.f30.mp4'],
          f40: ['https://video.example.test/clip.f40.mp4'],
        },
      },
    });
    expect(upstream.calls).toHaveLength(1);
    expect(upstream.calls[0]).toMatchObject({
      endpoint: MUSICU_ENDPOINT,
      method: 'get',
      payload: {
        comm: { ct: 24, cv: 4747474 },
        getMVUrl: {
          module: 'gosrf.Stream.MvUrlProxy',
          method: 'GetMvUrls',
          param: { vids: ['synthetic-video'], request_typet: 10001 },
        },
        mvinfo: {
          module: 'video.VideoDataServer',
          method: 'get_video_info_batch',
          param: { vidlist: ['synthetic-video'], required },
        },
        other: {
          module: 'video.VideoLogicServer',
          method: 'rec_video_byvid',
          param: {
            vid: 'synthetic-video',
            required: [
              ...required,
              'uploader_headurl',
              'uploader_nick',
              'uploader_encuin',
              'uploader_uin',
              'uploader_hasfollow',
              'uploader_follower_num',
            ],
            support: 1,
          },
        },
      },
    });
  });
  it('returns empty quality lists when upstream supplies empty URL arrays', async () => {
    const body = {
      code: 0,
      getMVUrl: { code: 0, data: { 'synthetic-video': { mp4: [], hls: [] } } },
    };
    upstream.respond(body);
    const response = await upstream.get('/getMvPlay?vid=synthetic-video');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      response: { ...body, playLists: { f10: [], f20: [], f30: [], f40: [] } },
    });
    expect(upstream.calls).toHaveLength(1);
  });
  it('keeps a business rejection with valid URL structure as HTTP 200', async () => {
    const body = {
      code: 0,
      getMVUrl: { code: 987654, data: { 'synthetic-video': { mp4: [], hls: [] } } },
    };
    upstream.respond(body);
    const response = await upstream.get('/getMvPlay?vid=synthetic-video');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      response: { ...body, playLists: { f10: [], f20: [], f30: [], f40: [] } },
    });
  });
  it('keeps the existing 500 when a rejected response has no URL structure', async () => {
    upstream.respond({ code: 500003 });
    const response = await upstream.get('/getMvPlay?vid=synthetic-video');
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Service request failed' });
    expect(upstream.calls).toHaveLength(1);
  });
  it('propagates transport failure without retrying', async () => {
    upstream.fail(networkError());
    const response = await upstream.get('/getMvPlay?vid=synthetic-video');
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Upstream request failed (ECONNRESET)' });
    expect(upstream.calls).toHaveLength(1);
  });
  it('rejects a missing video ID before contacting upstream', async () => {
    const response = await upstream.get('/getMvPlay');
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ response: 'vid is null' });
    expect(upstream.calls).toHaveLength(0);
  });
});
