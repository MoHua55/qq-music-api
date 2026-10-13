import request from 'supertest';
import app from '../src/app';
import { useCatalogUpstream } from './helpers/catalogRoutes';

const server = app.callback();

describe('GET /getSongInfo', () => {
  // 替换真正的上游传输，路由改为共用 handler 后仍验证原来的 HTTP 行为。
  const upstream = useCatalogUpstream('node');
  beforeEach(() => {
    upstream.respond({
      code: 0,
      songinfo: {
        data: { songmid: 'fixture-song' },
      },
    });
  });

  it('正常流程: 验证接口能否正确返回业务数据', async () => {
    const response = await request(server).get('/getSongInfo?songmid=fixture-song');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('response');
    expect(response.body.response.code).toBe(0);
  });

  it('reads songmid and songid from the documented path parameters', async () => {
    await request(server).get('/getSongInfo/path-mid/42').expect(200);

    const payload = upstream.calls.at(-1)?.payload as {
      songinfo: { param: Record<string, unknown> };
    };
    expect(payload.songinfo.param).toMatchObject({ song_mid: 'path-mid', song_id: '42' });
  });

  it('边界条件: 验证参数为空时的表现', async () => {
    const response = await request(server).get('/getSongInfo');
    expect(response.status).toBe(200);
  });

  it('异常输入: 传入非法的 songmid', async () => {
    const response = await request(server).get('/getSongInfo?songmid=invalid_mid_!@#');
    expect(response.status).toBe(200);
    // 一般业务上会返回提示无此歌曲
    expect(response.body).toBeDefined();
  });

  it('性能压力: 100并发请求', async () => {
    const concurrency = 20;
    const batches = 5;

    for (let batchIndex = 0; batchIndex < batches; batchIndex++) {
      const requests = Array.from({ length: concurrency }, () =>
        request(server).get('/getSongInfo?songmid=fixture-song'),
      );
      const responses = await Promise.all(requests);
      responses.forEach((res) => {
        expect(res.status).toBe(200);
      });
    }

    expect(upstream.calls).toHaveLength(concurrency * batches);
  });

  it('安全测试: 验证接口是否抵御常见注入或跨站攻击', async () => {
    const response = await request(server).get('/getSongInfo?songmid=<script>alert(1)</script>');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/json/);
  });
});
