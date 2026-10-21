import './helpers/sessionRoutes';
import { CATALOG_RUNTIMES, callRoute } from './helpers/catalogRoutes';
import { useSessionUpstream } from './helpers/sessionRoutes';

describe.each(CATALOG_RUNTIMES)('/song/fav-count（%s）', (runtime) => {
  const upstream = useSessionUpstream(runtime);
  const call = (query = 'ids=90002,90001,90002') => callRoute(runtime, `/song/fav-count?${query}`);
  const reply = (data: unknown) => {
    upstream.state.rpcReplies = { GetSongFansNumberById: { data } };
  };

  it('匿名只查一次去重后的数字编号，结果保留原输入顺序和重复项', async () => {
    reply({ m_numbers: { '90001': 0, '90002': 12 }, m_show: { '90002': 'fixture-count' } });
    const result = await call();
    expect(result).toEqual({
      status: 200,
      body: {
        code: 200,
        items: [
          { id: 90002, count: 12, display: 'fixture-count' },
          { id: 90001, count: 0, display: null },
          { id: 90002, count: 12, display: 'fixture-count' },
        ],
      },
    });
    expect(upstream.calls.flatMap((c) => c.rpc)).toEqual([
      {
        module: 'music.musicasset.SongFavRead',
        method: 'GetSongFansNumberById',
        param: { v_songId: [90002, 90001] },
      },
    ]);
    expect(upstream.calls).toHaveLength(1);
  });

  it('部分缺失用 null，忽略其他编号，不按映射枚举顺序输出', async () => {
    reply({ m_numbers: { '90001': 7, '99999': 8 }, m_show: {} });
    expect((await call('ids=90002,90001')).body).toEqual({
      code: 200,
      items: [
        { id: 90002, count: null, display: null },
        { id: 90001, count: 7, display: null },
      ],
    });
  });

  it('允许只有展示文字，空展示文字原样保留', async () => {
    reply({ m_show: { '90001': '' } });
    expect((await call('ids=90001')).body).toEqual({
      code: 200,
      items: [{ id: 90001, count: null, display: '' }],
    });
  });

  it('接受 20 个输入，空格和前导零不影响数字去重', async () => {
    const ids = Array.from({ length: 20 }, (_, i) => 90001 + i);
    reply({ m_numbers: Object.fromEntries(ids.map((id) => [id, 1])) });
    const result = await call(`ids=${ids.join(',')}`);
    expect(result.status).toBe(200);
    expect(upstream.calls[0].rpc[0].param).toEqual({ v_songId: ids });
    upstream.calls.length = 0;
    expect((await call('ids=%20090001%20,90001')).status).toBe(200);
    expect(upstream.calls[0].rpc[0].param).toEqual({ v_songId: [90001] });
  });

  it('重复 query 参数取第一个值，两边一致', async () => {
    reply({ m_numbers: { '90001': 1 } });
    expect((await call('ids=90001&ids=bad')).status).toBe(200);
    expect(upstream.calls[0].rpc[0].param).toEqual({ v_songId: [90001] });
  });

  it.each([
    '',
    'ids=',
    'ids=0',
    'ids=-1',
    'ids=1.5',
    'ids=1e3',
    'ids=abc',
    'ids=90001,',
    'ids=,90001',
    'ids=9007199254740992',
    `ids=${Array(21).fill('90001').join(',')}`,
  ])('参数不合法 %s 回 400，不请求上游', async (query) => {
    expect((await call(query)).status).toBe(400);
    expect(upstream.calls).toHaveLength(0);
  });

  it.each([
    {},
    { m_numbers: {}, m_show: {} },
    { m_numbers: { '99999': 1 } },
    { m_numbers: { '90001': null }, m_show: { '90001': null } },
  ])('整批没有数据 %j 回 422', async (data) => {
    reply(data);
    const result = await call('ids=90001');
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ kind: 'not-found', errorKey: 'resource.not-found' });
  });

  it.each([
    'bad',
    { m_numbers: [] },
    { m_show: [] },
    { m_numbers: { '90001': '7' } },
    { m_numbers: { '90001': -1 } },
    { m_numbers: { '90001': 1.5 } },
    { m_show: { '90001': 7 } },
  ])('格式异常 %j 回 502', async (data) => {
    reply(data);
    const result = await call('ids=90001');
    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({ kind: 'invalid-response' });
  });

  it.each([
    1000, 10001, 104400, 104401, 20279, 999999,
  ])('未知业务码 %s 回 502，不扩展认证分类', async (code) => {
    upstream.state.rpcReplies = { GetSongFansNumberById: { code } };
    const result = await call();
    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({ kind: 'upstream-business', upstreamCode: code });
    expect(upstream.calls).toHaveLength(1);
  });

  it('网关、HTTP 与网络错误保留现有 kind，不泄露原文', async () => {
    reply({});
    upstream.state.globalCode = 500003;
    expect((await call()).body).toMatchObject({ kind: 'upstream-gateway' });
    delete upstream.state.globalCode;
    upstream.state.httpStatus = 503;
    expect((await call()).body).toMatchObject({ kind: 'upstream-http', upstreamHttpStatus: 503 });
    delete upstream.state.httpStatus;
    upstream.state.networkError = new Error('fixture-private');
    const result = await call();
    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({ kind: 'network' });
    expect(JSON.stringify(result.body)).not.toContain('fixture-private');
  });
});
