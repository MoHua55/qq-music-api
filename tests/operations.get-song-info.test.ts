import { getSongInfo } from '../src/routes/operations/getSongInfo';
import {
  CATALOG_RUNTIMES,
  type CatalogRuntimeName,
  MUSICU_URL,
  useCatalogUpstream,
} from './helpers/catalogRoutes';
import { createParityRunner } from './helpers/operationParity';

// 单曲详情的路径、查询参数与业务拒绝照旧保留，三条腿同时比回包和上游请求。
const parity = createParityRunner(
  {
    name: 'getSongInfo',
    node: '/getSongInfo/:songmid?/:songid?',
    serverless: '/getSongInfo/:songmid/:songid?',
  },
  {
    operation: getSongInfo,
  },
);

const songinfo = {
  code: 0,
  songinfo: { code: 0, data: { track_info: { mid: 'fixture-song', action: { msgid: 23 } } } },
};
type PerRuntime<T> = Record<CatalogRuntimeName, T>;
const both = <T>(value: T): PerRuntime<T> => ({ node: value, serverless: value });
interface ParityCase {
  label: string;
  path: string;
  param: PerRuntime<Record<string, unknown>>;
  status?: number;
  body?: unknown;
  failure?: boolean;
}
const cases: ParityCase[] = [
  {
    label: '路径参数成功',
    path: '/getSongInfo/fixture-song/42',
    param: both({ song_mid: 'fixture-song', song_id: '42' }),
  },
  {
    label: '没有 songid 时送空字符串',
    path: '/getSongInfo/fixture-song',
    param: both({ song_mid: 'fixture-song', song_id: '' }),
  },
  {
    label: '路径优先于查询',
    path: '/getSongInfo/fixture-song/42?songmid=fixture-other&songid=7',
    param: both({ song_mid: 'fixture-song', song_id: '42' }),
  },
  {
    label: 'songid 从查询补齐',
    path: '/getSongInfo/fixture-song?songid=7',
    param: both({ song_mid: 'fixture-song', song_id: '7' }),
  },
  {
    label: '空 songid 照旧传递',
    path: '/getSongInfo/fixture-song?songid=',
    param: both({ song_mid: 'fixture-song', song_id: '' }),
  },
  {
    label: '无关参数不改变请求',
    path: '/getSongInfo/fixture-song?limit=0&id=7',
    param: both({ song_mid: 'fixture-song', song_id: '' }),
  },
  {
    label: '重复 songid 保留各自取法',
    path: '/getSongInfo/fixture-song?songid=7&songid=8',
    param: {
      node: { song_mid: 'fixture-song', song_id: ['7', '8'] },
      serverless: { song_mid: 'fixture-song', song_id: '7' },
    },
  },
  {
    label: '重复 songid 第一项为空',
    path: '/getSongInfo/fixture-song?songid=&songid=8',
    param: {
      node: { song_mid: 'fixture-song', song_id: ['', '8'] },
      serverless: { song_mid: 'fixture-song', song_id: '' },
    },
  },
  {
    label: '重复 songmid 不覆盖路径',
    path: '/getSongInfo/fixture-song?songmid=&songmid=fixture-other',
    param: both({ song_mid: 'fixture-song', song_id: '' }),
  },
  {
    label: '路径 songid 不被重复查询覆盖',
    path: '/getSongInfo/fixture-song/42?songid=&songid=8',
    param: both({ song_mid: 'fixture-song', song_id: '42' }),
  },
  {
    label: '业务拒绝仍在 200 内容里',
    path: '/getSongInfo/fixture-song',
    param: both({ song_mid: 'fixture-song', song_id: '' }),
    body: { code: 0, songinfo: { code: 104003, data: {} } },
  },
  {
    label: '空数据照旧转交',
    path: '/getSongInfo/fixture-song',
    param: both({ song_mid: 'fixture-song', song_id: '' }),
    body: { code: 0, songinfo: { code: 0, data: {} } },
  },
  {
    label: '上游连不上时安全 500',
    path: '/getSongInfo/fixture-song',
    param: both({ song_mid: 'fixture-song', song_id: '' }),
    status: 500,
    failure: true,
  },
];

const assertCase = async (
  runtime: CatalogRuntimeName,
  upstream: ReturnType<typeof useCatalogUpstream>,
  fixture: ParityCase,
) => {
  if (fixture.failure)
    upstream.fail(Object.assign(new Error('fixture-private-message'), { code: 'ECONNRESET' }));
  else upstream.respond(fixture.body ?? songinfo);
  const legs = await parity(runtime, fixture.path, upstream.calls);
  expect(legs.operation.status).toBe(fixture.status ?? 200);
  expect(legs.operation.calls).toEqual([
    {
      endpoint: MUSICU_URL,
      format: 'json',
      payload: {
        comm: { ct: 24, cv: 0 },
        songinfo: {
          module: 'music.pf_song_detail_svr',
          method: 'get_song_detail_yqq',
          param: { song_type: 0, ...fixture.param[runtime] },
        },
      },
    },
  ]);
  expect(legs.host).toEqual(legs.operation);
};

describe.each(CATALOG_RUNTIMES)('/getSongInfo 共用处理与真实宿主契约（%s）', (runtime) => {
  const upstream = useCatalogUpstream(runtime);
  it.each(cases)('$label', (fixture) => assertCase(runtime, upstream, fixture));
});

// serverless 没有无 songmid 的路径，既有 getSongInfo 测试固定它的 501；这里单独比 Node 的查询形式。
describe('/getSongInfo Node 的可选路径', () => {
  const upstream = useCatalogUpstream('node');
  it.each([
    { label: '没带参数也请求上游', path: '/getSongInfo', param: both({ song_id: '' }) },
    { label: '只带无关参数', path: '/getSongInfo?id=7', param: both({ song_id: '' }) },
    {
      label: '查询提供 songmid 和 songid',
      path: '/getSongInfo?songmid=fixture-song&songid=42',
      param: both({ song_mid: 'fixture-song', song_id: '42' }),
    },
    {
      label: '空 songmid 照旧请求上游',
      path: '/getSongInfo?songmid=',
      param: both({ song_mid: '', song_id: '' }),
    },
    {
      label: '重复 songmid 原样交给上游',
      path: '/getSongInfo?songmid=fixture-a&songmid=fixture-b',
      param: both({ song_mid: ['fixture-a', 'fixture-b'], song_id: '' }),
    },
    {
      label: '重复 songmid 第一项为空',
      path: '/getSongInfo?songmid=&songmid=fixture-b',
      param: both({ song_mid: ['', 'fixture-b'], song_id: '' }),
    },
  ])('$label', (fixture) => assertCase('node', upstream, fixture));
});
