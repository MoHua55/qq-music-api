import {
  getLegacyHttpTransport,
  type LegacyHttpTransport,
  setLegacyHttpTransport,
} from '../src/services/httpTransport';
import { CATALOG_RUNTIMES, type CatalogRuntimeName, callRoute } from './helpers/catalogRoutes';

// 歌词翻译补强：带 trans=1、旧接口的翻译是空的，才用 GetPlayLyricInfo（crypt 0）补一次。
// 结构按 2026-10 实测整理：旧接口 trans 常是空字符串；新接口 crypt 0 时 trans 是 base64 的 LRC，
// 只送 songMID 也读得到。歌名与歌词都是假数据。

const lyric = '[ti:示例歌曲]\n[00:01.25]第一句示例歌词';
const translation = '[00:01.25]Fixture translated line';
const base64 = (text: string) => Buffer.from(text).toString('base64');
const OLD_HOST = 'c.y.qq.com';
const MUSICU_PATH = '/cgi-bin/musicu.fcg';

interface Upstream {
  old: unknown;
  musicu: unknown;
  musicuError?: Error;
}

const useLyricUpstream = (runtime: CatalogRuntimeName) => {
  const state: Upstream = { old: {}, musicu: {} };
  const oldCalls: Array<Record<string, unknown>> = [];
  const musicuCalls: Array<{ comm: Record<string, unknown>; req: Record<string, unknown> }> = [];
  let original: LegacyHttpTransport | undefined;

  const answerMusicu = async (request: Request) => {
    const body = JSON.parse(await request.text());
    musicuCalls.push({ comm: body.comm, req: body.req_0 });
    if (state.musicuError) throw state.musicuError;
    return Response.json(state.musicu);
  };

  beforeEach(() => {
    state.old = {};
    state.musicu = {};
    state.musicuError = undefined;
    oldCalls.length = 0;
    musicuCalls.length = 0;
    if (runtime === 'node') {
      original = getLegacyHttpTransport();
      const base = original;
      setLegacyHttpTransport({
        kind: base.kind,
        get defaults() {
          return base.defaults;
        },
        request: async <T>(_url: string, _method: string, options: { params?: object } = {}) => {
          oldCalls.push({ ...(options.params ?? {}) });
          return { data: state.old as T, status: 200, statusText: 'OK', headers: {}, config: {} };
        },
      } as LegacyHttpTransport);
    }
    jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname === MUSICU_PATH) return answerMusicu(request);
      if (url.hostname === OLD_HOST) {
        oldCalls.push(Object.fromEntries(url.searchParams.entries()));
        return Response.json(state.old);
      }
      throw new Error(`unexpected upstream ${url.hostname}`);
    });
  });

  afterEach(() => {
    if (original) setLegacyHttpTransport(original);
    original = undefined;
    jest.restoreAllMocks();
  });

  return { state, oldCalls, musicuCalls };
};

const playLyricReply = (data: unknown, code = 0) => ({ code: 0, req_0: { code, data } });

