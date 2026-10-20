import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import app from '../src/app';
import { apiExplorerBaseRoutes } from '../src/config/apiExplorer';
import { handleRequest } from '../src/serverless';

// 这 17 条只在 Node 上有的旧路由在 3.3.4 预告过要在 3.3.5 移除，下游没有引用。
// 有替代的 9 条按 replacedBy 迁移，其余 8 条直接移除。
const ROOT = path.join(__dirname, '..');
const server = app.callback();

type Retired = {
  route: string;
  sample: string;
  method?: 'get' | 'post';
  replacedBy: string[];
};

const RETIRED: Retired[] = [
  {
    route: '/getSmartbox',
    sample: '/getSmartbox/demo-key',
    replacedBy: ['/search/match', '/search/suggest'],
  },
  {
    route: '/getSongListCategories',
    sample: '/getSongListCategories',
    replacedBy: ['/recommend/categories/all'],
  },
  {
    route: '/getSongLists',
    sample: '/getSongLists/1/20/10000000/5',
    replacedBy: ['/recommend/category-playlists/sorted'],
  },
  {
    route: '/batchGetSongInfo',
    sample: '/batchGetSongInfo',
    method: 'post',
    replacedBy: ['/song/batch'],
  },
  { route: '/getRadioLists', sample: '/getRadioLists', replacedBy: ['/radio/categories'] },
  { route: '/getComments', sample: '/getComments/demo-id', replacedBy: ['/comment/list'] },
  { route: '/getNewDisks', sample: '/getNewDisks/1/20', replacedBy: ['/recommend/new-albums'] },
  { route: '/getTopLists', sample: '/getTopLists', replacedBy: ['/recommend/toplists'] },
  { route: '/getRanks', sample: '/getRanks/4/20/1', replacedBy: ['/recommend/toplist'] },
  { route: '/user/getCookie', sample: '/user/getCookie', replacedBy: [] },
  { route: '/user/setCookie', sample: '/user/setCookie', replacedBy: [] },
  { route: '/downloadQQMusic', sample: '/downloadQQMusic', replacedBy: [] },
  { route: '/getImageUrl', sample: '/getImageUrl', replacedBy: [] },
  { route: '/getRecommend', sample: '/getRecommend', replacedBy: [] },
  { route: '/getTicketInfo', sample: '/getTicketInfo', replacedBy: [] },
  { route: '/getDigitalAlbumLists', sample: '/getDigitalAlbumLists', replacedBy: [] },
  { route: '/batchGetSongLists', sample: '/batchGetSongLists', method: 'post', replacedBy: [] },
];

const REMOVED_FILES = [
  'src/controllers/batchGetSongInfo.ts',
  'src/controllers/batchGetSongLists.ts',
  'src/controllers/cookies.ts',
  'src/controllers/getComments.ts',
  'src/controllers/getDigitalAlbumLists.ts',
  'src/controllers/getDownloadQQMusic.ts',
  'src/controllers/getImageUrl.ts',
  'src/controllers/getNewDisks.ts',
  'src/controllers/getRadioLists.ts',
  'src/controllers/getRanks.ts',
  'src/controllers/getRecommend.ts',
  'src/controllers/getSmartbox.ts',
  'src/controllers/getSongListCategories.ts',
  'src/controllers/getSongLists.ts',
  'src/controllers/getTicketInfo.ts',
  'src/controllers/getTopLists.ts',
  'src/services/comments/getComments.ts',
  'src/services/digitalAlbum/getDigitalAlbumLists.ts',
  'src/services/downloadQQMusic.ts',
  'src/services/radio/getRadioLists.ts',
  'src/services/rank/getTopLists.ts',
  'src/services/search/getSmartbox.ts',
  'src/services/songLists/songListCategories.ts',
  'src/services/songLists/songLists.ts',
  // 旧的 services 汇总只给这些 controller 用
  'src/services/index.ts',
];

// Folia 还在用的共用模块不能跟着删
const KEPT_FILES = [
  'src/services/y_common.ts',
  'src/services/u_common.ts',
  'src/services/UCommon/UCommon.ts',
  'src/node/request.ts',
  'src/util/safeError.ts',
];

describe('17 条 Node 旧路由在 3.3.5 移除', () => {
  it.each(RETIRED)('Node 不再提供 $route，回 404', async ({ route, sample, method = 'get' }) => {
    expect((await request(server)[method](route)).status).toBe(404);
    expect((await request(server)[method](sample)).status).toBe(404);
  });

  it.each(RETIRED)('Serverless 照旧不提供 $route', async ({ route, method = 'get' }) => {
    const response = await handleRequest(
      new Request(`https://example.invalid${route}`, { method: method.toUpperCase() }),
      {},
    );
    expect(response.status).toBe(501);
  });

  it('controller 和只给它们用的 service 都删掉了，共用模块还在', () => {
    for (const file of REMOVED_FILES) expect(fs.existsSync(path.join(ROOT, file))).toBe(false);
    for (const file of KEPT_FILES) expect(fs.existsSync(path.join(ROOT, file))).toBe(true);
  });

  it('API Explorer 和首页不再列出它们，接手的新路由都还在', () => {
    const listed = apiExplorerBaseRoutes.map((entry) => entry.routePath.replace(/\/:.*$/, ''));
    const homepage = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
    for (const { route, replacedBy } of RETIRED) {
      expect(listed).not.toContain(route);
      expect(homepage).not.toContain(route);
      for (const replacement of replacedBy) expect(listed).toContain(replacement);
    }
  });
});
