import legacyGetAlbumInfo from '../src/controllers/getAlbumInfo';
import { getAlbumInfo } from '../src/routes/operations/getAlbumInfo';
import { legacyRoutes } from '../src/serverless/legacyRoutes';
import {
  CATALOG_RUNTIMES,
  type CatalogRuntimeName,
  useCatalogUpstream,
} from './helpers/catalogRoutes';
import { createParityRunner } from './helpers/operationParity';

// /getAlbumInfo 换成两边共用的 handler 之前和之后，对外行为都要和旧实现一模一样，
// 包括两边原本就不同的地方（重复的 albummid：Node 整个数组交给上游，serverless 只取第一个）。

const parity = createParityRunner(
  { name: 'getAlbumInfo', node: '/getAlbumInfo/:albummid?', serverless: '/getAlbumInfo' },
  {
    legacyNode: legacyGetAlbumInfo,
    legacyServerless: legacyRoutes['/getAlbumInfo'],
    operation: getAlbumInfo,
  },
);

const album = {
  code: 0,
  data: { mid: 'fixture-album', name: 'Fixture album', list: [{ songmid: 'fixture-song-a' }] },
};

type PerRuntime<T> = Record<CatalogRuntimeName, T>;
const both = <T>(value: T): PerRuntime<T> => ({ node: value, serverless: value });

interface ParityCase {
  label: string;
  path: string;
  reply?: { body: unknown } | { error: unknown };
  status: PerRuntime<number>;
  /** 送到上游的 albummid（测试替身把数组记成逗号连接的字符串）；`null` 表示不该打上游。 */
  albummid: PerRuntime<string | null>;
}

const cases: ParityCase[] = [
  {
    label: '成功时原样转交上游内容',
    path: '/getAlbumInfo?albummid=fixture-album',
    reply: { body: album },
    status: both(200),
    albummid: both('fixture-album'),
  },
  {
    label: '上游业务码不是 0 时仍然回 200',
    path: '/getAlbumInfo?albummid=fixture-album',
    reply: { body: { code: -1, data: {} } },
    status: both(200),
    albummid: both('fixture-album'),
  },
  {
    label: '没带 albummid 时回 400、不打上游',
    path: '/getAlbumInfo',
    status: both(400),
    albummid: both(null),
  },
  {
    label: 'albummid 是空的时回 400、不打上游',
    path: '/getAlbumInfo?albummid=',
    status: both(400),
    albummid: both(null),
  },
  {
    label: '只带无关参数时回 400',
    path: '/getAlbumInfo?id=fixture-album&limit=0',
    status: both(400),
    albummid: both(null),
  },
  {
    label: '重复的 albummid 保留两边原来的取法',
    path: '/getAlbumInfo?albummid=fixture-a&albummid=fixture-b',
    reply: { body: album },
    status: both(200),
    albummid: { node: 'fixture-a,fixture-b', serverless: 'fixture-a' },
  },
  {
    label: '第一个 albummid 是空的时，Node 照样打上游、serverless 回 400',
    path: '/getAlbumInfo?albummid=&albummid=fixture-b',
    reply: { body: album },
    status: { node: 200, serverless: 400 },
    albummid: { node: ',fixture-b', serverless: null },
  },
  {
    label: '上游连不上时回旧路由的安全 500',
    path: '/getAlbumInfo?albummid=fixture-album',
    reply: { error: Object.assign(new Error('fixture-private-message'), { code: 'ECONNRESET' }) },
    status: both(500),
    albummid: both('fixture-album'),
  },
];

describe.each(CATALOG_RUNTIMES)('/getAlbumInfo 新旧实现比对（%s）', (runtime) => {
  const upstream = useCatalogUpstream(runtime);

  it.each(cases)('$label', async (fixture) => {
    if (fixture.reply && 'body' in fixture.reply) upstream.respond(fixture.reply.body);
    if (fixture.reply && 'error' in fixture.reply) upstream.fail(fixture.reply.error);

    const legs = await parity(runtime, fixture.path, upstream.calls);

    expect(legs.legacy.status).toBe(fixture.status[runtime]);
    const albummid = fixture.albummid[runtime];
    expect(legs.legacy.calls.map((call) => call.params?.albummid)).toEqual(
      albummid === null ? [] : [albummid],
    );
    expect(legs.operation).toEqual(legs.legacy);
    expect(legs.host).toEqual(legs.legacy);
  });
});
