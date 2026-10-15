import './helpers/sessionRoutes';
import { CATALOG_RUNTIMES, callRoute } from './helpers/catalogRoutes';
import { useSessionUpstream } from './helpers/sessionRoutes';

const song = { id: 101, mid: 'FixtureSongA1', type: 0 };
describe.each(CATALOG_RUNTIMES)('红心写入（%s）', (runtime) => {
  const upstream = useSessionUpstream(runtime);
  let previous: string | undefined;
  const call = async (
    body: unknown = { song, liked: true },
    enabled = false,
    mode: 'valid' | 'missing' = 'valid',
  ) => {
    const options = await upstream.options(mode);
    await options.beforeEachLeg?.();
    if (enabled) process.env.QQ_UNVERIFIED_WRITES_ENABLED = '1';
    else delete process.env.QQ_UNVERIFIED_WRITES_ENABLED;
    return callRoute(runtime, '/user/song/like', {
      method: 'POST',
      body,
      headers: options.token ? { 'X-QQ-Session': options.token } : {},
      env: {
        ...options.env,
        ...Object.fromEntries(enabled ? [['QQ_UNVERIFIED_WRITES_ENABLED', '1']] : []),
      },
    });
  };
  const methods = () => upstream.calls.flatMap((c) => c.rpc).map((c) => c.method);
  beforeEach(() => {
    previous = process.env.QQ_UNVERIFIED_WRITES_ENABLED;
    upstream.state.songDetails = { [song.mid]: { id: song.id, mid: song.mid, type: 0 } };
    upstream.state.rpcReplies = {
      AddSonglist: { data: { retCode: 0, result: { dirId: 201, tid: 70001 } } },
      DelSonglist: { data: { retCode: 0, result: { dirId: 201, tid: 70001 } } },
    };
    upstream.state.rpcReplyQueues = {
      IsSongFanByMid: [
        { data: { m_fan: { [song.mid]: false } } },
        { data: { m_fan: { [song.mid]: true } } },
      ],
    };
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.QQ_UNVERIFIED_WRITES_ENABLED;
    else process.env.QQ_UNVERIFIED_WRITES_ENABLED = previous;
  });
  it.each([false, true])('红心默认启用，不依赖实验写入开关 %s', async (enabled) => {
    expect(await call(undefined, enabled)).toMatchObject({
      status: 200,
      body: { code: 200, liked: true },
    });
    expect(methods()).toEqual([
      'get_song_detail_yqq',
      'IsSongFanByMid',
      'AddSonglist',
      'IsSongFanByMid',
    ]);
  });
  it('红心与专辑收藏都声明为已验证能力', async () => {
    const result = await callRoute(runtime, '/login/channels');
    expect(result.body).toHaveProperty('data.features.mutations.likeSong', true);
    expect(result.body).toHaveProperty('data.features.mutations.subscribeAlbum', true);
  });
  it.each([true, false])('先核对歌曲，再写一次并确认目标 %s', async (liked) => {
    upstream.state.rpcReplyQueues!.IsSongFanByMid = [
      { data: { m_fan: { [song.mid]: !liked } } },
      { data: { m_fan: { [song.mid]: liked } } },
    ];
    expect(await call({ song, liked })).toMatchObject({ status: 200, body: { code: 200, liked } });
    expect(methods()).toEqual([
      'get_song_detail_yqq',
      'IsSongFanByMid',
      liked ? 'AddSonglist' : 'DelSonglist',
      'IsSongFanByMid',
    ]);
    const write = upstream.calls
      .flatMap((c) => c.rpc)
      .find((c) => c.method === (liked ? 'AddSonglist' : 'DelSonglist'));
    expect(write).toEqual({
      module: 'music.musicasset.PlaylistDetailWrite',
      method: liked ? 'AddSonglist' : 'DelSonglist',
      param: { dirId: 201, v_songInfo: [{ songId: 101, songType: 0 }] },
    });
  });
  it.each([true, false])('原本已是目标 %s 时仍读取确认、不重复写', async (liked) => {
    upstream.state.rpcReplyQueues!.IsSongFanByMid = [{ data: { m_fan: { [song.mid]: liked } } }];
    expect((await call({ song, liked })).body).toEqual({ code: 200, liked });
    expect(methods()).toEqual(['get_song_detail_yqq', 'IsSongFanByMid']);
  });
  it.each(
    [
      null,
      {},
      { song },
      { liked: true },
      { song, liked: 1 },
      { song: { id: 101, type: 0 }, liked: true },
      { song: { mid: song.mid, type: 0 }, liked: true },
      { song: { id: 101, mid: song.mid }, liked: true },
      { song: { ...song, id: '101' }, liked: true },
      { song: { ...song, id: -1 }, liked: true },
      { song: { ...song, id: 1.5 }, liked: true },
      { song: { ...song, id: Number.MAX_SAFE_INTEGER + 1 }, liked: true },
      { song: { ...song, mid: '' }, liked: true },
      { song: { ...song, mid: 'bad mid' }, liked: true },
      { song: { ...song, mid: 'A'.repeat(65) }, liked: true },
      { song: { ...song, type: 1 }, liked: true },
      { song: { ...song, type: '0' }, liked: true },
      { song: { ...song, name: 'fixture-private' }, liked: true },
      { song, liked: true, enabled: true },
    ].map((body) => [body]),
  )('非法输入不读取或写入', async (body) => {
    expect((await call(body)).status).toBe(400);
    expect(upstream.calls).toHaveLength(0);
  });
  it('缺会话不请求上游', async () => {
    expect((await call(undefined, true, 'missing')).status).toBe(401);
    expect(upstream.calls).toHaveLength(0);
  });
  it('GET 不执行写入', async () => {
    const options = await upstream.options('missing');
    expect((await callRoute(runtime, '/user/song/like', { env: options.env })).status).toBe(405);
    expect(upstream.calls).toHaveLength(0);
  });
  it.each([
    { id: 102, mid: song.mid },
    { id: 101, mid: 'FixtureOther' },
  ])('标识不一致时拒绝', async (detail) => {
    upstream.state.songDetails![song.mid] = detail;
    expect((await call()).status).toBe(400);
    expect(methods()).toEqual(['get_song_detail_yqq']);
  });
  it('读取条目的 type 不当成写入编码', async () => {
    upstream.state.songDetails![song.mid] = { id: 101, mid: song.mid, type: 1, songtype: 13 };
    expect((await call()).body).toEqual({ code: 200, liked: true });
  });
  it.each([{}, { id: 101 }])('歌曲关联无法确认时不写', async (detail) => {
    upstream.state.songDetails![song.mid] = detail;
    expect((await call()).status).toBe(502);
    expect(methods()).toEqual(['get_song_detail_yqq']);
  });
  it.each([
    {},
    { [song.mid]: 'true' },
    { [song.mid]: false },
  ])('写后状态未知或不符合目标时回安全 502', async (fan) => {
    upstream.state.rpcReplyQueues!.IsSongFanByMid![1] = {
      data: { m_fan: fan, message: 'fixture-private' },
    };
    const result = await call();
    expect(result).toMatchObject({
      status: 502,
      body: { errorKey: 'upstream.invalid-response', retryable: false },
    });
    expect(JSON.stringify(result.body)).not.toContain('fixture-private');
    expect(methods().filter((m) => m === 'AddSonglist')).toHaveLength(1);
  });
  it.each([503, 429])('写入 HTTP %s 只送一次，不把失败当成功', async (httpStatus) => {
    upstream.state.rpcReplies!.AddSonglist = { httpStatus };
    expect(await call()).toMatchObject({ status: 502, body: { retryable: false } });
    expect(methods().filter((m) => m === 'AddSonglist')).toHaveLength(1);
  });
  it.each([
    { retCode: 1 },
    { retCode: 0 },
    { retCode: 0, result: { dirId: 999, tid: 70001 } },
  ])('写入回应无法确认时不回成功', async (data) => {
    upstream.state.rpcReplies!.AddSonglist.data = data;
    expect((await call()).status).toBe(502);
    expect(methods().filter((m) => m === 'AddSonglist')).toHaveLength(1);
  });
  it('读回业务拒绝不清会话，也不重发写入', async () => {
    upstream.state.rpcReplyQueues!.IsSongFanByMid![1] = { code: 1000 };
    expect(await call()).toMatchObject({ status: 502, body: { retryable: false } });
    expect(methods().filter((m) => m === 'AddSonglist')).toHaveLength(1);
  });
});
