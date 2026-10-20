# 参与贡献

欢迎修复 bug、改进文档或提出功能建议。开始前先看[使用文档](./docs/README.md)和[相容与版本政策](./docs/compatibility.md)，确认改动会影响哪些调用方。范围较大的功能或重构，请先在本仓库讨论需求和方案。

## 准备开发环境

需要 Node.js 20 或更新版本、npm 和 Git。在自己的仓库副本中创建工作分支：

```sh
git clone <你的仓库地址>
cd qq-music-api
npm ci
git switch -c fix/your-change
npm start
```

默认服务端口是 `3200`，API Explorer 位于 `http://localhost:3200/explorer`。需要自动重载时可用 `npm run dev`；Windows 建议使用 PowerShell 跑验证，启用开发脚本时需使用支持该脚本环境变量写法的 shell。

## 代码在哪里

```text
src/
├── app.ts           # Node / Koa 启动入口
├── config/          # 配置与 API Explorer 元数据
├── controllers/     # Node HTTP 转接
├── middlewares/     # Koa 中间件
├── node/            # 只有 Node 用的：Koa 路由表、axios 版旧曲库传输、启动用的小工具
├── routes/          # 路由与共用 operation handler
├── services/        # 登录、音乐库和其他业务逻辑
├── protocol/        # 上游协议、错误分类，以及 HTTP 传输接口、超时和限流
├── transport/       # fetch 传输与登录用的 Cookie jar
├── serverless/      # Web Request / Response 入口
└── util/            # 两边共用的工具：日志、错误摘要等
tests/               # Jest 离线测试与契约测试
types/               # 根模块的公开类型
public/              # 内置首页和 API Explorer
docs/                # 使用文档、错误说明和相容政策
scripts/             # 构建及维护脚本
```

Node 与 Serverless 共用业务处理。改动共用代码时，检查两个宿主的参数处理和响应，不要默认 Koa 中间件在 Serverless 也会生效。

请求流程、路由清单和打包边界见[架构说明](./ARCHITECTURE.md)。

## 怎么加一条路由

新路由使用共用 operation handler，Node 和 Serverless 各自完成 HTTP 转接。通常按下面的顺序改：

1. **写 handler 和业务处理。** 在 `src/routes/operations/` 导出 `OperationHandler`，需要访问上游的逻辑放在 `src/services/` 对应领域中。handler 接收 `OperationRequest`，返回 `{ status, headers, body }`，不直接操作 Koa `ctx` 或 Web `Request`。带登录的例子可以看 `userVip.ts`、`userDailySongs.ts`；匿名与可选登录可以看 `recommendations.ts`。新参数用 `query()` 取值；迁移旧路由时，先确认是否需要 `queryRaw()` 保留重复参数的原有行为。
2. **在 manifest 加一条记录。** 在 `src/routes/manifest.ts` 引入 handler，填写 `name`、`method`、`path`、`category` 和 `handler`。要登录的路由加 `needsSecret: true`；Node 与 Serverless 路径格式不同时加 `serverlessPath`，不要顺手统一旧路由的格式。例如，现有会员接口的记录是：

   ```ts
   {
     name: 'userVip',
     method: 'GET',
     path: '/user/vip',
     category: 'User',
     handler: userVip,
     needsSecret: true,
   }
   ```

   `needsSecret` 只让缺少 `QQ_SESSION_SECRET` 的 Serverless 部署提前回 `501`，不会替 handler 验证登录。handler 仍要通过 `request.service()` 解析会话，并处理缺会话与凭证被拒的情况。可选登录的公开接口通常不加这个标记，参考 `optionalSession()` 的用法。两边路径不同的现例是 `/getAlbumInfo`：`path` 为 `/getAlbumInfo/:albummid?`，`serverlessPath` 为 `/getAlbumInfo`。
3. **补 Explorer overrides。** 路由列表自动跟随 manifest，不再手工添加第二份列表。在 `src/config/apiExplorer.ts` 的 `apiExplorerOverrides` 中，以 manifest 的 `name` 为键补上说明、`queryParams`、必要的路径参数说明和 JSON 正文示例。说明必填项、默认值、分页方式及宿主限制。若功能有对应的能力声明，同步 `src/services/runtimeCapabilities.ts`；布尔值只表示后端已实现，不代表上游一定接受请求。
4. **两边跑同一份测试。** 使用 `tests/helpers/catalogRoutes.ts` 的 `CATALOG_RUNTIMES`、`callRoute` 组织案例；需要登录时配合 `tests/helpers/sessionRoutes.ts`。可参考 `tests/daily-songs.routes.test.ts`，迁移旧路由则参考 `tests/operations.get-album-info.test.ts` 与 `tests/helpers/operationParity.ts`。覆盖成功、缺参数、空参数、重复参数、业务拒绝、格式异常和网络失败；分页加边界值，带登录的加缺会话、凭证失效和 Serverless 缺密钥。检查响应正文、状态、必要的响应头及上游调用，已有宿主差异分别断言。
5. **同步公开文档。** 在 `docs/README.md` 写调用方式与响应，在 `CHANGELOG.md` 写用户能观察到的变化。改变错误或稳定接口时，也更新下方清单中的错误说明和相容政策。
6. **跑验证。** 使用后面的完整验证命令，其中 `compat:check` 必须在 `build:js` 之后运行，它比较的是编译产物。

