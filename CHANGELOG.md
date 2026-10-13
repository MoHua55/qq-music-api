## 未发布

### 新功能

- Node 增加 `/login/channels`，可在登录前查询支持的登录通道、会话模式与后端功能。Node 和 serverless 的响应都新增 `data.features`，按接口分组，用布尔值说明已经实现的方法；写入等尚未实现的方法保持 `false`。原有通道、会话模式和 `configured` 的含义不变。
- `/user/playlist` 的收藏歌单超过 1000 张时可以接着读：响应带 `nextFavoriteOffset`，把它当成 `favoriteOffset` 再请求一次，那一轮只返回收藏歌单。不带参数时请求和响应都和以前一样。
- 新增 `/user/guess-you-like`（猜你喜欢，要登录，每次拿几首歌）和 `/recommend/playlists`（推荐歌单，有登录就带凭证，没有就匿名读），Node 和 serverless 都能用。出错时用状态码加固定的 `errorKey` 说明原因：没登录或凭证被拒是 `401`、上游没给数据是 `422`、限流是 `429`、上游失败或格式不对是 `502`。设 `LOG_LEVEL=debug` 时，`401`、`422` 的原因也会写进开发日志。`/login/channels` 里的 `getPersonalFm`、`getRecommendedCollections` 改成 `true`。
- `/getSongListDetail` 带凭证重读官方歌单时，`cdlist[0]` 多了 `listennum`（播放数）、`uin` 和 `encrypt_uin`（建立者），字段名沿用上游。

### 改进

- 登录态读取中，上游网关码和凭证拒绝码同时出现时，改回 `502`，不再误回 `401` 清掉会话；`error` 仍保留原有的安全协议说明。只有网关失败、没有凭证拒绝码时仍沿用原来的 `500`，真正的凭证拒绝仍是 `401`。Folia 会把这个 `502` 当作网络错误，播放时可能触发音源冷却。

- 旧接口出错返回 `500` 时，不再把原始异常原样带回去。以前响应里可能夹着上游请求地址、请求头、调用栈这类内部信息；现在 `error` 只留固定的说明文字，再加上可以公开的错误码（例如 `ECONNRESET`）和上游 HTTP 状态码。状态码和 `error` 字段都没变。日志也只记录同样的摘要，账号和设备相关的参数值会被遮掉。
- `/user/playlist` 的收藏歌单没读完时（读到 1000 条上限、上游给了空页或反复给同一页），`more` 改为 `true`，`total` 改为真实总数，不再把截断的列表说成完整的。上限本身不变；上游不理分页时会提早停下，少发几次请求。
- `/user/playlist` 的 `uid` 只能是登录账号本身：传别人的 uid 改为返回 `400`，不再把对方的自建歌单和自己的收藏混在一起返回。不传 `uid` 的调用（包括 Folia）不受影响。
- `/getSongListDetail` 带凭证重读官方歌单时，上游反复给同一页不再把重复的歌接上去；`cdlist[0]` 多了 `hasmore`（`1` 表示没读完）。
- 登录态取播放链接时，某首歌拿不到链接会在开发日志里记一条 `playback.url-unavailable`（要设 `LOG_LEVEL=debug` 才看得到），带上那首歌的位置、songmid、音质和上游给的几个数字码，方便排查为什么播不了。不记凭证、链接和账号 id；`/getMusicPlay` 的响应不变。

### 内部改进

- 为后续接口增加共用请求核心，支持批次请求、限流、只读重试和整体超时。现有接口仍使用原来的请求流程。新增离线测试同时验证 Node 原生 fetch 和 Web Response 的行为。
- 开发日志更好排查：程序自己的固定错误说明会作为 `reason` 记进日志，对外响应仍是一般化的文字；分页没读完就停下时会记一条 `qq-auth.paging-stopped`，说明原因和读到的数量，不记账号或歌单 id。

### 仓库维护

- 默认测试里不再有只看状态码的旧路由测试。Folia 会调用的歌曲信息、歌手专辑、歌手热门歌曲改成模拟上游的严格测试，Node 和 Serverless 各跑一遍；其余旧路由测试移到 `tests/legacy-routes/`，用 `npm run test:legacy-routes`（不连外网）或 `npm run probe:legacy-routes`（连真实接口）单独跑。专辑信息也补上了同样的成功案例。

