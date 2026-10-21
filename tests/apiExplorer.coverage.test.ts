import { apiExplorerMetadata } from '../src/config/apiExplorer';
import router from '../src/node/router';

const getRouteEntries = (): Array<{ method: string; path: string }> =>
  (router.stack as Array<{ methods: string[]; path: string }>).flatMap((layer) =>
    layer.methods
      .filter((method) => method === 'GET' || method === 'POST')
      .map((method) => ({
        method,
        path: layer.path,
      })),
  );

describe('apiExplorer metadata coverage', () => {
  it('应覆盖 router 中全部已挂载路由', () => {
    const routeEntries = getRouteEntries();
    const metadataEntries = apiExplorerMetadata.endpoints.map(({ method, routePath }) => ({
      method,
      path: routePath,
    }));

    expect(metadataEntries).toHaveLength(routeEntries.length);

    for (const routeEntry of routeEntries) {
      expect(metadataEntries).toContainEqual(routeEntry);
    }
  });

  it('应为每条元数据提供最小可用字段', () => {
    for (const endpoint of apiExplorerMetadata.endpoints) {
      expect(endpoint).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          name: expect.any(String),
          category: expect.any(String),
          description: expect.any(String),
          method: expect.any(String),
          routePath: expect.any(String),
          path: expect.any(String),
        }),
      );
    }
  });

  it('应为含路径参数的路由生成可调试参数输入项', () => {
    const endpoint = apiExplorerMetadata.endpoints.find(({ name }) => name === 'getSingerAlbum');

    expect(endpoint).toBeDefined();
    expect(endpoint?.queryParams).toEqual([
      expect.objectContaining({
        key: 'singermid',
        required: false,
      }),
      expect.objectContaining({
        key: 'limit',
        required: false,
      }),
      expect.objectContaining({
        key: 'page',
        required: false,
      }),
    ]);
  });
});