describe.each(CATALOG_RUNTIMES)('GET /getLyric?trans=1（%s）', (runtime) => {
  const upstream = useLyricUpstream(runtime);

  it('旧接口翻译是空的：用新接口补上 trans，其余字段照旧', async () => {
    upstream.state.old = { retcode: 0, code: 0, subcode: 0, lyric: base64(lyric), trans: '' };
    upstream.state.musicu = playLyricReply({ lyric: 'ABCDEF0123', trans: base64(translation) });

    const result = await callRoute(runtime, '/getLyric?songmid=fixture-song&trans=1');

    expect(result).toEqual({
      status: 200,
      body: {
        response: { retcode: 0, code: 0, subcode: 0, lyric, trans: base64(translation) },
      },
    });
    expect(upstream.oldCalls).toHaveLength(1);
    expect(upstream.musicuCalls).toHaveLength(1);
    const [call] = upstream.musicuCalls;
    expect(call.req).toMatchObject({
      module: 'music.musichallSong.PlayLyricInfo',
      method: 'GetPlayLyricInfo',
      param: expect.objectContaining({ songMID: 'fixture-song', crypt: 0, trans: 1 }),
    });
    expect(call.req.param).not.toHaveProperty('songID');
    // 和匿名搜索同一个精简版匿名身份，不带会话也不需要密钥。
    expect(call.comm).toMatchObject({ ct: 11, tmeAppID: 'qqmusiclight', uid: '0' });
  });

  it('旧接口没有 trans 字段时也补', async () => {
    upstream.state.old = { code: 0, lyric: base64(lyric) };
    upstream.state.musicu = playLyricReply({ trans: base64(translation) });

    const result = await callRoute(runtime, '/getLyric?songmid=fixture-song&trans=1');

    expect(result.body).toEqual({ response: { code: 0, lyric, trans: base64(translation) } });
  });

  it('isFormat 与 trans 可以一起用，trans 保持 base64', async () => {
    upstream.state.old = { code: 0, lyric: base64(lyric), trans: '' };
    upstream.state.musicu = playLyricReply({ trans: base64(translation) });

    const result = await callRoute(runtime, '/getLyric?songmid=fixture-song&isFormat=1&trans=1');

    expect(result.body).toEqual({
      response: {
        code: 0,
        trans: base64(translation),
        lyric: {
          lyric,
          tags: { title: '示例歌曲', artist: '', album: '', offset: '', by: '' },
          lines: [{ time: 1250, txt: '第一句示例歌词' }],
        },
      },
    });
  });

  it('旧接口已经有翻译：不打新接口', async () => {
    const existing = base64('[00:01.25]Old translation');
    upstream.state.old = { code: 0, lyric: base64(lyric), trans: existing };

    const result = await callRoute(runtime, '/getLyric?songmid=fixture-song&trans=1');

    expect(result.body).toEqual({ response: { code: 0, lyric, trans: existing } });
    expect(upstream.musicuCalls).toHaveLength(0);
  });

  it.each([
    '',
    '&trans=0',
    '&trans=true',
    '&trans=',
  ])('没明确要（%s）：和以前一样只打旧接口', async (suffix) => {
    upstream.state.old = { code: 0, lyric: base64(lyric), trans: '' };

    const result = await callRoute(runtime, `/getLyric?songmid=fixture-song${suffix}`);

    expect(result.body).toEqual({ response: { code: 0, lyric, trans: '' } });
    expect(upstream.musicuCalls).toHaveLength(0);
  });

  it('旧接口本身没成功（code 非 0）：不补，原样转交', async () => {
    upstream.state.old = { code: -1901 };

    const result = await callRoute(runtime, '/getLyric?songmid=fixture-song&trans=1');

    expect(result).toEqual({ status: 200, body: { response: { code: -1901 } } });
    expect(upstream.musicuCalls).toHaveLength(0);
  });

  it.each([
    { label: '新接口翻译也是空的', reply: playLyricReply({ lyric: 'ABCDEF', trans: '' }) },
    { label: '新接口没有 trans', reply: playLyricReply({ lyric: 'ABCDEF' }) },
    { label: '新接口回的是密文（十六进制）', reply: playLyricReply({ trans: 'ABCDEF0123456789' }) },
    { label: '新接口单项码非 0', reply: playLyricReply({ trans: base64(translation) }, 2001) },
    { label: '新接口网关码非 0', reply: { code: 500003 } },
    { label: '新接口回包形状不对', reply: { unexpected: true } },
  ])('$label：保留旧接口的空翻译，照常回 200', async ({ reply }) => {
    upstream.state.old = { code: 0, lyric: base64(lyric), trans: '' };
    upstream.state.musicu = reply;

    const result = await callRoute(runtime, '/getLyric?songmid=fixture-song&trans=1');

    expect(result).toEqual({ status: 200, body: { response: { code: 0, lyric, trans: '' } } });
    expect(upstream.musicuCalls).toHaveLength(1);
  });

  it('新接口连不上：只试一次，保留旧接口的结果', async () => {
    upstream.state.old = { code: 0, lyric: base64(lyric), trans: '' };
    upstream.state.musicuError = Object.assign(new Error('fixture-private-message'), {
      code: 'ECONNRESET',
    });

    const result = await callRoute(runtime, '/getLyric?songmid=fixture-song&trans=1');

    expect(result).toEqual({ status: 200, body: { response: { code: 0, lyric, trans: '' } } });
    expect(upstream.musicuCalls).toHaveLength(1);
  });
});