## [3.1.5](https://github.com/yakult-green-tea/qq-music-api/compare/v3.1.4...v3.1.5) (2026-10-11)

### 改进

- `/user/playlist` 里官方歌单（每日30首与算法歌单）的封面少打上游请求：条目自带的 `albumPicUrl` 是专辑图时直接用它拼出封面，不再为每张歌单多读一首歌；缺失或不是专辑图时才像以前一样读第一首歌，一次最多 20 张。封面地址和字段与 3.1.4 完全相同。

### 文档

- README、接口文档和 API Explorer 里把 `qq` 通道写成了“QQ 音乐 App 扫码”，实际是用手机 QQ 扫码，现已更正。通道 id（`qq`、`wechat`）和接口行为都没有变。

## [3.1.4](https://github.com/yakult-green-tea/qq-music-api/compare/v3.1.3...v3.1.4) (2026-10-09)

### 问题修复

- `/getSongListDetail` 读不到 QQ 音乐按账号生成的官方歌单（百万收藏、新歌推荐、歌手漫游等），匿名接口只返回 `code: 10`。请求带着登录会话时改用登录凭证重新读取，响应结构不变；其他歌单不受影响，重新读取失败时保持原响应，不返回 `401`。Node 与 Serverless 入口行为一致。
- `/user/playlist` 中的官方歌单（每日30首与算法歌单）改用第一首歌的专辑图作为封面；收藏的他人歌单补上歌单原本的封面。两者都写入与自建歌单相同的 `bigpicUrl`／`picUrl` 字段。

## [3.1.3](https://github.com/yakult-green-tea/qq-music-api/compare/v3.1.2...v3.1.3) (2026-10-05)

### 改进

- 扫码失败响应增加阶段、原因和上游 HTTP 状态；本地退避 `429` 保留前一次失败摘要。不返回异常原文或登录凭证。

### 问题修复

- 修复取消或替换旧二维码后误触发登录退避的问题，避免重试时返回 `429`；过期清理只计一次退避。

## [3.1.2](https://github.com/yakult-green-tea/qq-music-api/compare/v3.1.1...v3.1.2) (2026-09-12)

### 新功能

- 新增 `/user/playlist-detail`，用登录凭证分页读取用户自己的歌单（`tid`／`dirid`／`offset`／`limit`），响应形状与 `/user/liked-songs` 相同。设为「不公开」的自建歌单在匿名的 `/getSongListDetail` 上只会返回空列表，现在可以经由这条路由读到；收藏的他人歌单仍应走 `/getSongListDetail`。`/user/liked-songs` 改为走同一实现，行为不变。

## [3.1.1](https://github.com/yakult-green-tea/qq-music-api/compare/v3.1.0...v3.1.1) (2026-09-10)

### 问题修复

- 当 Android `UrlGetVkey` 未返回 CDN 地址时，优先探测可用的高速节点，并在失败时动态调度其他节点，改善高码率音频播放卡顿。

## [3.1.0](https://github.com/yakult-green-tea/qq-music-api/compare/v3.0.0...v3.1.0) (2026-08-25)

### 新功能

- 新增 `@yakult-green-tea/qq-music-api/mqtt` 子路径导出，让能够维持 WebSocket 长连接的宿主复用同一套 MQTT 编解码和 QR 事件解析逻辑。
- 为 Serverless 入口增加可注入的 QQ QR 中继；注入中继时 `/login/channels` 同时公布 QQ 与微信通道，未注入时保持仅微信通道。

### 问题修复

- MQTT WebSocket 握手失败或提前关闭时立即结束等待，避免登录请求一直挂起。
- 明确要求宿主等待 WebSocket `open` 事件后再发送 CONNECT，并正确转发 `Uint8Array` 的有效字节范围。

### 文档

- 补充 Node.js、Vercel Functions 与 Cloudflare Durable Object 的导出入口、能力边界和安全责任说明。

## [3.0.0](https://github.com/yakult-green-tea/qq-music-api/compare/v2.3.0...v3.0.0) (2026-08-18)

