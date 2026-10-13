import { getSingerHotsong } from '../src/routes/operations/getSingerHotsong';
import {
  CATALOG_RUNTIMES,
  type CatalogRuntimeName,
  MUSICU_URL,
  useCatalogUpstream,
} from './helpers/catalogRoutes';
import { createParityRunner } from './helpers/operationParity';

// 歌手热门歌曲保留缺参数的两种回包，以及重复查询和数值转换的旧行为。
const parity = createParityRunner(
  {
    name: 'getSingerHotsong',
    node: '/getSingerHotsong/:singermid?/:limit?/:page?',
    serverless: '/getSingerHotsong',
  },
  {
    operation: getSingerHotsong,
  },
);
const hotsongs = {
  code: 0,
  singer: { code: 0, data: { songlist: [{ mid: 'fixture-song' }], total_song: 1 } },
};
type PerRuntime<T> = Record<CatalogRuntimeName, T>;
const both = <T>(value: T): PerRuntime<T> => ({ node: value, serverless: value });
interface Param {
  singermid: string | string[];
  begin: number | null;
  num: number | null;
}
interface ParityCase {
  label: string;
  query: string;
  param: PerRuntime<Param | null>;
  status?: PerRuntime<number>;
  body?: unknown;
  failure?: boolean;
}
const usual = { singermid: 'fixture-singer', begin: 0, num: 5 };
const cases: ParityCase[] = [
  { label: '成功与默认分页', query: '?singermid=fixture-singer', param: both(usual) },
  {
    label: '指定分页',
    query: '?singermid=fixture-singer&limit=20&page=3',
    param: both({ ...usual, begin: 3, num: 20 }),
  },
  {
    label: '零 limit 与负 page',
    query: '?singermid=fixture-singer&limit=0&page=-1',
    param: both({ ...usual, begin: -1, num: 0 }),
  },
  {
    label: '负 limit 与零 page',
    query: '?singermid=fixture-singer&limit=-2&page=0',
    param: both({ ...usual, begin: 0, num: -2 }),
  },
  {
    label: '非法数字照旧序列化成 null',
    query: '?singermid=fixture-singer&limit=invalid&page=invalid',
    param: both({ ...usual, begin: null, num: null }),
  },
  {
    label: '空分页使用默认值',
    query: '?singermid=fixture-singer&limit=&page=',
    param: both(usual),
  },
  {
    label: '小数照旧发送',
    query: '?singermid=fixture-singer&limit=2.5&page=1.5',
    param: both({ ...usual, begin: 1.5, num: 2.5 }),
  },
  { label: '没有参数', query: '', param: both(null) },
  { label: '空 singermid', query: '?singermid=', param: both(null) },
  { label: '只有无关参数', query: '?id=fixture-singer&limit=0', param: both(null) },
  {
    label: '重复 singermid',
    query: '?singermid=fixture-a&singermid=fixture-b',
    param: {
      node: { ...usual, singermid: ['fixture-a', 'fixture-b'] },
      serverless: { ...usual, singermid: 'fixture-a' },
    },
  },
  {
    label: '重复 singermid 第一项为空',
    query: '?singermid=&singermid=fixture-b',
    param: { node: { ...usual, singermid: ['', 'fixture-b'] }, serverless: null },
  },
  {
    label: '重复 limit 保留各自解析',
    query: '?singermid=fixture-singer&limit=2&limit=3',
    param: { node: { ...usual, num: null }, serverless: { ...usual, num: 2 } },
  },
  {
    label: '重复 page 保留各自解析',
    query: '?singermid=fixture-singer&page=2&page=3',
    param: { node: { ...usual, begin: null }, serverless: { ...usual, begin: 2 } },
  },
  {
    label: '重复分页第一项为空',
    query: '?singermid=fixture-singer&limit=&limit=3&page=&page=2',
    param: { node: { ...usual, num: null, begin: null }, serverless: usual },
  },
  {
    label: '业务拒绝仍回 200',
    query: '?singermid=fixture-singer',
    param: both(usual),
    body: { code: 0, singer: { code: 104003, data: {} } },
  },
  {
    label: '网关业务码原样转交',
    query: '?singermid=fixture-singer',
    param: both(usual),
    body: { code: -1, singer: { code: 0, data: {} } },
  },
  {
    label: '空列表原样转交',
    query: '?singermid=fixture-singer',
    param: both(usual),
    body: { code: 0, singer: { code: 0, data: { songlist: [], total_song: 0 } } },
  },
  {
    label: '上游连不上时安全 500',
    query: '?singermid=fixture-singer',
    param: both(usual),
    failure: true,
    status: both(500),
  },
];

describe.each(CATALOG_RUNTIMES)('/getSingerHotsong 共用处理与真实宿主契约（%s）', (runtime) => {
  const upstream = useCatalogUpstream(runtime);
  it.each(cases)('$label', async (fixture) => {
    if (fixture.failure)
      upstream.fail(Object.assign(new Error('fixture-private-message'), { code: 'ECONNRESET' }));
    else upstream.respond(fixture.body ?? hotsongs);
    const legs = await parity(runtime, `/getSingerHotsong${fixture.query}`, upstream.calls);
    const param = fixture.param[runtime];
    expect(legs.operation.status).toBe(fixture.status?.[runtime] ?? (param === null ? 400 : 200));
    expect(legs.operation.calls).toEqual(
      param === null
        ? []
        : [
            {
              endpoint: MUSICU_URL,
              format: 'json',
              singermid: param.singermid,
              payload: {
                comm: { ct: 24, cv: 0 },
                singer: {
                  module: 'music.web_singer_info_svr',
                  method: 'get_singer_detail_info',
                  param: {
                    sort: 5,
                    singermid: param.singermid,
                    sin:
                      param.begin === null || param.num === null
                        ? null
                        : (param.begin - 1) * param.num + 0,
                    num: param.num,
                  },
                },
              },
            },
          ],
    );
    if (param === null)
      expect(legs.operation.body).toEqual(
        runtime === 'node' ? { response: 'no singermid' } : { data: { message: 'no singermid' } },
      );
    expect(legs.host).toEqual(legs.operation);
  });
});

describe('/getSingerHotsong Node 的可选路径不代替查询', () => {
  const upstream = useCatalogUpstream('node');
  it('只带路径仍回 400', async () => {
    const legs = await parity('node', '/getSingerHotsong/fixture-singer/20/3', upstream.calls);
    expect(legs.operation).toEqual({ status: 400, body: { response: 'no singermid' }, calls: [] });
    expect(legs.host).toEqual(legs.operation);
  });
});
