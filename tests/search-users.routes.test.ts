import './helpers/sessionRoutes';
import { CATALOG_RUNTIMES, callRoute } from './helpers/catalogRoutes';
import { useSessionUpstream } from './helpers/sessionRoutes';

const USERS = [
  { title: 'fixture-user-a', custom: { untouched: true } },
  { title: 'fixture-user-b' },
];
const dataOf = (users: unknown = USERS, sum: unknown = 42) => ({
  code: 0,
  body: { item_user: users },
  meta: { sum },
});

describe.each(CATALOG_RUNTIMES)('/search/users（%s）', (runtime) => {
  const upstream = useSessionUpstream(runtime);
  const reply = (data: unknown) => {
    upstream.state.rpcReplies = { DoSearchForQQMusicMobile: { data } };
  };
  const call = async (
    query = 'keyword=fixture-user',
    mode: 'valid' | 'missing' | 'invalid' | 'expired' = 'valid',
    env?: Record<string, string>,
  ) => {
    const options = await upstream.options(mode);
    await options.beforeEachLeg?.();
    return callRoute(runtime, `/search/users?${query}`, {
      headers: options.token ? { 'X-QQ-Session': options.token } : {},
      env: env ?? options.env,
    });
  };

  it('带会话使用移动版类型 8，保留用户原格式并返回总数', async () => {
    reply(dataOf());
    const result = await call();
    expect(result).toEqual({ status: 200, body: { code: 200, users: USERS, total: 42 } });
    expect(upstream.calls).toHaveLength(1);
    expect(upstream.calls[0].rpc).toEqual([
      {
        module: 'music.search.SearchCgiService',
        method: 'DoSearchForQQMusicMobile',
        param: {
          searchid: expect.stringMatching(/^\d+$/),
          query: 'fixture-user',
          search_type: 8,
          num_per_page: 10,
          page_num: 1,
          highlight: false,
          grp: true,
          selectors: {},
          vec_selectors: [],
        },
      },
    ]);
  });
  it('分页接受上限 20，关键词去除首尾空格，重复参数取首值', async () => {
    reply(dataOf());
    expect(
      (await call('keyword=%20fixture-user%20&keyword=ignored&page=2&limit=20&limit=1')).status,
    ).toBe(200);
    expect(upstream.calls[0].rpc[0].param).toMatchObject({
      query: 'fixture-user',
      page_num: 2,
      num_per_page: 20,
    });
  });
  it.each([
    undefined,
    null,
    '42',
    -1,
    1.5,
    9007199254740992,
  ])('不可靠总数 %s 返回 null', async (sum) => {
    const data = dataOf();
    data.meta.sum = sum;
    reply(data);
    expect((await call()).body).toEqual({ code: 200, users: USERS, total: null });
  });
  it('总数 0 保留为数字', async () => {
    reply(dataOf(USERS, 0));
    expect((await call()).body).toMatchObject({ total: 0 });
  });
  it('空页回 422，不把总数非零当成本页有数据', async () => {
    reply(dataOf([]));
    const result = await call();
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ kind: 'not-found' });
  });
  it.each([
    '',
    'keyword=',
    'keyword=%20',
    `keyword=${'x'.repeat(61)}`,
    'keyword=fixture&page=0',
    'keyword=fixture&page=',
    'keyword=fixture&page=1.5',
    'keyword=fixture&page=9007199254740992',
    'keyword=fixture&limit=0',
    'keyword=fixture&limit=21',
    'keyword=fixture&limit=',
    'keyword=fixture&limit=2x',
  ])('参数错误 %s 回 400，不请求上游', async (query) => {
    expect((await call(query)).status).toBe(400);
    expect(upstream.calls).toHaveLength(0);
  });
  it.each([
    'missing',
    'invalid',
    'expired',
  ] as const)('会话 %s 回 401，不请求上游', async (mode) => {
    expect((await call(undefined, mode)).status).toBe(401);
    expect(upstream.calls).toHaveLength(0);
  });
  it.each([
    'bad',
    {},
    { body: {}, meta: {} },
    dataOf({}),
    dataOf([null]),
    dataOf(['fixture']),
    { code: 9, body: { item_user: USERS }, meta: {} },
  ])('格式异常或内层拒绝 %j 回 502', async (data) => {
    reply(data);
    const result = await call();
    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({ kind: 'invalid-response' });
  });
  it.each([
    1000, 10001, 104400, 104401, 20279, 999999,
  ])('未验证业务码 %s 保持 502，不清会话', async (code) => {
    upstream.state.rpcReplies = { DoSearchForQQMusicMobile: { code } };
    const result = await call();
    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({ kind: 'upstream-business', upstreamCode: code });
  });
  it('网关与网络失败回安全的 502', async () => {
    reply(dataOf());
    upstream.state.globalCode = 500003;
    expect((await call()).body).toMatchObject({ kind: 'upstream-gateway' });
    delete upstream.state.globalCode;
    upstream.state.networkError = new Error('fixture-private');
    const result = await call();
    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({ kind: 'network' });
    expect(JSON.stringify(result.body)).not.toContain('fixture-private');
  });
  if (runtime === 'serverless')
    it('缺少密钥回 501，不请求上游', async () => {
      expect((await call(undefined, 'missing', {})).status).toBe(501);
      expect(upstream.calls).toHaveLength(0);
    });
});
