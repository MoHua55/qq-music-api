import { CATALOG_RUNTIMES, callRoute, useCatalogUpstream } from './helpers/catalogRoutes';

// 歌词：Node 与 serverless 跑同一份案例，回包形状和原来的 Node 路由一样。
// 结构按 2026-10 实测整理（`fcg_query_lyric_new.fcg` 回 base64 的 LRC），歌名与歌词都是假数据。

const lyric = '[ti:示例歌曲]\n[00:01.25]第一句示例歌词';
const encoded = Buffer.from(lyric).toString('base64');
const ENDPOINT = 'https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg';

describe.each(CATALOG_RUNTIMES)('GET /getLyric（%s）', (runtime) => {
  const upstream = useCatalogUpstream(runtime);

  it('把 base64 的 LRC 解成 UTF-8 文字，其他字段原样保留', async () => {
    upstream.respond({ retcode: 0, code: 0, subcode: 0, lyric: encoded, trans: '' });
    const result = await callRoute(runtime, '/getLyric?songmid=fixture-song');
    expect(result).toEqual({
      status: 200,
      body: { response: { retcode: 0, code: 0, subcode: 0, lyric, trans: '' } },
    });
    expect(upstream.calls).toEqual([
      {
        endpoint: ENDPOINT,
        params: expect.objectContaining({
          songmid: 'fixture-song',
          format: 'json',
          outCharset: 'utf-8',
          pcachetime: expect.stringMatching(/^\d+$/),
        }),
      },
    ]);
  });

  it.each(['1', 'true'])('isFormat=%s 时拆成时间行', async (flag) => {
    upstream.respond({ code: 0, lyric: encoded, trans: '' });
    const result = await callRoute(runtime, `/getLyric?songmid=fixture-song&isFormat=${flag}`);
    expect(result.body).toEqual({
      response: {
        code: 0,
        trans: '',
        lyric: {
          lyric,
          tags: { title: '示例歌曲', artist: '', album: '', offset: '', by: '' },
          lines: [{ time: 1250, txt: '第一句示例歌词' }],
        },
      },
    });
  });

  it('上游没有歌词时照原样转交，不编造歌词', async () => {
    upstream.respond({ code: 987654 });
    expect(await callRoute(runtime, '/getLyric?songmid=fixture-song')).toEqual({
      status: 200,
      body: { response: { code: 987654 } },
    });
  });

  it('缺 songmid 回 400，不请求上游', async () => {
    expect(await callRoute(runtime, '/getLyric')).toEqual({
      status: 400,
      body: { response: 'no songmid' },
    });
    expect(upstream.calls).toHaveLength(0);
  });

  it('上游失败回 500，不自动重试', async () => {
    upstream.fail(new Error('fixture-private failure'));
    const result = await callRoute(runtime, '/getLyric?songmid=fixture-song');
    expect(result.status).toBe(500);
    expect(result.body).toHaveProperty('error');
    expect(JSON.stringify(result.body)).not.toContain('fixture-private');
    expect(upstream.calls).toHaveLength(1);
  });

  it('能力声明在两个运行时都是 true', async () => {
    const result = await callRoute(runtime, '/login/channels');
    expect(result.body).toHaveProperty('data.features.lyrics.getLyrics', true);
  });
});
