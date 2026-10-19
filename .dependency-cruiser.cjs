// 依赖方向的检查，`npm run check:deps` 运行，CI 也会跑。
//
// 分层从下到上：protocol（上游协议、错误、传输接口）→ transport（fetch 实现）→ services（业务）
// → routes（路由清单和共用 handler）→ 宿主（app.ts、controllers、serverless、node、middlewares）。
// 只能往下依赖。protocol、transport、routes 两边都会打包，不能引入 npm 包和 node:*；
// Serverless 入口能走到的所有文件也一样。只看运行时的 import，`import type` 编译后就没了，不算。

const { builtinModules } = require('node:module');

const HOSTS = '^src/(app\\.ts|controllers/|serverless/|node/|middlewares/)';
// 编译后的 require 不一定带 node: 前缀，所以按 Node 自带模块的名单比对。
const NODE_BUILTINS = `^(node:)?(${builtinModules.map((name) => name.replace(/[/.]/g, '\\$&')).join('|')})$`;
const NPM_OR_NODE = `(^|/)node_modules/|${NODE_BUILTINS}`;

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'protocol-is-bottom',
      comment: 'protocol 是最底层，不能依赖其他层',
      severity: 'error',
      from: { path: '^src/protocol/' },
      to: { path: `^src/(transport|services|routes|config)/|${HOSTS}` },
    },
    {
      name: 'transport-below-services',
      comment: 'transport 只能依赖 protocol',
      severity: 'error',
      from: { path: '^src/transport/' },
      to: { path: `^src/(services|routes|config)/|${HOSTS}` },
    },
    {
      name: 'services-below-routes',
      comment: 'services 不能依赖路由层、宿主和 Node 的配置系统',
      severity: 'error',
      // /downloadQQMusic 是只有 Node 有的旧路由，3.3.5 退役时这个文件一起删掉。
      from: { path: '^src/services/', pathNot: '^src/services/downloadQQMusic\\.ts$' },
      to: { path: `^src/(routes|config)/|${HOSTS}` },
    },
    {
      name: 'routes-below-hosts',
      comment: 'routes 不能依赖宿主',
      severity: 'error',
      from: { path: '^src/routes/' },
      to: { path: HOSTS },
    },
    {
      name: 'shared-layers-runtime-neutral',
      comment: 'protocol、transport、routes 两边都会打包，不能引入 npm 包和 node:*',
      severity: 'error',
      from: { path: '^src/(protocol|transport|routes)/' },
      to: { path: NPM_OR_NODE },
    },
    {
      name: 'routes-no-node-login-service',
      comment: '共用 handler 要通过 request.service() 拿登录服务，不能直接引入 Node 的单例',
      severity: 'error',
      from: { path: '^src/routes/' },
      to: { path: 'qrLogin\\.node' },
    },
    {
      name: 'serverless-closure',
      comment: 'Serverless 入口能走到的文件都不能引入 npm 包、node:* 或 Node 的登录单例',
      severity: 'error',
      from: { path: '^src/serverless/(index|mqtt)\\.ts$' },
      to: {
        path: `${NPM_OR_NODE}|qrLogin\\.node|^src/(app\\.ts|controllers/|node/)`,
        reachable: true,
      },
    },
    {
      name: 'no-circular',
      comment: '文件之间不能循环依赖',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: false,
    tsConfig: { fileName: 'tsconfig.json' },
    exclude: { path: '^(dist|dist-esm|tests|types)/' },
  },
};
