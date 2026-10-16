import './helpers/sessionRoutes';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { apiExplorerMetadata } from '../src/config/apiExplorer';
import { CATALOG_RUNTIMES, callRoute } from './helpers/catalogRoutes';
import { useSessionUpstream } from './helpers/sessionRoutes';

// /user/cloud：音乐云盘里的歌。带凭证读一次 `GetMatchAudio`（每页 2000 首），再在本地切成要的那一页。
// 歌名、文件名、id、路径都是假数据。
const base64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');

const SONG_A = {
  id: 201,
  mid: 'fixture-cloud-a',
  name: 'Fixture cloud A',
  title: 'Fixture cloud A',
  interval: 200,
  singer: [{ mid: 'fixture-singer', name: 'Fixture singer' }],
  album: { mid: 'fixture-album', name: 'Fixture album' },
  file: { media_mid: 'fixture-media-a' },
};
const SONG_B = { id: 0, mid: '', name: '假的上传歌', title: '假的上传歌' };
const SONG_D = { id: 204, mid: 'fixture-cloud-d', name: 'Fixture cloud D' };

const privateFields = (index: number) => ({
  file_id: `fixture-private-file-${index}`,
  filepath: base64(`fixture-private-path-${index}`),
  song_id: 9000 + index,
  song_type: 0,
});

const ENTRIES = [
  {
    ...privateFields(1),
    filename: base64('Fixture cloud A.flac'),
    matched: 1,
    timestamp: 1700000000,
    song_info: SONG_A,
  },
  {
    ...privateFields(2),
    filename: base64('假的上传歌.mp3'),
    matched: 2,
    timestamp: 1700000000123,
    song_info: SONG_B,
  },
  { ...privateFields(3), filename: 'plain name.mp3', matched: 1 },
  {
    ...privateFields(4),
    filename: base64('Fixture cloud D.mp3'),
    matched: 2,
    timestamp: 1700000001,
    song_info: SONG_D,
  },
];
const EXPECTED = [
  { song: SONG_A, fileName: 'Fixture cloud A.flac', addTime: 1700000000000, playable: true },
  { song: SONG_B, fileName: '假的上传歌.mp3', addTime: 1700000000123, playable: false },
  { song: null, fileName: 'plain name.mp3', addTime: null, playable: false },
  { song: SONG_D, fileName: 'Fixture cloud D.mp3', addTime: 1700000001000, playable: false },
];

const page = (infoList: unknown, extra: Record<string, unknown> = {}) => ({
  data: {
    has_more: 0,
    info_list: infoList,
    page_no: 1,
    page_size: 2000,
    total: Array.isArray(infoList) ? infoList.length : 0,
    weiyun_up: 0,
    ...extra,
  },
});
const generated = (from: number, count: number) =>
  Array.from({ length: count }, (_, offset) => {
    const index = from + offset;
    return {
      ...privateFields(index),
      filename: base64(`Fixture ${index}.mp3`),
      matched: 1,
      timestamp: 1700000000,
      song_info: { id: index + 1, mid: `fixture-cloud-${index}`, name: `Fixture ${index}` },
    };
  });

const CLOUD_RPC = { module: 'music.WeiyunMusic.WeiyunMusicRead', method: 'GetMatchAudio' };
const pageRequest = (pageNo: number, uin = '10000') => ({
  ...CLOUD_RPC,
  param: { uin, file_id: '', page_no: pageNo, page_size: 2000 },
});

it('文档、Explorer、CHANGELOG 都说明云盘；真账号验过列表和播放后，能力声明打开', async () => {
  const readme = readFileSync(resolve(__dirname, '../docs/README.md'), 'utf8');
  const changelog = readFileSync(resolve(__dirname, '../CHANGELOG.md'), 'utf8');
  expect(readme).toContain('/user/cloud');
  expect(changelog).toContain('/user/cloud');
  expect(
    apiExplorerMetadata.endpoints.some(
      (endpoint) => endpoint.routePath === '/user/cloud' && endpoint.method === 'GET',
    ),
  ).toBe(true);
  const channels = await callRoute('node', '/login/channels');
  expect(channels.body).toMatchObject({
    data: {
      features: {
        library: { getCloudCollection: true },
        catalog: { getCloudTracks: true },
      },
    },
  });
});