### 新功能

- 新增零 Koa、零 `node:*` 依赖闭包的 `./serverless` 导出和 Web 标准 `handleRequest` 入口。
- 使用密封 QR 与登录会话，使 Vercel Functions 和 Cloudflare Workers 的无状态请求能够延续扫码登录。
- 增加 Fetch 版认证与旧接口传输层，并提供登录、用户歌单、收藏专辑、我喜欢和登录态播放等必要路由。

### 问题修复

- 从密封 QR 中移除二维码图片，改为根据标识重新获取，避免令牌过大。
- 移除 Serverless 依赖闭包中的 Node.js 加密模块，解除 Edge 运行时部署阻断。

### 仓库维护

- 记录受保护分支、验证、安全报告与发布流程。
- 明确 Folia 只会在单独更新 npm 依赖与锁文件后使用新版本。
- 在包元数据和文档中保留下游贡献者署名。

## [2.3.0](https://github.com/yakult-green-tea/qq-music-api/compare/v2.2.2...v2.3.0) (2026-08-09)

### Features

- Add an injectable authentication-session repository for trusted npm hosts while retaining the in-memory default.

## [2.2.2](https://github.com/yakult-green-tea/qq-music-api/compare/v2.2.1...v2.2.2) (2026-08-09)

### Bug fixes

- Isolate the legacy QQ request client from shared `axios.defaults` so importing the package does not modify its host process.

## [2.2.1](https://github.com/yakult-green-tea/qq-music-api/compare/v2.2.0...v2.2.1) (2026-08-09)

### Bug fixes

- Publish only account identifiers that are actually available from the login credential.

## [2.2.0](https://github.com/yakult-green-tea/qq-music-api/compare/v2.1.0...v2.2.0) (2026-08-08)

### Features

- Add `GET /user/albums` for authenticated favorite-album pagination.
- Derive the account identifier required by authenticated user collections.

## [2.1.0](https://github.com/yakult-green-tea/qq-music-api/compare/v1.0.4...v2.1.0) (2026-08-07)

### Features

- Migrate the maintained fork to TypeScript and add the local API Explorer.
- Add native QQ Music App and WeChat QR login, authenticated playback, and cancellable QR sessions.
- Add runnable JavaScript package output and export the HTTP server handle for npm embedders.

### Bug fixes

- Isolate authentication requests from global Axios defaults and persist a non-secret device context.
- Correct runtime dependencies and disable the development version check for embedded consumers.

## [1.0.4](https://github.com/Rain120/qq-music-api/compare/v1.0.3...v1.0.4) (2021-01-25)


### Bug Fixes

