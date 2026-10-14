import './helpers/sessionRoutes';
import { CATALOG_RUNTIMES, callRoute } from './helpers/catalogRoutes';
import { CONTRACT_CREDENTIAL } from './helpers/contractUpstream';
import { useSessionUpstream } from './helpers/sessionRoutes';

const uin = String(CONTRACT_CREDENTIAL.str_musicid || CONTRACT_CREDENTIAL.musicid);
describe.each(CATALOG_RUNTIMES)('收藏与收藏状态（%s）', (runtime) => {
  const upstream = useSessionUpstream(runtime);
  const call = async (path: string, body?: unknown, mode: 'valid' | 'missing' = 'valid') => {
    const options = await upstream.options(mode);
    await options.beforeEachLeg?.();
    return callRoute(runtime, path, {
      method: body === undefined ? 'GET' : 'POST',
      body,
      headers: options.token ? { 'X-QQ-Session': options.token } : {},
      env: options.env,
    });
  };
  const subscribe = (
    body: unknown = { tid: 70001, subscribed: true },
    mode: 'valid' | 'missing' = 'valid',
  ) => call('/user/playlist/subscribe', body, mode);
  beforeEach(() => {
    upstream.state.rpcReplies = {
      FavPlaylist: { data: { result: 0, v_failedPlaylistId: [], reason: 'fixture-private' } },
      CancelFavPlaylist: { data: { result: 0, v_failedPlaylistId: [] } },
      IsPlaylistFan: { data: { m_fan: { '70001': true, '70002': false } } },
      IsAlbumFan: { data: { m_fan: { FixtureAlbumA1: true, FixtureAlbumB1: false } } },
      IsSongFanByMid: {
        data: { m_fan: { FixtureSongA1: true, FixtureSongB1: false }, source: 'fixture-private' },
      },
    };
  });
  it.each([
    true,
    false,
  ])('收藏目标状态 %s，uin 是数字字符串、tid 是数字数组', async (subscribed) => {
    const result = await subscribe({ tid: '70001', subscribed });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ code: 200, subscribed });
    expect(upstream.calls.flatMap((c) => c.rpc)).toEqual([
      {
        module: 'music.musicasset.PlaylistFavWrite',
        method: subscribed ? 'FavPlaylist' : 'CancelFavPlaylist',
        param: { uin, v_playlistId: [70001] },
      },
    ]);
  });
  it('缺会话不请求上游', async () => {
    expect((await subscribe(undefined, 'missing')).status).toBe(401);
    expect(
      (await call('/user/subscription-status?type=playlist&ids=70001', undefined, 'missing'))
        .status,
    ).toBe(401);
    expect(upstream.calls).toHaveLength(0);
  });
  it('GET 收藏写入不执行', async () => {
    expect((await call('/user/playlist/subscribe')).status).toBe(405);
    expect(upstream.calls).toHaveLength(0);
  });
  it.each([
    {},
    { tid: 70001, subscribed: 'true' },
    { tid: -1, subscribed: true },
    { tid: 70001, subscribed: true, uin: '99999' },
  ])('非法写入参数不执行', async (body) => {
    expect((await subscribe(body)).status).toBe(400);
    expect(upstream.calls).toHaveLength(0);
  });
  it.each([
    { result: 1, v_failedPlaylistId: [] },
    { result: 0, v_failedPlaylistId: [70001] },
    { result: 0 },
  ])('内层拒绝或失败列表缺失不当成功', async (data) => {
    upstream.state.rpcReplies!.FavPlaylist.data = data;
    expect((await subscribe()).status).toBe(502);
    expect(upstream.calls.flatMap((c) => c.rpc)).toHaveLength(1);
  });
  it('写入 HTTP 503 不重试', async () => {
    upstream.state.rpcReplies!.FavPlaylist = { httpStatus: 503 };
    expect((await subscribe()).status).toBe(502);
    expect(upstream.calls.flatMap((c) => c.rpc)).toHaveLength(1);
  });
  it.each([
    [
      'playlist',
      '70001,70002',
      'music.musicasset.PlaylistFavRead',
      'IsPlaylistFan',
      { v_tid: [70001, 70002] },
    ],
    [
      'album',
      'FixtureAlbumA1,FixtureAlbumB1',
      'music.musicasset.AlbumFavRead',
      'IsAlbumFan',
      { uin: Number(uin), v_albumMid: ['FixtureAlbumA1', 'FixtureAlbumB1'] },
    ],
    [
      'song',
      'FixtureSongA1,FixtureSongB1',
      'music.musicasset.SongFavRead',
      'IsSongFanByMid',
      { v_songMid: ['FixtureSongA1', 'FixtureSongB1'] },
    ],
  ] as const)('%s 已收藏与未收藏明确区分，参数照实测', async (type, ids, module, method, param) => {
    const result = await call(`/user/subscription-status?type=${type}&ids=${ids}`);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      code: 200,
      type,
      items: ids
        .split(',')
        .map((id, index) => ({ id, status: index ? 'not-subscribed' : 'subscribed' })),
    });
    expect(upstream.calls.flatMap((c) => c.rpc)).toEqual([{ module, method, param }]);
    expect(JSON.stringify(result.body)).not.toContain('fixture-private');
  });
  it('缺失或非布尔条目是 unknown，不假装未收藏', async () => {
    upstream.state.rpcReplies!.IsPlaylistFan.data = { m_fan: { '70001': 'false' } };
    expect((await call('/user/subscription-status?type=playlist&ids=70001,70002')).body).toEqual({
      code: 200,
      type: 'playlist',
      items: [
        { id: '70001', status: 'unknown' },
        { id: '70002', status: 'unknown' },
      ],
    });
  });
  it('状态查询业务失败与无效结构回错误，不给 false', async () => {
    upstream.state.rpcReplies!.IsPlaylistFan = { code: 1000 };
    const failed = await call('/user/subscription-status?type=playlist&ids=70001');
    expect(failed.status).toBe(502);
    expect(failed.body).not.toHaveProperty('items');
    upstream.state.rpcReplies!.IsPlaylistFan = { data: {} };
    expect((await call('/user/subscription-status?type=playlist&ids=70001')).status).toBe(502);
  });
  it.each([
    '',
    '?type=unknown&ids=70001',
    '?type=playlist&ids=-1',
    '?type=album&ids=invalid%20id',
    '?type=playlist&ids=' + Array.from({ length: 101 }, (_, i) => i + 1).join(','),
  ])('无效状态查询 %s 不请求上游', async (query) => {
    expect((await call('/user/subscription-status' + query)).status).toBe(400);
    expect(upstream.calls).toHaveLength(0);
  });
});