普通共用路由会自动进入 Koa、Serverless 和 Explorer，不需要在各入口再注册一次。需要操作 Koa Cookie 等宿主 API 时，参考 `src/controllers/index.ts` 的 `nodeAdapters`。

写入路由还要在 handler 检查 POST 方法、验证 JSON 正文，并在上游请求中设置 `readOnly: false`。写入只发送一次，读回确认后才报告成功；结果不明时不能自动重送。handler 及其依赖会进入 Serverless 打包范围，不要引入 Koa、axios、`node:*` 或 `qrLogin.node`，详细规则见[Serverless 打包边界](./ARCHITECTURE.md#serverless-打包边界)。

## 提交改动

1. 从本项目当前 `main` 创建分支，每个分支集中解决一个问题。
2. 用最小改动实现目标。修 bug 时补能复现问题的测试；功能变更同时更新文档。
3. 跑完下方验证，检查 diff 中没有凭证、真实账号资料或无关文件。
4. 使用 Conventional Commits 提交，例如 `docs: 更新部署说明`、`fix: 修复分页重复`。中文使用简体，说明直接写问题和结果，不添加 `Co-Authored-By`。
5. 推送到你有写权限的仓库。命令中的 remote 必须明确指向自己的仓库，例如：

   ```sh
   git push -u <你的远程名称> fix/your-change
   ```

6. 向 `yakult-green-tea/qq-music-api` 的 `main` 提交 Pull Request，说明问题、改动、兼容影响和验证结果。

请保持讨论友善，围绕具体问题提出意见。涉及第三方项目的讨论，未经相关授权不要在提交信息、PR 或其他公开内容中粘贴可能触发交叉引用的 issue / PR 编号或链接。

## 改了对外行为要同步什么

- `docs/README.md`：参数、响应、宿主限制和迁移方式。
- `CHANGELOG.md`：用户会观察到的变化与升级影响。
- `src/config/apiExplorer.ts`：接口表单和说明。
- `docs/errors.md`：状态码、错误字段、错误键和处理建议。

涉及版本或稳定接口的变动，还要核对 `docs/compatibility.md`，并补 Node 与 Serverless 的契约测试。公开文件使用简体中文；已有英文文件保持英文。示例只用虚构数据，不把内部工作代号写入公开内容。

## 测试与验证

项目使用 **Jest**。默认测试会拦截外网连接，只允许本机测试连接；新增测试应模拟上游响应，并检查字段和状态语义，不能只断言状态码落在某个集合里。

在仓库根目录运行：

```powershell
npm ci
npm run lint
npm run check:deps
npm run build
npm test -- --runInBand
npm run test:contracts
npm run build:js
npm run compat:check -- --baseline 3.3.3
npm pack --dry-run
```

`npm run check:deps` 检查分层的依赖方向，以及两边共用的代码有没有引入 npm 包或 `node:*`，规则写在 `.dependency-cruiser.cjs`。`npm run build` 只检查 TypeScript 类型，`npm run build:js` 才生成运行产物。`npm pack` 不会重新编译，所以检查包内容前必须先构建。全套 Jest 在 Windows 上使用 PowerShell，避免 Git Bash 的 tar 行为影响产物测试。

`compat:check` 用同一份离线样本比较已发布版本与当前 `dist`，检查状态、关键响应头、正文和上游请求。上面的 `3.3.3` 是明确指定的基准；维护后续版本时按需要调整。第一次使用该版本会从 npm 下载基准包，案例执行不访问真实 QQ 服务。工具不会测试扫码状态流程，也不能代替路由的专门测试或真账号验收，细节见[行为比对工具](./ARCHITECTURE.md#行为比对工具)。

旧路由测试已改成模拟上游并纳入默认测试，不再按“旧路由”统一排除。测试集合的约定由 `tests/testSuite.layout.test.ts` 检查；新增或移动测试时要核对这份约定。需要连接真实 QQ 服务或使用真实账号的验证应与默认测试分开，明确说明操作范围并取得授权。离线测试通过不能替代真账号或各宿主的实际验收。

`pre-commit` 对暂存的 TypeScript 文件运行 `lint-staged` 和 Biome，可能自动调整格式或 import；`commit-msg` 检查提交规范。hooks 不能替代完整验证，请在提交后再检查一次 diff。PR 中列出实际运行的检查，未完成的项目说明原因；合并前必须通过所需 CI 检查。

## 安全与发布边界

公开 Issue、PR、fixture、日志和截图不能包含真实 Cookie、QR key、会话 token、`musickey`、账号或设备标识、auth-state 文件、`.env` 内容、完整播放链接或含凭证的 HAR。安全漏洞和凭证暴露请按 [SECURITY.md](./SECURITY.md) 私密报告。

普通 PR 不修改包版本、不创建或移动 release tag，也不发布 npm。发布由维护者按 [RELEASING.md](./RELEASING.md) 执行。