* doc screenshot png path ([fe811e2](https://github.com/Rain120/qq-music-api/commit/fe811e26c0c0a2ed468728b0323866bd27b5a404))
* music play url quality; docs about cookie, music play; ([#35](https://github.com/Rain120/qq-music-api/issues/35)) ([f0b7923](https://github.com/Rain120/qq-music-api/commit/f0b7923b9feb7e32c44bc9417c2d426148ab3865))



## [1.0.3](https://github.com/Rain120/qq-music-api/compare/v1.0.1...v1.0.3) (2021-01-24)


### Bug Fixes

* doc screenshot png path ([cb8b253](https://github.com/Rain120/qq-music-api/commit/cb8b25358219ca1cc3e973e6f46a3f75bb3b8b29))


### Features

* user cookie ([#32](https://github.com/Rain120/qq-music-api/issues/32)) ([5a32dae](https://github.com/Rain120/qq-music-api/commit/5a32daeca351c7b18352f9267db0c173fef9bff6))



## [1.0.1](https://github.com/Rain120/qq-music-api/compare/v1.0.0...v1.0.1) (2020-12-25)


### Bug Fixes

* build docker image sh ([fe395a4](https://github.com/Rain120/qq-music-api/commit/fe395a435efc0678d3d387abbcd6b33786bb72fa))


### Features

* docker build images to hub for docker env run ([dcbbf95](https://github.com/Rain120/qq-music-api/commit/dcbbf95e70b305cd2ad4d00a7cc0bd4db5d0f8ab))
* docker repository version ([d74a425](https://github.com/Rain120/qq-music-api/commit/d74a4251da8c0c2dac2f5e4251e91f288f732d43))



# [1.0.0](https://github.com/Rain120/qq-music-api/compare/4d79041a5e5712c0c6bc6e6d55045f732636c80f...v1.0.0) (2020-09-15)


### Bug Fixes

* bug about search by key https://github.com/Rain120/qq-music-api/issues/28 ([12b7d66](https://github.com/Rain120/qq-music-api/commit/12b7d667c05f92ad61545c5f75a82d878ad3220c))
* getComment ([#26](https://github.com/Rain120/qq-music-api/issues/26)) ([9e62be5](https://github.com/Rain120/qq-music-api/commit/9e62be539b3b78cdf0eea3e1696d9505ab242756))
* getSingerHotsong pagination ([#19](https://github.com/Rain120/qq-music-api/issues/19)) ([9bb705a](https://github.com/Rain120/qq-music-api/commit/9bb705a1b6eb4e2577ba20f0a279ccb63112390d))
* getSingerHotsong pagination ([#22](https://github.com/Rain120/qq-music-api/issues/22)) ([6d6dbf3](https://github.com/Rain120/qq-music-api/commit/6d6dbf36c545269ad7a6138e711e436a90d61e28))
* issue 14 about getRank topId was invalid ([024096f](https://github.com/Rain120/qq-music-api/commit/024096fa63144391680f1d6ec376929fee697c37))
* issue 14 about getRank which bug about period change by qq music api ([f13d2b5](https://github.com/Rain120/qq-music-api/commit/f13d2b540d860994600cc2728e4d848df574b2f4))
* issue: 12 -> (getHotkey -> getHotKey); axios option error; ([ee0371b](https://github.com/Rain120/qq-music-api/commit/ee0371b32352546feb8b60b7725dc3ff66a412ef))
* issue: 12, require getHotkey Camel-Case bug ([0eb9297](https://github.com/Rain120/qq-music-api/commit/0eb9297ff19773ef2d61377f341937f20a70d6a4))
* mv params bug: https://github.com/Rain120/qq-music-api/issues/16\#issuecomment-638230301 ([8f29b87](https://github.com/Rain120/qq-music-api/commit/8f29b874705ab0638310bcc13781a5599ab9de4d)), closes [#issuecomment-638230301](https://github.com/Rain120/qq-music-api/issues/issuecomment-638230301)
* song list params bug: https://github.com/Rain120/qq-music-api/issues/16 ([d9fb973](https://github.com/Rain120/qq-music-api/commit/d9fb9732f546cb76f208053a8dabd164aad893c5))


### Features

* add song list ([c0e8de8](https://github.com/Rain120/qq-music-api/commit/c0e8de86dd93a907aa75e838c18d967b1434493d))
* batch get song info ([0ac4cfc](https://github.com/Rain120/qq-music-api/commit/0ac4cfca38e15e727d79f76c39e729a0ff3abc16))
* batch get songlist ([facc3cb](https://github.com/Rain120/qq-music-api/commit/facc3cbf7a44fbeb1db48bfa0c18e7918938b21c))
* eslint + prettier + commitlint + changelog + editorconfig ([e547ca3](https://github.com/Rain120/qq-music-api/commit/e547ca3c43db052769a06f5e0090a29749b721d5))
* get song info; rebuild the axios request, cut down route params ([4d79041](https://github.com/Rain120/qq-music-api/commit/4d79041a5e5712c0c6bc6e6d55045f732636c80f))
* getImageUrl; commit push shell; ([69f257a](https://github.com/Rain120/qq-music-api/commit/69f257a41d5d4746dce306c84ff902358a0d391c))
* rebuild router and axios ([0b737df](https://github.com/Rain120/qq-music-api/commit/0b737df8971a560119af2bcae199a1ea5549859c))
* rebuild router for lost ([2165b6a](https://github.com/Rain120/qq-music-api/commit/2165b6a8b5527bb2b68592b17e28846fce1e856f))
* rebuild routers ([1278008](https://github.com/Rain120/qq-music-api/commit/1278008d57bd8fb4bced800c3de6c6f16f0aee8f))



