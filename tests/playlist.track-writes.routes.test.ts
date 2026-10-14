import './helpers/sessionRoutes';
import { CATALOG_RUNTIMES, callRoute } from './helpers/catalogRoutes';
import { useSessionUpstream } from './helpers/sessionRoutes';

describe.each(CATALOG_RUNTIMES)('普通歌单增删（%s）', (runtime) => {
  const upstream = useSessionUpstream(runtime);
  const input = { tid: '70001', op: 'add', songs: [{ id: 101, type: 0 }] };
  const call = async (
    body: unknown = input,
    mode: 'valid' | 'missing' = 'valid',
    method: 'GET' | 'POST' = 'POST',
  ) => {
    const options = await upstream.options(mode);
    await options.beforeEachLeg?.();
    return callRoute(runtime, '/user/playlist/tracks', {
      method,
      body: method === 'POST' ? body : undefined,
      headers: options.token ? { 'X-QQ-Session': options.token } : {},
      env: options.env,
    });
  };
  beforeEach(() => {
    upstream.state.rpcReplies = {
      GetPlaylistByUin: { data: { v_playlist: [{ tid: 70001, dirId: 11 }] } },
      AddSonglist: {
        data: {
          retCode: 0,
          result: { dirId: 11, tid: 70001, songlist: [{ songId: 101, songType: 0, existed: 0 }] },
        },
      },
      DelSonglist: { data: { retCode: 0, result: { dirId: 11, tid: 70001, songlist: [] } } },
    };
  });
  it.each(['add', 'del'])('%s 分别验证请求协议和结果', async (op) => {
    const result = await call({ ...input, op });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ code: 200, changed: true });
    const rpcs = upstream.calls.flatMap((c) => c.rpc);
    expect(rpcs.map((r) => r.method)).toEqual([
      'GetPlaylistByUin',
      op === 'add' ? 'AddSonglist' : 'DelSonglist',
    ]);
    expect(rpcs[1]).toEqual({
      module: 'music.musicasset.PlaylistDetailWrite',
      method: op === 'add' ? 'AddSonglist' : 'DelSonglist',
      param: { dirId: 11, v_songInfo: [{ songId: 101, songType: 0 }] },
    });
  });
  it('缺会话先拒绝', async () => {
    expect((await call(input, 'missing')).status).toBe(401);
    expect(upstream.calls).toHaveLength(0);
  });
  it('GET 不写入', async () => {
    expect((await call(input, 'valid', 'GET')).status).toBe(405);
    expect(upstream.calls).toHaveLength(0);
  });
  it.each([
    {},
    { ...input, dirId: 11 },
    { ...input, op: 'wrong' },
    { ...input, op: ['add'] },
    { ...input, songs: [] },
    { ...input, songs: [{ id: 101, type: 1 }] },
    { ...input, songs: [{ id: 101, type: 13 }] },
    { ...input, songs: [{ id: 101 }] },
    { ...input, songs: [{ id: -1, type: 0 }] },
    { ...input, songs: Array.from({ length: 101 }, (_, index) => ({ id: index + 1, type: 0 })) },
  ])('未知歌曲类型或非法参数不送任何上游请求', async (body) => {
    expect((await call(body)).status).toBe(400);
    expect(upstream.calls).toHaveLength(0);
  });
  it.each([201, 202, 300])('系统或未确认目录 %s 不写入', async (dirId) => {
    upstream.state.rpcReplies!.GetPlaylistByUin.data = { v_playlist: [{ tid: 70001, dirId }] };
    expect((await call()).status).toBe(400);
    expect(upstream.calls.flatMap((c) => c.rpc).map((r) => r.method)).toEqual(['GetPlaylistByUin']);
  });
  it('不在自建列表的收藏或别人的歌单不能写', async () => {
    upstream.state.rpcReplies!.GetPlaylistByUin.data = { v_playlist: [] };
    expect((await call()).status).toBe(400);
    expect(upstream.calls.flatMap((c) => c.rpc).map((r) => r.method)).toEqual(['GetPlaylistByUin']);
  });
  it.each(['add', 'del'])('%s 无变更不伪造成功修改', async (op) => {
    upstream.state.rpcReplies![op === 'add' ? 'AddSonglist' : 'DelSonglist'].data = {
      retCode: 0,
      result: {
        dirId: 0,
        tid: 0,
        songlist: op === 'add' ? [{ songId: 101, songType: 0, existed: 1 }] : [],
      },
    };
    expect((await call({ ...input, op })).body).toMatchObject({ code: 200, changed: false });
  });
  it.each(['add', 'del'])('%s 错误或 503 只送一次写入，不重试', async (op) => {
    const method = op === 'add' ? 'AddSonglist' : 'DelSonglist';
    upstream.state.rpcReplies![method] = { code: 2001 };
    expect((await call({ ...input, op })).status).toBe(502);
    expect(upstream.calls.flatMap((c) => c.rpc).filter((r) => r.method === method)).toHaveLength(1);
    upstream.calls.length = 0;
    upstream.state.rpcReplies![method] = { httpStatus: 503 };
    expect((await call({ ...input, op })).status).toBe(502);
    expect(upstream.calls.flatMap((c) => c.rpc).filter((r) => r.method === method)).toHaveLength(1);
  });
  it.each([
    { retCode: 1 },
    { retCode: 0, result: { dirId: 12, tid: 70001 } },
    { retCode: 0, result: { dirId: 11, tid: 70002 } },
  ])('写入结果不完整或不匹配不冒充修改成功', async (data) => {
    upstream.state.rpcReplies!.AddSonglist.data = data;
    expect((await call()).status).toBe(502);
  });
});
