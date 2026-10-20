import './helpers/sessionRoutes';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CATALOG_RUNTIMES, callRoute } from './helpers/catalogRoutes';
import { CONTRACT_CREDENTIAL } from './helpers/contractUpstream';
import { useSessionUpstream } from './helpers/sessionRoutes';

it('文档与 Explorer 不再提逐首 existed，整体变更只看 changed', () => {
  const readme = readFileSync(resolve(__dirname, '../docs/README.md'), 'utf8');
  const section = readme.slice(
    readme.indexOf('### 5. 歌单与收藏写入'),
    readme.indexOf('### 6. 会员状态'),
  );
  expect(section).toContain('{ code: 200, changed: true }');
  expect(section).not.toContain('existed');
  const explorer = readFileSync(resolve(__dirname, '../src/config/apiExplorer.ts'), 'utf8');
  expect(explorer).not.toContain('existed');
});

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
      CgiGetDiss: {
        data: { songlist: [{ id: 101 }], total_song_num: 1, hasmore: 0 },
      },
    };
  });
  it.each(['add', 'del'])('%s 分别验证请求协议和结果', async (op) => {
    const result = await call({ ...input, op });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ code: 200, changed: true });
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
    upstream.state.rpcReplies!.CgiGetDiss.data = {
      songlist: op === 'add' ? [{ id: 101 }] : [],
      total_song_num: op === 'add' ? 1 : 0,
      hasmore: 0,
    };
    expect((await call({ ...input, op })).body).toEqual({
      code: 200,
      changed: false,
      verification: { status: op === 'add' ? 'present' : 'absent' },
    });
  });
  it.each([
    [{ dirId: 11, tid: 70001, songlist: [{ songId: 101, songType: 0, existed: 2 }] }, true],
    [{ dirId: 11, tid: 70001, songlist: [{ songId: 999, songType: 0, existed: 0 }] }, true],
    [{ dirId: 11, tid: 70001 }, true],
    [{ dirId: 0, tid: 0, songlist: [{ songId: 101, songType: 0, existed: 0 }] }, false],
  ])('加歌回应不带逐首 existed，上游 songlist 长什么样都不影响结果：%j', async (result, changed) => {
    upstream.state.rpcReplies!.AddSonglist.data = { retCode: 0, result };
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      code: 200,
      changed,
      ...(!changed ? { verification: { status: 'present' } } : {}),
    });
    expect(upstream.calls.flatMap((c) => c.rpc).map((r) => r.method)).toEqual([
      'GetPlaylistByUin',
      'AddSonglist',
      ...(!changed ? ['CgiGetDiss'] : []),
    ]);
  });
  it.each([
    [
      { songlist: [{ id: 101 }, { id: 102 }], total_song_num: 2, hasmore: 0 },
      [101, 102],
      'present',
    ],
    [{ songlist: [{ songid: '101' }], total_song_num: 1, hasmore: false }, [101], 'present'],
    [{ songlist: [{ id: 101 }], total_song_num: 300, hasmore: 1 }, [101], 'present'],
    [{ songlist: [{ id: 101 }, {}], total_song_num: 2, hasmore: 0 }, [101], 'present'],
    [{ songlist: [], total_song_num: 0, hasmore: 0 }, [101, 102], 'absent'],
    [{ songlist: [{ id: 103 }], total_song_num: 1, hasmore: false }, [101, 102], 'absent'],
    [{ songlist: [{ id: 101 }], total_song_num: 1, hasmore: 0 }, [101, 102], 'unknown'],
    [{ songlist: [{ id: 103 }], total_song_num: 300, hasmore: 1 }, [101], 'unknown'],
    [{ songlist: [{ id: 103 }], total_song_num: 1, hasmore: 1 }, [101], 'unknown'],
    [{ songlist: [{ id: 103 }], total_song_num: 1 }, [101], 'unknown'],
    [{ songlist: [{ id: 103 }], hasmore: 0 }, [101], 'unknown'],
    [{ songlist: [{ id: 103 }], total_song_num: 0, hasmore: 0 }, [101], 'unknown'],
    [{ songlist: [{ id: 103 }], total_song_num: -1, hasmore: 0 }, [101], 'unknown'],
    [{ songlist: [{ id: 103 }], total_song_num: 1, hasmore: 'false' }, [101], 'unknown'],
    [{ songlist: [{ id: 103 }, { id: 103 }], total_song_num: 2, hasmore: 0 }, [101], 'unknown'],
    [{ songlist: [{ id: 101, songid: 102 }], total_song_num: 1, hasmore: 0 }, [101], 'unknown'],
    [{ songlist: [{}], total_song_num: 1, hasmore: 0 }, [101], 'unknown'],
    [{ songlist: [null], total_song_num: 1, hasmore: 0 }, [101], 'unknown'],
    [
      { songlist: [{ id: 101, songid: '101' }], total_song_num: 1, hasmore: 0 },
      [101, 101],
      'present',
    ],
    [{ songlist: [{ id: 9007199254740992 }], total_song_num: 1, hasmore: 0 }, [101], 'unknown'],
    [{ songlist: null, total_song_num: 0, hasmore: 0 }, [101], 'unknown'],
    [{ code: 1000, songlist: [{ id: 101 }], total_song_num: 1, hasmore: 0 }, [101], 'unknown'],
    [{ subcode: 1, songlist: [], total_song_num: 0, hasmore: 0 }, [101], 'unknown'],
    [{ code: '0', songlist: [], total_song_num: 0, hasmore: 0 }, [101], 'unknown'],
    [
      { code: 0, subcode: 0, songlist: [{ id: 101 }], total_song_num: 1, hasmore: 0 },
      [101],
      'present',
    ],
    [null, [101], 'unknown'],
  ] as const)('无变更只根据实际读回判定 %s', async (data, ids, status) => {
    upstream.state.rpcReplies!.AddSonglist.data = { retCode: 0, result: { dirId: 0, tid: 0 } };
    upstream.state.rpcReplies!.CgiGetDiss.data = data;
    const result = await call({ ...input, songs: ids.map((id) => ({ id, type: 0 })) });
    expect(result).toMatchObject({
      status: 200,
      body: { code: 200, changed: false, verification: { status } },
    });
    const reads = upstream.calls.flatMap((c) => c.rpc).filter((r) => r.method === 'CgiGetDiss');
    expect(reads).toEqual([
      {
        module: 'music.srfDissInfo.DissInfo',
        method: 'CgiGetDiss',
        param: {
          disstid: 70001,
          dirid: 11,
          tag: true,
          song_begin: 0,
          song_num: 100,
          userinfo: true,
          orderlist: true,
          enc_host_uin: CONTRACT_CREDENTIAL.encryptUin,
        },
      },
    ]);
    expect(
      upstream.calls.flatMap((c) => c.rpc).filter((r) => r.method === 'AddSonglist'),
    ).toHaveLength(1);
  });
  it.each([
    { httpStatus: 503 },
    { httpStatus: 429 },
    { code: 1000 },
    { code: 500003 },
    { data: { message: 'fixture-private-read-error' } },
  ])('读回失败只加 unknown，保留无变更结果且不重送', async (reply) => {
    upstream.state.rpcReplies!.AddSonglist.data = { retCode: 0, result: { dirId: 0, tid: 0 } };
    upstream.state.rpcReplies!.CgiGetDiss = reply;
    const response = await call();
    expect(response).toMatchObject({
      status: 200,
      body: { code: 200, changed: false, verification: { status: 'unknown' } },
    });
    expect(JSON.stringify(response.body)).not.toContain('fixture-private');
    expect(upstream.calls.flatMap((c) => c.rpc).map((r) => r.method)).toEqual([
      'GetPlaylistByUin',
      'AddSonglist',
      'CgiGetDiss',
    ]);
  });
  it('缺少详情所需凭证时返回 unknown，不重新写入', async () => {
    upstream.state.credentialOverrides = { encryptUin: '' };
    upstream.state.rpcReplies!.AddSonglist.data = { retCode: 0, result: { dirId: 0, tid: 0 } };
    expect((await call()).body).toEqual({
      code: 200,
      changed: false,
      verification: { status: 'unknown' },
    });
    expect(upstream.calls.flatMap((c) => c.rpc).map((r) => r.method)).toEqual([
      'GetPlaylistByUin',
      'AddSonglist',
    ]);
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
