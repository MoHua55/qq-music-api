import { routeManifest, serverlessPathOf, sharedRoutes } from '../src/routes/manifest';

// 路由清单是 Koa、Serverless、Explorer 三张表的来源，重复的一行会被后面的悄悄盖掉，所以这里先挡住。

const duplicates = (values: string[]): string[] =>
  values.filter((value, index) => values.indexOf(value) !== index);

describe('路由清单', () => {
  it('名字不重复', () => {
    expect(duplicates(routeManifest.map((route) => route.name))).toEqual([]);
  });

  it('Koa 的方法加路径不重复', () => {
    expect(duplicates(routeManifest.map((route) => `${route.method} ${route.path}`))).toEqual([]);
  });

  it('Serverless 的路径不重复', () => {
    expect(duplicates(sharedRoutes.map(serverlessPathOf))).toEqual([]);
  });

  it('只给 Node 的旧路由不进 Serverless', () => {
    const shared = new Set(sharedRoutes.map((route) => route.name));
    const nodeOnly = routeManifest.filter((route) => 'nodeOnly' in route);
    expect(nodeOnly).toHaveLength(17);
    for (const route of nodeOnly) expect(shared.has(route.name)).toBe(false);
  });
});
