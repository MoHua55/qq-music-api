import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import app from '../src/app';
import { apiExplorerBaseRoutes } from '../src/config/apiExplorer';
import { handleRequest } from '../src/serverless';
import services from '../src/services';

// 这 9 条旧路由在 3.3.3 预告过要移除，功能都已经有新路由接手；它们只在 Node 上有，下游没有引用。
const ROOT = path.join(__dirname, '..');
const server = app.callback();

const RETIRED = [
  { route: '/getHotkey', sample: '/getHotkey', replacedBy: ['/search/hot'] },
  {
    route: '/getSingerList',
    sample: '/getSingerList/-100/-100/-100/-100/1',
    replacedBy: ['/singer/list'],
  },
  {
    route: '/getSingerDesc',
    sample: '/getSingerDesc/demo-singer-mid',
    replacedBy: ['/singer/detail'],
  },
  {
    route: '/getSingerStarNum',
    sample: '/getSingerStarNum/demo-singer-mid',
    replacedBy: ['/singer/homepage'],
  },
  {
    route: '/getSimilarSinger',
    sample: '/getSimilarSinger/demo-singer-mid',
    replacedBy: ['/singer/similar'],
  },
  {
    route: '/getSingerMv',
    sample: '/getSingerMv/demo-singer-mid/5/time',
    replacedBy: ['/singer/mvs'],
  },
  { route: '/getMv', sample: '/getMv/15/7/20/0', replacedBy: ['/mv/list'] },
  { route: '/getMvByTag', sample: '/getMvByTag', replacedBy: ['/mv/list'] },
  {
    route: '/getMvPlay',
    sample: '/getMvPlay/demo-video-id',
    replacedBy: ['/mv/detail', '/mv/url'],
  },
];

const REMOVED_FILES = [
  'src/controllers/getHotkey.ts',
  'src/controllers/getSingerList.ts',
  'src/controllers/getSingerDesc.ts',
  'src/controllers/getSingerStarNum.ts',
  'src/controllers/getSimilarSinger.ts',
  'src/controllers/getSingerMv.ts',
  'src/controllers/getMv.ts',
  'src/controllers/getMvByTag.ts',
  'src/controllers/getMvPlay.ts',
  'src/services/search/getHotKey.ts',
  'src/services/singers/getSingerDesc.ts',
  'src/services/singers/getSingerStarNum.ts',
  'src/services/singers/getSimilarSinger.ts',
  'src/services/singers/getSingerMv.ts',
  'src/services/mv/getMvByTag.ts',
];

describe('已被新路由取代的旧路由在 3.3.4 移除', () => {
  it.each(RETIRED)('Node 不再提供 $route，回 404', async ({ route, sample }) => {
    expect((await request(server).get(route)).status).toBe(404);
    expect((await request(server).get(sample)).status).toBe(404);
  });

  it.each(RETIRED)('Serverless 照旧不提供 $route', async ({ route }) => {
    const response = await handleRequest(new Request(`https://example.invalid${route}`), {});
    expect(response.status).toBe(501);
  });

  it('controller 和只给它们用的 service 都删掉了', () => {
    for (const file of REMOVED_FILES) expect(fs.existsSync(path.join(ROOT, file))).toBe(false);
    expect(Object.keys(services)).toEqual(
      expect.not.arrayContaining([
        'getHotKey',
        'getMvByTag',
        'getSimilarSinger',
        'getSingerDesc',
        'getSingerMv',
        'getSingerStarNum',
      ]),
    );
  });

  it('API Explorer 和首页不再列出它们，接手的新路由都还在', () => {
    const listed = apiExplorerBaseRoutes.map((entry) => entry.routePath.replace(/\/:.*$/, ''));
    const homepage = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
    for (const { route, replacedBy } of RETIRED) {
      expect(listed).not.toContain(route);
      expect(homepage).not.toContain(`"${route}"`);
      for (const replacement of replacedBy) expect(listed).toContain(replacement);
    }
  });
});
