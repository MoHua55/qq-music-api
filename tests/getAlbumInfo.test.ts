import request from 'supertest';
import app from '../src/app';
import { CATALOG_RUNTIMES, callRoute, useCatalogUpstream } from './helpers/catalogRoutes';

const server = app.callback();

describe('GET /getAlbumInfo', () => {
  it('正常流程: 缺少 albummid 时返回 400', async () => {
    const response = await request(server).get('/getAlbumInfo');
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      data: {
        message: 'no albummid',
      },
    });
  });

  it('边界条件: 传入无关参数时仍返回 400', async () => {
    const response = await request(server).get('/getAlbumInfo?limit=0&page=-1');
    expect(response.status).toBe(400);
  });

  it('异常输入: 传入错误字段名时返回 400', async () => {
    const response = await request(server).get('/getAlbumInfo?id=invalid_!@#');
    expect(response.status).toBe(400);
  });
});

const album = {
  code: 0,
  data: { mid: 'fixture-album', name: 'Fixture album', list: [{ songmid: 'fixture-song-a' }] },
};

const albumCall = (albummid: string) => ({
  endpoint: 'https://c.y.qq.com/v8/fcg-bin/fcg_v8_album_info_cp.fcg',
  params: { albummid, format: 'json', outCharset: 'utf-8' },
});

describe.each(CATALOG_RUNTIMES)('GET /getAlbumInfo with a stubbed upstream (%s)', (runtime) => {
  const upstream = useCatalogUpstream(runtime);

  it('passes the upstream reply through unchanged', async () => {
    upstream.respond(album);

    const result = await callRoute(runtime, '/getAlbumInfo?albummid=fixture-album');

    expect(result).toEqual({ status: 200, body: { response: album } });
    expect(upstream.calls).toEqual([albumCall('fixture-album')]);
  });

  // Folia reads `response.code` here, so an upstream rejection stays inside an HTTP 200 body.
  it('keeps an upstream rejection inside a 200 body', async () => {
    const rejected = { code: -1, data: {} };
    upstream.respond(rejected);

    const result = await callRoute(runtime, '/getAlbumInfo?albummid=fixture-album');

    expect(result).toEqual({ status: 200, body: { response: rejected } });
  });

  it('answers 400 without calling upstream when albummid is missing', async () => {
    const result = await callRoute(runtime, '/getAlbumInfo');

    expect(result).toEqual({ status: 400, body: { data: { message: 'no albummid' } } });
    expect(upstream.calls).toEqual([]);
  });

  it('answers the safe 500 when the upstream cannot be reached', async () => {
    upstream.fail(Object.assign(new Error('fixture-private-message'), { code: 'ECONNRESET' }));

    const result = await callRoute(runtime, '/getAlbumInfo?albummid=fixture-album');

    expect(result).toEqual({
      status: 500,
      body: {
        error: {
          name: 'Error',
          message: 'Upstream request failed (ECONNRESET)',
          code: 'ECONNRESET',
        },
      },
    });
  });
});
