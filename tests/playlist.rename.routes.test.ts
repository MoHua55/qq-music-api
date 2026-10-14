import './helpers/sessionRoutes';
import { CATALOG_RUNTIMES, callRoute } from './helpers/catalogRoutes';
import { useSessionUpstream } from './helpers/sessionRoutes';

describe.each(CATALOG_RUNTIMES)('歌单只改名称（%s）', (runtime) => {
  const upstream = useSessionUpstream(runtime);
  const owned = { tid: 70001, dirId: 11, dirName: '原名称' };
  const before = {
    dirid: 11,
    title: '原名称',
    desc: '非空描述',
    picurl: 'https://image.invalid/fixture?imageView2/4/w/300/h/300',
    picurl2: '',
    tag: [
      { id: 7, name: '标签甲' },
      { id: 8, name: '标签乙' },
    ],
    dir_show: 2,
  };
  const call = async (
    body: unknown = { tid: 70001, name: '新名称' },
    mode: 'valid' | 'missing' = 'valid',
    method: 'GET' | 'POST' = 'POST',
  ) => {
    const options = await upstream.options(mode);
    await options.beforeEachLeg?.();
    return callRoute(runtime, '/user/playlist/rename', {
      method,
      body: method === 'POST' ? body : undefined,
      headers: options.token ? { 'X-QQ-Session': options.token } : {},
      env: options.env,
    });
  };
  const reads = (initial: unknown = before, after: unknown = { ...before, title: '新名称' }) => {
    upstream.state.rpcReplyQueues = {
      uniform_get_Dissinfo: [{ data: { dirinfo: initial } }, { data: { dirinfo: after } }],
    };
  };
  beforeEach(() => {
    upstream.state.rpcReplies = {
      GetPlaylistByUin: { data: { v_playlist: [owned] } },
      EditPlaylist: {
        data: { retCode: 0, result: { dirId: 11, tid: 70001, dirName: 'fixture-garbled' } },
      },
    };
    reads();
  });
  it('使用编辑页的精确读法，封面查询串和其他设置原样回送并读回确认', async () => {
    const result = await call();
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ code: 200, tid: 70001, name: '新名称', verified: true });
    const rpc = upstream.calls.flatMap((c) => c.rpc);
    expect(rpc.map((r) => r.method)).toEqual([
      'GetPlaylistByUin',
      'uniform_get_Dissinfo',
      'EditPlaylist',
      'uniform_get_Dissinfo',
    ]);
    expect(rpc[1]).toEqual({
      module: 'music.srfDissInfo.aiDissInfo',
      method: 'uniform_get_Dissinfo',
      param: { dirid: 11, optype: 3, tag: 1, userinfo: 0, pic_dpi: 300 },
    });
    expect(rpc[2]).toEqual({
      module: 'music.musicasset.PlaylistBaseWrite',
      method: 'EditPlaylist',
      param: {
        dirId: 11,
        mask: 95,
        dirNewName: '新名称',
        dirNewDesc: before.desc,
        dirNewPicUrl: before.picurl,
        dirNewPicUrl2: '',
        dirNewtaglist: '7,8',
        dirShow: 2,
      },
    });
    expect(rpc[3]).toEqual(rpc[1]);
  });
  it('公开歌单保持 1，空描述、标签与封面也保持原值', async () => {
    const value = { ...before, desc: '', picurl: '', tag: [], dir_show: 1 };
    reads(value, { ...value, title: '新名称' });
    expect((await call()).status).toBe(200);
    expect(
      upstream.calls.flatMap((c) => c.rpc).find((r) => r.method === 'EditPlaylist')!.param,
    ).toMatchObject({ dirNewDesc: '', dirNewPicUrl: '', dirNewtaglist: '', dirShow: 1 });
  });
  it('缺会话与 GET 不读也不写', async () => {
    expect((await call(undefined, 'missing')).status).toBe(401);
    expect((await call(undefined, 'valid', 'GET')).status).toBe(405);
    expect(upstream.calls).toHaveLength(0);
  });
  it.each([
    { tid: 70001, name: '' },
    { tid: 70001, name: 'a'.repeat(21) },
    { tid: 0, name: '新名称' },
    { tid: 70001, name: '新名称', desc: '修改' },
    { tid: 70001, name: '新名称', dirShow: 1 },
  ])('输入仅允许 tid 与有效名称', async (body) => {
    expect((await call(body)).status).toBe(400);
    expect(upstream.calls).toHaveLength(0);
  });
  it.each([
    { v_playlist: [] },
    { v_playlist: [{ ...owned, dirId: 201 }] },
    { v_playlist: [{ ...owned, dirType: 2 }] },
    { v_playlist: [{ ...owned, uin: '99999' }] },
  ])('只改自己的普通歌单', async ({ v_playlist }) => {
    upstream.state.rpcReplies!.GetPlaylistByUin.data = { v_playlist };
    expect((await call()).status).toBe(400);
    expect(upstream.calls.flatMap((c) => c.rpc).some((r) => r.method === 'EditPlaylist')).toBe(
      false,
    );
  });
  it.each([
    { ...before, dir_show: 0 },
    { ...before, dir_show: 3 },
    { ...before, dir_show: undefined },
    { ...before, desc: undefined },
    { ...before, picurl: null },
    { ...before, tag: '7,8' },
    { ...before, tag: [{ id: '7', name: '标签' }] },
    { ...before, dirid: 12 },
    { ...before, picurl2: 'https://image.invalid/unverified-secondary' },
  ])('不完整或未验证的现值不写入，更不能把隐私默认改成公开', async (value) => {
    reads(value);
    expect((await call()).status).toBe(502);
    expect(upstream.calls.flatMap((c) => c.rpc).some((r) => r.method === 'EditPlaylist')).toBe(
      false,
    );
  });
  it.each([
    { ...before, title: '其他名称' },
    { ...before, title: '新名称', desc: '被修改' },
    { ...before, title: '新名称', picurl: 'https://image.invalid/fixture' },
    { ...before, title: '新名称', tag: [] },
    { ...before, title: '新名称', dir_show: 1 },
  ])('写后名称或设置不一致明确未确认，不回滚或重试', async (value) => {
    reads(before, value);
    const result = await call();
    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({
      retryable: false,
      writeAttempted: true,
      verification: 'unconfirmed',
      tid: 70001,
    });
    expect(result.body).not.toHaveProperty('verified');
    expect(
      upstream.calls.flatMap((c) => c.rpc).filter((r) => r.method === 'EditPlaylist'),
    ).toHaveLength(1);
  });
  it('HTTP 503 不重送改名', async () => {
    upstream.state.rpcReplies!.EditPlaylist = { httpStatus: 503 };
    const result = await call();
    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({ retryable: false, writeAttempted: true });
    expect(
      upstream.calls.flatMap((c) => c.rpc).filter((r) => r.method === 'EditPlaylist'),
    ).toHaveLength(1);
  });
  it('全 0 但返回其他目录仍失败', async () => {
    upstream.state.rpcReplies!.EditPlaylist.data = {
      retCode: 0,
      result: { dirId: 12, tid: 70001 },
    };
    expect((await call()).status).toBe(502);
  });
});
