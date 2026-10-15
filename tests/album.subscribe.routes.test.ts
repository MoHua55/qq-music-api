import './helpers/sessionRoutes';
import { CATALOG_RUNTIMES, callRoute } from './helpers/catalogRoutes';
import { CONTRACT_CREDENTIAL } from './helpers/contractUpstream';
import { useSessionUpstream } from './helpers/sessionRoutes';

const id = 'FixtureAlbumA1';
const uin = String(CONTRACT_CREDENTIAL.str_musicid || CONTRACT_CREDENTIAL.musicid);
describe.each(CATALOG_RUNTIMES)('专辑收藏写入（%s）', (runtime) => {
  const upstream = useSessionUpstream(runtime);
  let previous: string | undefined;
  const call = async (
    body: unknown = { id, subscribed: true },
    enabled = false,
    mode: 'valid' | 'missing' = 'valid',
  ) => {
    const options = await upstream.options(mode);
    await options.beforeEachLeg?.();
    if (enabled) process.env.QQ_UNVERIFIED_WRITES_ENABLED = '1';
    else delete process.env.QQ_UNVERIFIED_WRITES_ENABLED;
    return callRoute(runtime, '/user/album/subscribe', {
      method: 'POST',
      body,
      headers: options.token ? { 'X-QQ-Session': options.token } : {},
      env: {
        ...options.env,
        ...Object.fromEntries(enabled ? [['QQ_UNVERIFIED_WRITES_ENABLED', '1']] : []),
      },
    });
  };
  const rpc = () => upstream.calls.flatMap((c) => c.rpc);
  beforeEach(() => {
    previous = process.env.QQ_UNVERIFIED_WRITES_ENABLED;
    upstream.state.rpcReplies = {
      FavAlbum: { data: { result: 0, v_failedAlbumId: [], v_failedAlbumMid: [] } },
      CancelFavAlbum: { data: { result: 0, v_failedAlbumId: [], v_failedAlbumMid: [] } },
    };
    upstream.state.rpcReplyQueues = {
      IsAlbumFan: [{ data: { m_fan: { [id]: false } } }, { data: { m_fan: { [id]: true } } }],
    };
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.QQ_UNVERIFIED_WRITES_ENABLED;
    else process.env.QQ_UNVERIFIED_WRITES_ENABLED = previous;
  });
  it.each([false, true])('专辑收藏默认启用，不依赖实验写入开关 %s', async (enabled) => {
    expect(await call(undefined, enabled)).toMatchObject({
      status: 200,
      body: { code: 200, subscribed: true },
    });
    expect(rpc().map((c) => c.method)).toEqual(['IsAlbumFan', 'FavAlbum', 'IsAlbumFan']);
  });
  it('能力声明为 true', async () => {
    expect((await callRoute(runtime, '/login/channels')).body).toHaveProperty(
      'data.features.mutations.subscribeAlbum',
      true,
    );
    expect((await callRoute(runtime, '/login/channels')).body).toHaveProperty(
      'data.features.mutations.likeSong',
      true,
    );
  });
  it.each([
    true,
    false,
  ])('超安全范围 owner 在目标 %s 的读写中保持精确字符串', async (subscribed) => {
    const owner = '1234567890123456789';
    upstream.state.credentialOverrides = { str_musicid: owner, musicid: 1234567890123456800 };
    upstream.state.rpcReplyQueues!.IsAlbumFan = [
      { data: { m_fan: { [id]: !subscribed } } },
      { data: { m_fan: { [id]: subscribed } } },
    ];
    expect(await call({ id, subscribed })).toMatchObject({ status: 200, body: { subscribed } });
    expect(rpc().map((c) => c.param.uin)).toEqual([owner, owner, owner]);
    expect(rpc().map((c) => c.method)).toEqual([
      'IsAlbumFan',
      subscribed ? 'FavAlbum' : 'CancelFavAlbum',
      'IsAlbumFan',
    ]);
  });
  it('超安全范围初始状态未知时只读一次、不写', async () => {
    upstream.state.credentialOverrides = { str_musicid: '1234567890123456789' };
    upstream.state.rpcReplyQueues!.IsAlbumFan = [{ data: { m_fan: {} } }];
    expect(await call()).toMatchObject({ status: 502, body: { retryable: false } });
    expect(rpc().map((c) => c.method)).toEqual(['IsAlbumFan']);
  });
  it.each([
    { str_musicid: '', musicid: 1234567890123456800 },
    { str_musicid: '0', musicid: 1234567890123456800 },
    { str_musicid: '1e18' },
    { str_musicid: '-1' },
    { str_musicid: '0', musicid: 0 },
  ])('无保真 owner 时不请求上游', async (credentialOverrides) => {
    upstream.state.credentialOverrides = credentialOverrides;
    expect(await call()).toMatchObject({ status: 502, body: { retryable: false } });
    expect(upstream.calls).toHaveLength(0);
  });
  it.each([true, false])('目标 %s 要写入一次并读回', async (subscribed) => {
    upstream.state.rpcReplyQueues!.IsAlbumFan = [
      { data: { m_fan: { [id]: !subscribed } } },
      { data: { m_fan: { [id]: subscribed } } },
    ];
    expect((await call({ id, subscribed })).body).toEqual({ code: 200, subscribed });
    expect(rpc()).toEqual([
      {
        module: 'music.musicasset.AlbumFavRead',
        method: 'IsAlbumFan',
        param: { uin: Number(uin), v_albumMid: [id] },
      },
      {
        module: 'music.musicasset.AlbumFavWrite',
        method: subscribed ? 'FavAlbum' : 'CancelFavAlbum',
        param: { uin, v_albumMid: [id] },
      },
      {
        module: 'music.musicasset.AlbumFavRead',
        method: 'IsAlbumFan',
        param: { uin: Number(uin), v_albumMid: [id] },
      },
    ]);
  });
  it.each([true, false])('已是目标 %s 也要读回确认、不写', async (subscribed) => {
    upstream.state.rpcReplyQueues!.IsAlbumFan = [{ data: { m_fan: { [id]: subscribed } } }];
    expect((await call({ id, subscribed })).body).toEqual({ code: 200, subscribed });
    expect(rpc().map((c) => c.method)).toEqual(['IsAlbumFan']);
  });
  it.each(
    [
      null,
      {},
      { id },
      { subscribed: true },
      { id: 101, subscribed: true },
      { id: '', subscribed: true },
      { id: 'bad mid', subscribed: true },
      { id: 'A'.repeat(65), subscribed: true },
      { id, subscribed: 'true' },
      { id, subscribed: true, uin: 'fixture-private' },
      { id, subscribed: true, type: 'playlist' },
    ].map((body) => [body]),
  )('非法输入不读取或写入', async (body) => {
    expect((await call(body)).status).toBe(400);
    expect(upstream.calls).toHaveLength(0);
  });
  it('缺会话不请求上游', async () => {
    expect((await call(undefined, true, 'missing')).status).toBe(401);
    expect(upstream.calls).toHaveLength(0);
  });
  it('GET 不执行', async () => {
    const options = await upstream.options('missing');
    expect((await callRoute(runtime, '/user/album/subscribe', { env: options.env })).status).toBe(
      405,
    );
    expect(upstream.calls).toHaveLength(0);
  });
  it.each([
    {},
    { [id]: 'true' },
    { [id]: false },
  ])('写后状态未知或不匹配回安全 502', async (fan) => {
    upstream.state.rpcReplyQueues!.IsAlbumFan![1] = {
      data: { m_fan: fan, message: 'fixture-private' },
    };
    const result = await call();
    expect(result).toMatchObject({
      status: 502,
      body: { errorKey: 'upstream.invalid-response', retryable: false },
    });
    expect(JSON.stringify(result.body)).not.toContain('fixture-private');
    expect(rpc().filter((c) => c.method === 'FavAlbum')).toHaveLength(1);
  });
  it('写前状态未知不执行写入', async () => {
    upstream.state.rpcReplyQueues!.IsAlbumFan = [{ data: { m_fan: {} } }];
    expect((await call()).status).toBe(502);
    expect(rpc().map((c) => c.method)).toEqual(['IsAlbumFan']);
  });
  it.each([503, 429])('写入 HTTP %s 不重试并回 502', async (httpStatus) => {
    upstream.state.rpcReplies!.FavAlbum = { httpStatus };
    expect(await call()).toMatchObject({ status: 502, body: { retryable: false } });
    expect(rpc().filter((c) => c.method === 'FavAlbum')).toHaveLength(1);
  });
  it.each([
    { result: 1, v_failedAlbumId: [], v_failedAlbumMid: [] },
    { result: 0, v_failedAlbumId: [101], v_failedAlbumMid: [] },
    { result: 0, v_failedAlbumId: [], v_failedAlbumMid: [id] },
    { result: 0 },
    { result: 0, v_failedAlbumId: [], v_failedAlbumMid: 'unknown' },
  ])('失败列表或未知回应不回成功', async (data) => {
    upstream.state.rpcReplies!.FavAlbum.data = data;
    expect((await call()).status).toBe(502);
    expect(rpc().filter((c) => c.method === 'FavAlbum')).toHaveLength(1);
  });
  it('读回拒绝不清会话、不再写', async () => {
    upstream.state.rpcReplyQueues!.IsAlbumFan![1] = { code: 1000 };
    expect(await call()).toMatchObject({ status: 502, body: { retryable: false } });
    expect(rpc().filter((c) => c.method === 'FavAlbum')).toHaveLength(1);
  });
});
