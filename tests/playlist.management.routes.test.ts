import './helpers/sessionRoutes';
import { CATALOG_RUNTIMES, callRoute } from './helpers/catalogRoutes';
import { useSessionUpstream } from './helpers/sessionRoutes';

describe.each(CATALOG_RUNTIMES)('歌单建立与删除（%s）', (runtime) => {
  const upstream = useSessionUpstream(runtime);
  const owned = { tid: 70001, dirId: 11, dirName: '测试歌单', dirShow: 1 };
  const call = async (
    action: 'create' | 'delete',
    body: unknown,
    mode: 'valid' | 'missing' = 'valid',
    method: 'GET' | 'POST' = 'POST',
  ) => {
    const options = await upstream.options(mode);
    await options.beforeEachLeg?.();
    return callRoute(runtime, `/user/playlist/${action}`, {
      method,
      body: method === 'POST' ? body : undefined,
      headers: options.token ? { 'X-QQ-Session': options.token } : {},
      env: options.env,
    });
  };
  beforeEach(() => {
    upstream.state.rpcReplies = {
      AddPlaylist: {
        data: {
          retCode: 0,
          hit_type: 0,
          hit_reason: 0,
          result: {
            ...owned,
            dirName: 'fixture-garbled',
            bSafetyHitName: false,
            bSafetyHitDesc: false,
          },
        },
      },
      DelPlaylist: { data: { retCode: 0, result: { ...owned, updateTime: 0 } } },
      GetPlaylistByUin: { data: { v_playlist: [owned] } },
    };
  });
  it('建立只送 dirName，名称以读回为准，不用乱码回包', async () => {
    const result = await call('create', { name: '测试歌单' });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      code: 200,
      tid: 70001,
      dirId: 11,
      name: '测试歌单',
      verified: true,
      moderation: { bSafetyHitName: false, bSafetyHitDesc: false, hit_type: 0, hit_reason: 0 },
    });
    const rpc = upstream.calls.flatMap((c) => c.rpc);
    expect(rpc.map((r) => r.method)).toEqual(['AddPlaylist', 'GetPlaylistByUin']);
    expect(rpc[0]).toEqual({
      module: 'music.musicasset.PlaylistBaseWrite',
      method: 'AddPlaylist',
      param: { dirName: '测试歌单' },
    });
    expect(JSON.stringify(result.body)).not.toContain('fixture-garbled');
  });
  it('删除先核对自建归属、只送 dirId，再读回消失才成功', async () => {
    upstream.state.rpcReplyQueues = {
      GetPlaylistByUin: [{ data: { v_playlist: [owned] } }, { data: { v_playlist: [] } }],
    };
    const result = await call('delete', { tid: '70001' });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ code: 200, tid: 70001, deleted: true, verified: true });
    const rpc = upstream.calls.flatMap((c) => c.rpc);
    expect(rpc.map((r) => r.method)).toEqual([
      'GetPlaylistByUin',
      'DelPlaylist',
      'GetPlaylistByUin',
    ]);
    expect(rpc[1]).toEqual({
      module: 'music.musicasset.PlaylistBaseWrite',
      method: 'DelPlaylist',
      param: { dirId: 11 },
    });
  });
  it.each(['create', 'delete'] as const)('%s 没会话或 GET 不写入', async (action) => {
    const body = action === 'create' ? { name: '测试歌单' } : { tid: 70001 };
    expect((await call(action, body, 'missing')).status).toBe(401);
    expect((await call(action, body, 'valid', 'GET')).status).toBe(405);
    expect(upstream.calls).toHaveLength(0);
  });
  it.each(['', ' ', 'a'.repeat(21), 123, null])('无效建立名称 %s 不写入', async (name) => {
    expect((await call('create', { name })).status).toBe(400);
    expect(upstream.calls).toHaveLength(0);
  });
  it('不接收调用方 dirId 或其他设置', async () => {
    expect((await call('create', { name: '测试歌单', dirShow: 2 })).status).toBe(400);
    expect((await call('delete', { tid: 70001, dirId: 11 })).status).toBe(400);
    expect(upstream.calls).toHaveLength(0);
  });
  it.each([201, 202, 300])('受保护／未确认目录 %s 不删除', async (dirId) => {
    upstream.state.rpcReplies!.GetPlaylistByUin.data = { v_playlist: [{ ...owned, dirId }] };
    expect((await call('delete', { tid: 70001 })).status).toBe(400);
    expect(upstream.calls.flatMap((c) => c.rpc).map((r) => r.method)).toEqual(['GetPlaylistByUin']);
  });
  it.each([
    [],
    [{ ...owned, uin: '99999' }],
    [{ ...owned, dirType: 2 }],
    [owned, { ...owned }],
  ])('非本人或不可靠的自建清单不删除', async (v_playlist) => {
    upstream.state.rpcReplies!.GetPlaylistByUin.data = { v_playlist };
    expect((await call('delete', { tid: 70001 })).status).toBe(400);
    expect(upstream.calls.flatMap((c) => c.rpc).some((r) => r.method === 'DelPlaylist')).toBe(
      false,
    );
  });
  it.each([
    'create',
    'delete',
  ] as const)('%s 的 HTTP 503 仅送一次，回包不能要求重试写入', async (action) => {
    const method = action === 'create' ? 'AddPlaylist' : 'DelPlaylist';
    upstream.state.rpcReplies![method] = { httpStatus: 503 };
    const result = await call(action, action === 'create' ? { name: '测试歌单' } : { tid: 70001 });
    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({ retryable: false, writeAttempted: true });
    expect(upstream.calls.flatMap((c) => c.rpc).filter((r) => r.method === method)).toHaveLength(1);
  });
  it('删除码全 0 但返回别的目标也失败，不重复发送', async () => {
    upstream.state.rpcReplies!.DelPlaylist.data = {
      retCode: 0,
      result: { dirId: 12, tid: 70002, updateTime: 0 },
    };
    expect((await call('delete', { tid: 70001 })).status).toBe(502);
    expect(
      upstream.calls.flatMap((c) => c.rpc).filter((r) => r.method === 'DelPlaylist'),
    ).toHaveLength(1);
  });
  it('删除后仍在或读回失败明确表示未确认，不误报 deleted', async () => {
    const retained = await call('delete', { tid: 70001 });
    expect(retained.status).toBe(502);
    expect(retained.body).toMatchObject({
      retryable: false,
      writeAttempted: true,
      verification: 'unconfirmed',
    });
    expect(retained.body).not.toHaveProperty('deleted');
  });
  it('建立读回失败保留已知 id 与未确认状态，不鼓励再建一次', async () => {
    upstream.state.rpcReplies!.GetPlaylistByUin = { code: 1000 };
    const result = await call('create', { name: '测试歌单' });
    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({
      retryable: false,
      writeAttempted: true,
      verification: 'unconfirmed',
      tid: 70001,
      dirId: 11,
    });
    expect(
      upstream.calls.flatMap((c) => c.rpc).filter((r) => r.method === 'AddPlaylist'),
    ).toHaveLength(1);
  });
});