describe.each(CATALOG_RUNTIMES)('/user/cloud（%s）', (runtime) => {
  const upstream = useSessionUpstream(runtime);
  const call = async (
    query = '',
    mode: 'valid' | 'missing' | 'invalid' | 'expired' = 'valid',
    env?: Record<string, string>,
  ) => {
    const options = await upstream.options(mode);
    await options.beforeEachLeg?.();
    return callRoute(runtime, `/user/cloud${query}`, {
      headers: options.token ? { 'X-QQ-Session': options.token } : {},
      env: env ?? options.env,
    });
  };
  const rpcCalls = () => upstream.calls.flatMap((c) => c.rpc);

  it('读一次第一页，整理成歌曲、文件名、加入时间和能不能播，不带出文件 id 与路径', async () => {
    upstream.state.rpcReplies = { GetMatchAudio: page(ENTRIES) };
    const result = await call();
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ code: 200, data: EXPECTED, count: 4, hasMore: false });
    expect(rpcCalls()).toEqual([pageRequest(1)]);
    const text = JSON.stringify(result.body);
    expect(text).not.toContain('fixture-private');
    expect(text).not.toContain(base64('fixture-private-path-1'));
  });

  it('账号 id 超过安全整数时照原样的字符串送出', async () => {
    upstream.state.credentialOverrides = {
      musicid: '1152921504606846976',
      str_musicid: '1152921504606846976',
    };
    upstream.state.rpcReplies = { GetMatchAudio: page(ENTRIES) };
    expect((await call()).status).toBe(200);
    expect(rpcCalls()).toEqual([pageRequest(1, '1152921504606846976')]);
  });

  it('云盘是空的回 200 和空清单，不当成错误', async () => {
    upstream.state.rpcReplies = { GetMatchAudio: page([]) };
    const result = await call();
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ code: 200, data: [], count: 0, hasMore: false });
  });

  it.each([[null], [undefined]])('info_list 是 %p 也当空清单', async (infoList) => {
    upstream.state.rpcReplies = { GetMatchAudio: page(infoList) };
    const result = await call();
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ code: 200, data: [], count: 0, hasMore: false });
  });

  it('在本地切页：offset、limit 只影响回包，上游照样读第一页', async () => {
    upstream.state.rpcReplies = { GetMatchAudio: page(ENTRIES) };
    const result = await call('?limit=2&offset=1');
    expect(result.body).toEqual({
      code: 200,
      data: EXPECTED.slice(1, 3),
      count: 4,
      hasMore: true,
    });
    expect(rpcCalls()).toEqual([pageRequest(1)]);
  });

  it.each([
    { query: '?offset=3&limit=5', from: 3, to: 4, hasMore: false },
    { query: '?offset=9', from: 4, to: 4, hasMore: false },
    { query: '?offset=-1&limit=1', from: 0, to: 1, hasMore: true },
    { query: '?offset=invalid&limit=invalid', from: 0, to: 4, hasMore: false },
    { query: '?offset=&limit=0', from: 0, to: 4, hasMore: false },
    { query: '?offset=1.9&limit=1.9', from: 1, to: 2, hasMore: true },
  ])('分页边界 $query', async ({ query, from, to, hasMore }) => {
    upstream.state.rpcReplies = { GetMatchAudio: page(ENTRIES) };
    const result = await call(query);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      code: 200,
      data: EXPECTED.slice(from, to),
      count: 4,
      hasMore,
    });
    expect(rpcCalls()).toHaveLength(1);
  });

  it('默认一次给 200 首，最多 1000 首', async () => {
    upstream.state.rpcReplies = { GetMatchAudio: page(generated(0, 1500)) };
    const byDefault = await call();
    expect((byDefault.body as { data: unknown[] }).data).toHaveLength(200);
    expect(byDefault.body).toMatchObject({ count: 1500, hasMore: true });
    const capped = await call('?limit=5000');
    expect((capped.body as { data: unknown[] }).data).toHaveLength(1000);
    expect(capped.body).toMatchObject({ count: 1500, hasMore: true });
  });

  it('要的范围跨过 2000 首时接着读下一页', async () => {
    upstream.state.rpcReplyQueues = {
      GetMatchAudio: [
        page(generated(0, 2000), { has_more: 1, total: 2500 }),
        page(generated(2000, 500), { page_no: 2, total: 2500 }),
      ],
    };
    const result = await call('?offset=1900&limit=200');
    const body = result.body as { data: Array<{ song: { mid: string } }> };
    expect(result.status).toBe(200);
    expect(body.data).toHaveLength(200);
    expect(body.data[0].song.mid).toBe('fixture-cloud-1900');
    expect(body.data[199].song.mid).toBe('fixture-cloud-2099');
    expect(result.body).toMatchObject({ count: 2500, hasMore: true });
    expect(rpcCalls()).toEqual([pageRequest(1), pageRequest(2)]);
  });

  it('上游说没有下一页就不再读，即使 offset 更大', async () => {
    upstream.state.rpcReplies = { GetMatchAudio: page(generated(0, 3), { total: 3 }) };
    const result = await call('?offset=2500');
    expect(result.body).toEqual({ code: 200, data: [], count: 3, hasMore: false });
    expect(rpcCalls()).toHaveLength(1);
  });

  it('上游没给 total 时用读到的条数', async () => {
    upstream.state.rpcReplies = { GetMatchAudio: page(ENTRIES, { total: undefined }) };
    const result = await call();
    expect(result.body).toEqual({ code: 200, data: EXPECTED, count: 4, hasMore: false });
  });

  it('清单里不是对象的条目跳过', async () => {
    upstream.state.rpcReplies = { GetMatchAudio: page([ENTRIES[0], 'fixture-odd', null]) };
    const result = await call();
    expect(result.status).toBe(200);
    expect((result.body as { data: unknown[] }).data).toEqual([EXPECTED[0]]);
  });

  it.each([
    'missing',
    'invalid',
    'expired',
  ] as const)('会话 %s 先回 401，不请求上游', async (mode) => {
    expect((await call('', mode)).status).toBe(401);
    expect(upstream.calls).toHaveLength(0);
  });

  it.each([
    { data: 'not-an-object' },
    { data: { has_more: 0, info_list: {} } },
  ])('回应格式不对回 502，不冒充成功', async (reply) => {
    upstream.state.rpcReplies = { GetMatchAudio: reply };
    const result = await call();
    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({ errorKey: 'upstream.invalid-response' });
  });

  it.each([1000, 104400, 104401])('上游不认凭证 %s 回 401，让前端重新登录', async (code) => {
    upstream.state.rpcReplies = { GetMatchAudio: { code } };
    const result = await call();
    expect(result.status).toBe(401);
    expect(result.body).toMatchObject({ errorKey: 'auth.credential-invalid' });
  });

  it('没登记的业务码保持未知、回 502', async () => {
    upstream.state.rpcReplies = { GetMatchAudio: { code: 999999 } };
    const result = await call();
    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({ errorKey: 'upstream.unknown', upstreamCode: 999999 });
  });

  it('网关和网络错误回 502，不带出原始内容', async () => {
    upstream.state.globalCode = 500003;
    expect((await call()).status).toBe(502);
    delete upstream.state.globalCode;
    upstream.state.networkError = new Error('fixture-private');
    const result = await call();
    expect(result.status).toBe(502);
    expect(JSON.stringify(result.body)).not.toContain('fixture-private');
  });

  if (runtime === 'serverless')
    it('没配置密钥回 501', async () => {
      expect((await call('', 'missing', {})).status).toBe(501);
    });
});
