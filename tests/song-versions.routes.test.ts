import './helpers/sessionRoutes';
import { CATALOG_RUNTIMES, callRoute } from './helpers/catalogRoutes';
import { useSessionUpstream } from './helpers/sessionRoutes';

const SONGS = [
  { id: 90002, mid: 'fixtureVersionB', name: 'fixture-song-b', extra: { retained: true } },
];
describe.each(CATALOG_RUNTIMES)('/song/versions（%s）', (runtime) => {
  const upstream = useSessionUpstream(runtime);
  const call = (query = 'id=90001') => callRoute(runtime, `/song/versions?${query}`);
  const reply = (data: unknown) => {
    upstream.state.rpcReplies = { GetOtherVersionSongs: { data } };
  };
  it.each([
    ['id=90001', { songid: 90001 }],
    ['mid=fixtureVersionA', { songmid: 'fixtureVersionA' }],
  ])('匿名按单一标识 %s 查询，歌曲原样返回', async (query, param) => {
    reply({ id: 90001, versionList: SONGS });
    expect(await call(query)).toEqual({ status: 200, body: { code: 200, songs: SONGS } });
    expect(upstream.calls).toHaveLength(1);
    expect(upstream.calls[0].rpc).toEqual([
      { module: 'music.musichallSong.OtherVersionServer', method: 'GetOtherVersionSongs', param },
    ]);
  });
  it('同名 query 参数只取第一个值', async () => {
    reply({ versionList: SONGS });
    expect((await call('id=90001&id=bad')).status).toBe(200);
    expect(upstream.calls[0].rpc[0].param).toEqual({ songid: 90001 });
  });
  it.each([
    '',
    'id=',
    'mid=',
    'id=90001&mid=fixtureVersionA',
    'id=&mid=fixtureVersionA',
    'id=90001&mid=',
    'id=0',
    'id=-1',
    'id=1.2',
    'id=1e3',
    'id=9007199254740992',
    'mid=%20',
    'mid=bad%2Fmid',
    `mid=${'a'.repeat(65)}`,
  ])('标识错误 %s 回 400，不请求上游', async (query) => {
    expect((await call(query)).status).toBe(400);
    expect(upstream.calls).toHaveLength(0);
  });
  it.each([{}, { versionList: null }, { versionList: [] }])('空结果 %j 回 422', async (data) => {
    reply(data);
    const result = await call();
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ kind: 'not-found' });
  });
  it.each([
    'bad',
    { versionList: {} },
    { versionList: [null] },
    { versionList: ['fixture'] },
  ])('格式异常 %j 回 502', async (data) => {
    reply(data);
    const result = await call();
    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({ kind: 'invalid-response' });
  });
  it.each([
    1000, 10001, 104400, 104401, 20279, 999999,
  ])('业务拒绝 %s 不扩大认证或限流语义', async (code) => {
    upstream.state.rpcReplies = { GetOtherVersionSongs: { code } };
    const result = await call();
    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({ kind: 'upstream-business', upstreamCode: code });
  });
  it('网关、HTTP 与网络失败使用现有安全分类', async () => {
    reply({});
    upstream.state.globalCode = 500003;
    expect((await call()).body).toMatchObject({ kind: 'upstream-gateway' });
    delete upstream.state.globalCode;
    upstream.state.httpStatus = 503;
    expect((await call()).body).toMatchObject({ kind: 'upstream-http' });
    delete upstream.state.httpStatus;
    upstream.state.networkError = new Error('fixture-private');
    const result = await call();
    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({ kind: 'network' });
    expect(JSON.stringify(result.body)).not.toContain('fixture-private');
  });
});
