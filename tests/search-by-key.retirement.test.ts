import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import app from '../src/app';
import { apiExplorerBaseRoutes } from '../src/config/apiExplorer';
import services from '../src/services';

// 旧的 /getSearchByKey 在 3.3.1 预告过要移除，搜索统一走 /search。
const ROOT = path.join(__dirname, '..');
const server = app.callback();

describe('旧搜索接口 /getSearchByKey 已移除', () => {
  it('Node 不再提供这条路由，回 404', async () => {
    const response = await request(server).get('/getSearchByKey?key=synthetic');

    expect(response.status).toBe(404);
  });

  it('controller 和 service 文件都删掉了', () => {
    expect(fs.existsSync(path.join(ROOT, 'src/controllers/getSearchByKey.ts'))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, 'src/services/search/getSearchByKey.ts'))).toBe(false);
    expect(Object.keys(services)).not.toContain('getSearchByKey');
  });

  it('API Explorer 和首页示例不再列出它', () => {
    expect(apiExplorerBaseRoutes.map((route) => route.name)).not.toContain('getSearchByKey');
    expect(fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8')).not.toContain(
      '/getSearchByKey',
    );
  });

  it('新的 /search 还在', () => {
    expect(apiExplorerBaseRoutes).toContainEqual(
      expect.objectContaining({ name: 'getSearch', routePath: '/search' }),
    );
  });
});
