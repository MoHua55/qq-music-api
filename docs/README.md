<h2 align="center" id="qqmusicapi">QQ Music API</h2>

这是非官方、社区维护的 QQ 音乐 API，可以独立部署，也可以嵌入 Node.js 或 Electron。软件按 [MIT License](https://github.com/yakult-green-tea/qq-music-api/blob/main/LICENSE) 提供。项目来源与许可证说明见 [ATTRIBUTION.md](https://github.com/yakult-green-tea/qq-music-api/blob/main/ATTRIBUTION.md)。

先按自己的用途往下看：

- [启动服务](#启动服务)：本机、npm 包和 Docker 的运行方式。
- [API Explorer](#api-explorer)：用表单查看参数和响应。
- [QQ 音乐原生扫码登录](#qq-音乐原生扫码登录)：扫码流程、会话和用户资料。
- [查询登录通道与后端能力](#查询登录通道与后端能力)：判断当前部署支持什么。
- [猜你喜欢、电台与推荐歌单](#猜你喜欢与推荐歌单)：歌曲、电台、歌单分类、新歌和错误响应。
- [API接口](#api接口)：原有曲库、搜索、MV 等路由。

## 启动服务

需要 Node.js 20 或更新版本。在仓库根目录运行：

```powershell
git clone https://github.com/yakult-green-tea/qq-music-api.git
Set-Location qq-music-api
npm install
npm start
```

默认地址是 `http://localhost:3200`。服务启动后，打开 `http://localhost:3200/explorer` 查看接口；浏览器可直接访问不需要登录的 GET 路由。

也可以安装 npm 包来启动服务：

```powershell
npm install @yakult-green-tea/qq-music-api
$env:PORT = '3200'
node node_modules/@yakult-green-tea/qq-music-api/dist/src/app.js
```

本地 Docker 使用 Node.js 24 LTS，构建时编译，运行时只安装生产依赖并启动 `dist`。
先在当前环境设置自己的 `QQ_SESSION_SECRET`，再构建和运行：

```powershell
npm run build:local-images
npm run run:images
```

默认映射本机 3200 端口，镜像标签跟随 package.json 的版本。
`run:images` 挂载命名卷 `qq-music-api-state`，保存设备文件和加密会话；重建容器时复用同一个卷及密钥。
容器默认使用 `QQ_AUTH_STATE_PATH=/app/.auth-state/qq-device.json` 和
`QQ_AUTH_SESSION_PATH=/app/.auth-state/qq-sessions.json`。
没设置 `QQ_SESSION_SECRET` 时会话只放内存，重启后需要重新登录；不要把凭证保存成明文。
自行使用 bind mount 时，要让容器的 node 用户有写入权限。

构建不会推送镜像。远端地址必须是自己的 registry/repository，tag 与 push 分开执行：

```powershell
npm run tag:images -- your-registry/your-repository:your-tag
npm run push:images -- your-registry/your-repository:your-tag
```

第二条会发布到指定地址，只在你明确决定推送时运行。
嵌入方通过 npm 安装本包时，需要更新依赖版本、锁文件并重新构建，才能用到新版本。

## API Explorer

Explorer 是内置的接口调试页面，入口为 `http://localhost:3200/explorer`。它从 `/explorer/metadata` 读取接口清单，自动生成参数表单。

### 主要能力

可以按 GET / POST 筛选，也可以搜索接口名称、分类和路由。填写参数后发送请求，在 Response 面板查看结果，在 Logs 面板查看本次页面会话的请求历史。

### 功能截图

<a id="整体预览"></a>

![Explorer 整体预览](./explorer-overview.png)

设置 `AUTO_OPEN_EXPLORER=true` 后，服务启动时会尝试打开浏览器。

## 配置

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `PORT` | `3200` | HTTP 服务端口 |
| `QQ_UNVERIFIED_WRITES_ENABLED` | 关闭 | 预留给以后还没做完真账号验证的写入接口；目前没有接口用到它，红心和专辑收藏都不依赖此开关 |
| `AUTO_OPEN_EXPLORER` | `false` | 启动后自动打开 Explorer；开发命令会设为 true |
| `QQ_AUTH_STATE_PATH` | `.auth-state/qq-device.json` | Android 设备身份文件；设为 `memory` 时只留在内存 |
| `QQ_AUTH_SESSION_PATH` | 无，默认只存内存 | Node 的加密会话文件路径；与 `QQ_SESSION_SECRET` 一起配置 |
| `QQ_ENABLE_UPDATE_CHECK` | `false` | 启动时检查 npm 新版本 |
| `LOG_LEVEL` | `info` | Node 服务的日志级别；排查时可设为 `debug`。请求日志只留方法、路由模板、参数键名和数量、白名单数字码及耗时；不打印歌曲 ID、mediaId 内容、完整参数或播放链接 |
| `QQ_SESSION_SECRET` | 无 | Serverless 会话或 Node 持久会话的加密密钥；持久部署重启时保持不变 |
| `QQ_SESSION_SECRET_PREVIOUS` | 无 | 密钥轮换时读取旧会话的备用密钥 |

设备身份文件不包含用户凭证。多实例部署应各自指定身份文件，避免多个实例共用同一个设备身份。

## 运行时入口

| 导出 | 适用环境 | 用途 |
| --- | --- | --- |
| `@yakult-green-tea/qq-music-api` | Node.js、Docker、Electron | 完整 Koa 服务，可注入登录会话仓库 |
| `@yakult-green-tea/qq-music-api/serverless` | 使用 Web 标准 Request / Response 的运行时 | `handleRequest(request, env, options)` |
| `@yakult-green-tea/qq-music-api/mqtt` | 可以维持 WebSocket 长连接的可信宿主 | 手机 QQ 扫码的 MQTT 编解码与监听器 |

手机 QQ 扫码需要持续的 MQTT over WSS 连接。Workers 可以让 Durable Object 持有连接，再向 `handleRequest` 注入 `qqRelay`。Vercel Functions 部署只应提供微信通道；没有中继的 Serverless 入口也只提供微信。

Serverless 的 `QQ_SESSION_SECRET` 应由部署方生成并放入平台密钥。轮换时可以暂时保留 `QQ_SESSION_SECRET_PREVIOUS`，等旧会话失效后再移除。

### 部署到 Serverless 前要知道的两件事

**网页版可能有几首歌拿不到链接。** Serverless（Vercel、Cloudflare 这类）是由部署平台的机房去向 QQ 要播放链接，QQ 看到的是机房的网络，不是使用者自己的网络。实际遇到过：同一个账号、同一批歌，桌面版和手机 App 都能播，网页版却有几首拿不到链接。这时回应照样是 `200`，那几首标的是 `url_unavailable`（见[获取歌曲播放链接](#获取歌曲播放链接)），不是服务出错，重试也不会变。原因还没完全确认，最可能和发出请求的网络有关，程序里修不了。想让能播的歌最多，就用 Node、Docker 或 Electron 跑在使用者自己的网络上。

**每个新部署对 QQ 来说都是一台新设备。** Serverless 没有设备文件，设备身份是从 `QQ_SESSION_SECRET` 推导出来的：换一个部署、或者换了密钥，就算一台新设备。账号的登录设备已经满了的话，第一次扫码会失败（`upstreamErrorKey` 是 `auth.device-limit`，`failureHint.key` 是 `login.device-limit`；手机 QQ 扫码时要看 `primaryFailure`，见[扫码失败诊断](#扫码失败诊断)）。先在手机上移除不再使用的登录设备，再扫一次就好。所以密钥定下来以后别随便换；轮换密钥时，也要预期大家下次登录会被当成新设备。

### 嵌入 Node.js 与 Electron

包根入口载入时就会调用 `app.listen()`，并导出 HTTP server 句柄 `server`。同一进程只应载入一次；宿主监听 `listening` / `error`，退出时调用 `server.close()`。

默认会话只保存在进程内，重启后要重新登录。需要跨重启保存时，可信宿主可在载入包后立即调用 `configureAuthSessionRepository({ kind, load, save })`。`load()` 应返回解密后的会话列表，`save(sessions)` 接收包含凭证的完整会话。

会话仓库必须由宿主加密。完整凭证不能进入 renderer、浏览器存储、普通 JSON 文件或日志；renderer 只保存 opaque `qqmusic_session`。Electron 可在主进程使用 `safeStorage`，但只有明文后端时不应保存凭证。仓库读写失败会退回内存行为，不阻断重新扫码。

**自动续期**：Node、Electron、Docker 这类把凭证存在服务端的部署（`sessionMode: stored`），会在 QQ 凭证到期前 6 小时内、有请求进来时自动续期一次，`qqmusic_session` 不变，前端不用做任何事。续期失败时继续用还没到期的旧凭证，5 分钟后才再试；登出和续期同时发生时以登出为准。凭证里没有续期材料（例如手机 QQ 扫码走备用验证得到的凭证）就不续。Serverless 部署（`sealed`）目前不自动续期，凭证到期后要重新扫码。

## 接口一览

这个 fork 新增或重写的接口都在下表。要登录的接口，带上扫码得到的会话即可（Node 用 cookie `qqmusic_session` 或 `X-QQ-Session`，Serverless 用 `X-QQ-Session`）。出错时怎么读，看[错误对照表](./errors.md)。

| 接口 | 要登录 | 做什么 | Serverless |
| --- | --- | --- | --- |
| **登录** | | | |
| `GET /login/channels` | 否 | 这个部署支持哪些登录通道和功能 | ✓ |
| `GET /login/qr/key`、`/login/qr/create` | 否 | 拿二维码（`channel=qq` 手机 QQ，`channel=wechat` 微信） | ✓（手机 QQ 要中继） |
| `GET /login/qr/check` | 否 | 查扫码进度，成功时拿到会话 | ✓ |
| `GET /login/qr/cancel` | 否 | 取消这张二维码 | ✓ |
| `GET /login/status`、`/logout` | 是 | 查登录状态、登出 | ✓ |
| **个人资料与歌单** | | | |
| `GET /user/detail` | 是 | 头像、昵称等资料 | ✓ |
| `GET /user/vip` | 是 | 会员等级 `vipLevel` | ✓ |
| `GET /user/playlist` | 是 | 自建和收藏的歌单 | ✓ |
| `GET /user/playlist-detail` | 是 | 自己歌单里的歌（含不公开的歌单） | ✓ |
| `GET /user/liked-songs` | 是 | “我喜欢”的歌，分页 | ✓ |
| `GET /user/albums` | 是 | 收藏的专辑，分页 | ✓ |
| **编辑歌单与收藏** | | | |
| `POST /user/playlist/tracks` | 是 | 往自己的歌单加歌、删歌 | ✓ |
| `POST /user/playlist/create`、`/rename`、`/delete` | 是 | 建立、改名、删除自己的歌单 | ✓ |
| `POST /user/playlist/subscribe` | 是 | 收藏、取消收藏歌单 | ✓ |
| `POST /user/song/like` | 是 | 红心、取消红心，读回确认后才返回成功 | ✓ |
| `POST /user/album/subscribe` | 是 | 收藏、取消收藏专辑，读回确认后才返回成功 | ✓ |
| `GET /user/subscription-status` | 是 | 查歌单、专辑、歌曲有没有收藏 | ✓ |
| **推荐与电台** | | | |
| `GET /user/guess-you-like` | 是 | 猜你喜欢，每次几首 | ✓ |
| `GET /user/daily-songs` | 是 | 今天的每日 30 首 | ✓ |
| `GET /recommend/playlists` | 可选 | 推荐歌单；登录了会更贴近个人口味 | ✓ |
| `GET /recommend/categories`、`/recommend/category-playlists` | 否 | 歌单分类、某个分类下的歌单（可翻页） | ✓ |
| `GET /recommend/new-songs` | 否 | 新歌速递，可选地区 | ✓ |
| `GET /radio/list`、`/radio/tracks` | 是 | 电台分组、某个电台的歌 | ✓ |
| **搜索** | | | |
| `GET /search` | 可选 | 按关键字搜歌曲、专辑、歌单、歌手，可翻页；不登录搜歌常被拒 | ✓ |
| **播放与曲库** | | | |
| `GET /getLyric` | 否 | 歌词（LRC），可选 `isFormat=1` 拆成时间行、`trans=1` 补翻译 | ✓ |
| `GET /getMusicPlay/:songmid` | 可选 | 播放链接；可选 `quality`（含 `best`）、`preview=1` 试听 | ✓（要登录） |
| `GET /getSongInfo`、`/getSongListDetail`、`/getAlbumInfo`、`/getSingerAlbum`、`/getSingerHotsong` | 否 | 歌曲、歌单、专辑、歌手资料 | ✓ |

MV、排行榜等其他接口沿用上游，只在 Node 上提供，参数见下方 [API接口](#api接口)。旧的 `/getSearchByKey` 已经在 3.3.2 移除，搜索请用 `/search`。

## 红心写入

`POST /user/song/like` 收 JSON `{ song: { id, mid, type: 0 }, liked }`。
id 必须是正的安全整数，mid 是 1–64 位字母或数字，type 必填且只能是数字 0，liked 必须是布尔值；不收额外字段。
先读歌曲详情核对 id／mid，再读红心状态；已是目标状态也要确认后才回 `{ code: 200, liked }`。
需要变更时仅向系统目录 201 写一次，再读回目标状态；写入和确认流程不自动重试。
关联无法确认、写入回应不明或读回未知／不符时回安全 `502`，`retryable: false`，不要盲目重送。
默认启用，不需要实验写入开关；没有登录会话回 `401`。
Serverless 未配置会话密钥时仍按既有规则回 `501`。
`features.mutations.likeSong` 为 true。
Node 已用手机 QQ 与微信各完成一次红心、一次取消及独立读回还原；Serverless 真账号与前端界面尚未验收。

## 专辑收藏写入

`POST /user/album/subscribe` 收 JSON `{ id: albumMid, subscribed }`。
id 是 1–64 位字母或数字组成的专辑 MID 字符串，不收数字专辑 id；subscribed 必须是布尔值，不收额外字段。
先读收藏状态，已是目标也要确认；需要变更时只写一次，再读回，确认后才回 `{ code: 200, subscribed }`。
写入或读回不明／不符时回安全 `502`，`retryable: false`，整个确认流程不自动重试。
默认启用，不需要实验写入开关；没有登录会话回 `401`。
Serverless 未配置会话密钥时仍按既有规则回 `501`。
`features.mutations.subscribeAlbum` 为 true。
专辑状态读取与写入优先使用凭证中的精确字符串 owner，不从不安全 number 回建账号。
安全范围的状态参数保持数字；超范围的 19 位 owner 以十进制字符串发送，写入始终用字符串。
初始状态未知或被拒时不会写入。
Node 已用手机 QQ 与微信（含 19 位 owner）各完成一次收藏、一次取消及独立读回还原；Serverless 真账号与前端界面尚未验收。

## QQ 音乐原生扫码登录

Node 支持手机 QQ 和微信扫码。`qq` 指手机 QQ 扫码；入口仍接受旧名 `mobile`，但统一返回 `qq`。扫码登录相关路由都是 GET。

| 步骤 | 接口 | 读取结果 |
| --- | --- | --- |
| 1 | `/login/channels` | 确认通道、会话模式和配置 |
| 2 | `/login/qr/key?channel=qq` 或 `channel=wechat` | 保存 `data.unikey`；不传通道时默认手机 QQ |
| 3 | `/login/qr/create?key=<unikey>` | 显示 `data.qrimg`，按 data URL 自带的 MIME type 读取图片 |
| 4 | `/login/qr/check?key=<unikey>` | `801` 等待、`802` 已扫描、`803` 已确认、`800` 过期或失败 |
| 关闭登录界面 | `/login/qr/cancel?key=<unikey>` | 取消二维码会话 |
| 登录后 | `/login/status` | 读取 `data.profile`；未登录时 `data` 为空 |
| 退出 | `/logout` | 清除当前会话，也删除注入仓库中的记录 |

手机 QQ 图片目前为 PNG，微信图片目前为 JPEG，不要固定写死图片类型。服务同一时间只允许一个二维码会话；新会话会接管尚未扫码的旧会话。

扫码成功后设置 HttpOnly `qqmusic_session`，并在 check 响应的 `cookie` 字段返回同一个 opaque session。跨来源 transport 可以保存完整的 `qqmusic_session=<opaque token>`，再通过 `cookie` query 传回；支持相应入口时也可用 `X-QQ-Session` 请求头。含会话参数的完整 URL 不应写进日志或公开分享。QQ 原始凭证只保留在可信服务端。

### 扫码失败诊断

Node、Electron、Docker 的微信扫码在后端收到“已扫描”后，会保留 `802`，后续的等待回包不会把它退回 `801`。这不代表授权已完成：只有授权成功并换出会话才回 `803`；手机拒绝、二维码过期和轮询失败仍按原规则处理。手机 QQ 通道不变。

微信轮询增加三类服务端日志，默认 `LOG_LEVEL=info` 可见，`warn`、`error` 或 `silent` 可以关闭：

- `qq-auth.wechat-poll`：上游状态码、耗时、轮询预算，以及状态回包、预算内中止或请求错误。错误只记录固定原因和安全数字码。
- `qq-auth.wechat-qr-state`：状态转换，或已扫描后忽略等待事件。
- `qq-auth.wechat-qr-check`：实际返回的 API 状态码、stored／sealed 模式、状态、轮询错误计数和失败阶段。

日志的 `attemptId` 只是进程内计数，用来关联同一轮调用，不来自账号、二维码或会话；进程重启会重置，serverless 每次重建会话时会重新编号。日志不带 QR key、uuid、OAuth code、Cookie、会话 token、账号 id、完整 URL 或原始回包，HTTP 回应也没有新增诊断字段。查看上游 `404`／`405` 后是否返回 `802`／`803`，可以分清扫码状态、授权换凭证与画面显示问题。

serverless 仍从 sealed key 重建每次检查，尚未跨实例保存扫描进度与连续错误计数；上述日志可以定位这一限制，但本次 Node 修正不保证网页面板一直保留“已扫描”。

key、create 的错误响应和 check 的 `800` 响应可能带以下字段。自然过期的 `800` 不带这些诊断字段，不能把所有 `800` 都当作同一种失败。

| 字段 | 怎么读 |
| --- | --- |
| `failureStage` | 失败步骤，如 `device-bootstrap`、`session-bootstrap`、`mqtt-listener`、`credential-validation` |
| `failureReason` | 固定原因，如 `dns-error`、`network-timeout`、`upstream-http-error`；未知原因为 `unexpected-error` |
| `upstreamHttpStatus` | QQ 上游的 HTTP 状态，和本服务状态分开 |
| `upstreamCode`、`upstreamGlobalCode`、`upstreamSubCode` | 取得的上游安全数字码；不能只凭数字推断原因 |
| `retryAfterMs` | 需要等待的毫秒数；HTTP 错误响应同时提供 `Retry-After` |
| `lastFailure` | 本地退避 `429` 的前一次失败摘要；重启或换实例后不保留 |
| `upstreamErrorKey` | 可选。只有通道、步骤和上游数字码都对得上有出处的登记时才给，例如 `auth.device-limit`（登录设备已满）、`auth.rate-limited`（操作太频繁）、`auth.account-restricted`、`auth.account-banned`、`auth.account-binding`、`auth.login-rejected`；没把握的码不给 |
| `failureHint` | 可选，给使用者看的原因 `{ key, message }`，只在认得出的失败时给：`login.device-limit`（登录设备已满）、`login.wrong-scan-app`（手机 QQ 扫码换凭证被拒、可能是用 QQ 音乐 App 扫的，建议改用手机 QQ）、`login.rate-limited`、`login.account-restricted`、`login.account-banned`、`login.account-binding`、`login.rejected`。`message` 是英文预设文案，前端可以按 `key` 换成自己的文字；取消、过期、网络错误这类不给 |
| `primaryFailure`、`fallbackAttempted` | 可选，目前只有手机 QQ 扫码会出现。换凭证失败后服务会用扫码票据再验证一次，顶层字段写的是最后这次验证的结果，`primaryFailure` 交出被它盖掉的换凭证结果（`failureStage`、`failureReason`、`upstreamCode`，能分类时还有 `upstreamErrorKey`），`fallbackAttempted` 是 `true`。想知道真正的原因（比如设备已满 `20279`）就看 `primaryFailure` |

本地退避使用 `qr-key` / `local-backoff`，仍在确认中的会话使用 `qr-key` / `session-busy`。没有取得的字段不会出现。上游拒绝时保留安全数字码，但不把未知码解释成设备超限或账号问题。

### Android device context 与建立 session 前的退避

设备身份默认存在 `.auth-state/qq-device.json`，可通过 `QQ_AUTH_STATE_PATH` 改路径；写盘失败时退回进程内身份。它保存设备识别值与 device session，不保存用户凭证。持久化身份可以避免每次重启都重新注册设备，但不会让多个实例共享登录会话。

建立二维码之前的失败会退避：首次返回 `502` 和失败摘要，后续请求返回 `429`、`Retry-After` 和 `lastFailure`。取消或替换未扫码的二维码不计退避，过期清理只计一次。

扫码失败后要等多久才能拿新二维码：一般是固定 15 秒（手机上取消、二维码过期、网络错误、换凭证被拒等都一样），连续失败也不会越等越久；上游明确说操作太频繁（登录码 `104604` 或上游 HTTP `429`）时是 30 秒。

## 登录后的资料与歌单

| 接口 | 参数 | 返回内容 |
| --- | --- | --- |
| `/user/detail` | 会话 | 当前用户资料 |
| `/user/vip` | 会话 | 当前账号会员状态 `{ code: 200, isVip, vipLevel, upstream }`，分免费、绿钻、超级会员 |
| `/user/playlist` | 可选 `uid`、`favoriteOffset`、`playCount=1` | 自建与收藏歌单；`playCount=1` 时补播放数 |
| `/user/liked-songs` | `offset`、`limit`，最多 100 | 内建“我喜欢”的歌曲分页 |
| `/user/playlist-detail` | 建议传 `tid`；可选 `dirid`、`offset`、`limit`（最多 100）、`playCount=1` | 登录用户自己歌单的歌曲分页，包括不公开歌单；`playCount=1` 时带上这张歌单的播放数 |
| `/user/albums` | `offset`、`limit`，默认 20、最多 100 | 收藏专辑分页 |

`/user/playlist` 只支持当前账号。`uid` 不传就是本人，传其他账号会回 `400`，说明为 `uid must be the logged-in account`。

`/user/vip` 的 `vipLevel` 告诉你账号是哪一级会员：

| `vipLevel` | 意思 | 怎么判断 |
| --- | --- | --- |
| `super` | 超级会员 | `HugeVip === 1` |
| `green` | 绿钻会员 | `HugeVip === 0` 且 `iVipFlag === 1` |
| `free` | 免费账号 | `HugeVip === 0` 且 `iVipFlag === 0` |
| `unknown` | 判断不出来 | 缺 `HugeVip`，或旗标出现 0、1 以外的值 |

`unknown` 不要当成免费账号处理。`iSuperVip` 在绿钻账号也是 1，不能用来认超级会员。`isVip` 和以前一样，只按 `iVipFlag === 1` 判断。这两个字段都不决定能不能播：免费账号领了听歌时长也可能播完整歌曲，播放仍以取链接结果为准。其他已知会员与权益旗标在 `upstream` 原样保留。缺会话回 401、Serverless 没配置密钥回 501；查不到本人可靠旗标回 502，不假装成免费账号，也不拿其他账号的结果代替。能力声明为 `features.user.getVip`。

### 建立、改名与删除自己的普通歌单

`POST /user/playlist/create { "name": "示例歌单" }`：名称必填，最多 20 个字符。成功回 `{ code: 200, tid, dirId, name, verified: true, moderation? }`。`name` 从自建清单读回，不使用可能乱码的写入响应；`moderation` 原样保留已知内容审核旗标。

`POST /user/playlist/delete { "tid": "70001" }`：服务器先从本人自建清单验证目标并换出目录号，只接受已知普通目录 1–199、没有系统类型标记的目标；拒绝“我喜欢”、系统目录、别人的或找不到的歌单，不接受调用方给 `dirId`。写入响应必须匹配目标，读回确认不见后才回 `{ code: 200, tid, deleted: true, verified: true }`。不承诺删除后能恢复。

`POST /user/playlist/rename { "tid": "70001", "name": "新的歌单名称" }`：只改本人普通歌单的名称，不接受描述、封面、公开设置等其他参数。服务器用编辑页的读法取得现值，原样保留描述、封面完整查询串、标签与公开／私密设置，使用已验证的整组写入形状；`dir_show` 只允许 1 或 2，其他值拒绝，不能默认变公开。非空第二封面尚未实测保留，暂不支持这类歌单的改名。写后再次读回核对名称与各项设置才回 `{ code: 200, tid, name, verified: true }`。

三种写入都只送一次、不自动重试。写入已尝试但结果或读回不可靠时回错误，`retryable: false`、`writeAttempted: true`、`verification: "unconfirmed"`，已知的 `tid`／`dirId` 会保留供读回确认，不能直接再写一次。协议来源是网页的写入与读回样本；Android 运行方式仍需实际验收。能力 `features.playlistManagement` 的 `createPlaylist`／`renamePlaylist`／`deletePlaylist` 为 true。

### 普通歌单增删歌曲

`POST /user/playlist/tracks`，JSON 正文：`{ "tid": "70001", "op": "add", "songs": [{ "id": 101, "type": 0 }] }`。`op` 只收 `add` 或 `del`，每次 1–100 首。`type: 0` 表示调用方明确确认是普通曲库歌曲；上游固定送 `songType: 0`，Android 读到的 `type: 1` 或 `songtype: 13` 不能直接传来，未知类型会拒绝。

服务器每次从当前账号自建清单找 `tid` 并换成目录号，不能传 `dirId`；只接受目录号 1–199 且没有系统类型标记的普通自建歌单，其他、别人的歌单和“我喜欢”都拒绝。写入成功回 `{ code: 200, changed: true }`；上游明确报无变更时 `changed: false`，不能据此猜测原因。

只有 `changed: false` 时多回可选的 `verification: { status }`，描述本次请求中全部歌曲的读回状态，不回逐首结果：

| status | 意思 |
| --- | --- |
| `present` | 本次请求的歌曲全部在读回内容中找到，即使歌单还有后续页也能确认 |
| `absent` | 已完整读回歌单，本次请求的歌曲全部不在里面 |
| `unknown` | 部分在、部分不在，或读回不完整、失败、格式不可靠 |

核对最多额外读一次现有的自建歌单内容接口，请求前 100 首，不翻页、不重试。没有读到某首不等于它不存在。
核对失败仍保留原来的 HTTP `200` 和 `changed: false`，只把说明标成 `unknown`；这不是确认写入有变更，也不是无变更的原因。
这个可选字段已做离线验证，尚待候选真账号验收；前端不读它也沿用原来的 `changed` 语义。
写入不自动重试，出错后先读回确认。红心使用独立的 `/user/song/like`，其他歌曲类型仍未开放。
能力 `features.mutations.updatePlaylistTracks` 和 `likeSong` 为 true；这个可选说明不新增能力旗标。

### 收藏与查询收藏状态

`POST /user/playlist/subscribe`：`{ "tid": "70001", "subscribed": true }` 收藏歌单，`false` 取消收藏。只接受本人的会话，账号参数由服务器填；只有上游 `result: 0` 且失败清单为空才回 `{ code: 200, subscribed }`，写入不自动重试。失败后先读回状态再决定下一步，不盲目重送。

`GET /user/subscription-status?type=playlist&ids=70001,70002` 查状态。`type` 支持 `playlist`（数字歌单 id）、`album`（专辑 MID）和 `song`（歌曲 MID）；一次最多 100 个、重复 id 合并。成功回 `{ code: 200, type, items: [{ id, status }] }`，`status` 明确分为 `subscribed`、`not-subscribed`、`unknown`。缺字段或非布尔条目是 `unknown`；整次查询失败回错误，不给未收藏的假结果。三类查询都用过 Android 会话做静态对照，歌单与红心还做过写入前后的状态转换；专辑收藏已完成两个通道的真账号验证并开放（见上方「专辑收藏写入」）。能力为 `features.mutations.subscribePlaylist` 和 `features.catalog.getSubscriptionStatus`。

### 收藏歌单接着读

自建与收藏歌单会合并去重。收藏每页读取 100 条，每轮最多 1000 条：

- 全部读完时，`more: false`，`total` 等于本轮列表长度。
- 到 1000 条仍没读完时，`more: true`，`total` 是自建数加上上游给的收藏总数；用 `nextFavoriteOffset` 作为下一次的 `favoriteOffset`。续读只返回收藏歌单。
- 空页或上游反复给同一页时也会停止，`more: true`，但没有 `nextFavoriteOffset`，调用方不能无限重试。

### 歌单播放数

`GET /user/playlist?playCount=1` 会多读旧接口，给每张歌单补上 `play_cnt`（和推荐歌单同名的数字字段）。不带这个参数时，请求和回包都和以前完全一样，也不会多打上游。

- 自建与收藏各自按官方网页的分页方式读，每份最多 10 页（100 张）；只读本轮列表里有的那一类。
- 按歌单 id 对上、而且是非负整数才给 `play_cnt`；对不上、上游给负数或读失败的条目**不带** `play_cnt`（Android 自建列表原本那个总是 0 的值也会拿掉，不当成真的播放数）。
- 补播放数失败不会让列表失败，路由照样回 `200`；顶层多一个 `playCountComplete`，只有两份清单都完整读到尾才是 `true`。上游没给能判断有没有下一页的信号时，补到的照给，但算没读完。
- 同一个账号 10 分钟内再带 `playCount=1`，直接用上次读到的播放数，不再多打上游；所以播放数最多晚 10 分钟更新，这段时间里新建的歌单也要等过期才有数字。读失败的那份不会记下来，下次会重读。认不出账号时不缓存。

### 选对歌单详情接口

内建“我喜欢”走 `/user/liked-songs`。它的 `dirId: 201` 不是普通歌单 id，不要把它当作通用 `disstid`。

自建歌单走 `/user/playlist-detail`，建议总是传 `tid`；`tid` 与 `dirid` 至少传一个，否则回 `400`。只传 `dirid` 仅适用于当前账号自己的目录。

想在歌单页显示播放数，就带 `playCount=1`：回包顶层多一个 `play_cnt`，数字和这次读详情的回包一起来，不会多打上游。不公开的歌单是 `0`；“我喜欢”在官方客户端不显示播放数，这里也不给；上游没给可用的数字时同样不给，歌曲列表照常。只看一张歌单的播放数时，用这个比 `/user/playlist?playCount=1` 省得多。

收藏的他人歌单走 `/getSongListDetail`。收藏条目也可能有 `dirId`，所以不能凭它判断归属；自建条目常有 `dirName` / `songNum`，收藏条目常用 `name` / `songnum` / `orderTime`，还要结合创建者判断。把收藏歌单送到自己的歌单接口，可能读不到完整歌曲。

匿名接口读不到不公开歌单时，可能仍回上游 `code: 0` 和空列表，因此空列表不能证明这张歌单真的为空。

### 歌单封面

普通收藏歌单优先沿用 `logo`，为空时看 `albumPicUrl`，补成 `picUrl` / `bigpicUrl`；已有字段不覆盖。官方收藏歌单（`dirType: 2` 或 `3`）使用第一首歌的专辑封面。条目已有可用专辑图时直接生成；缺少时每轮最多为 20 张读取第一首歌，读取失败不影响列表返回。`logo` 与 `albumPicUrl` 的上游原值保留。

`/user/albums` 返回 `albums`、`total` 和 `more`。不要把其他专辑接口的非零码或全零结构当作本路由没有收藏。

<a id="猜你喜欢与推荐歌单"></a>

## 猜你喜欢、电台与推荐歌单

这几条接口使用同一套错误响应。出错时的响应和旧接口不一样：状态码直接说明结果，响应里带固定的 `errorKey`，前端照它判断就行（见本节最后）。

### 猜你喜欢

`GET /user/guess-you-like`，需要登录（cookie 或 `X-QQ-Session`）。每次从 QQ 音乐的「猜你喜欢」电台拿几首歌，目前通常返回 5 首；补歌时要按歌曲标识去重，不能保证每批都是新歌。

```json
{
  "code": 200,
  "songs": [{ "mid": "demo-song-mid", "id": 90001, "name": "示例歌曲", "singer": [], "album": {}, "file": {} }],
  "extras": [{ "reason": "示例推荐理由" }]
}
```

- `songs` 里每首歌保持上游原来的格式，和 `/user/liked-songs` 的歌曲一样。
- `extras` 是上游给的推荐理由等附加信息，原样转交；上游没给时没有这个字段。
- 没登录回 `401`（`errorKey: auth.required`），不会拿未登录的结果冒充个人推荐。
- 上游说成功但一首歌都没给，回 `422`（`errorKey: resource.not-found`）。
- Serverless 部署没设 `QQ_SESSION_SECRET` 时回 `501`，和其他要登录的接口一样。

### 每日 30 首

`GET /user/daily-songs`，需要登录。拿当前账号今天的「每日 30 首」，不用先在 QQ 音乐里收藏它。

```json
{
  "code": 200,
  "songs": [{ "mid": "demo-song-mid", "id": 90001, "name": "示例歌曲", "singer": [], "album": {}, "file": {} }]
}
```

- `songs` 里每首歌保持上游原来的格式，和猜你喜欢一样，通常是 30 首。
- 不回歌单 id：上游这里给的 id 不可靠。没有 `refresh` 参数，同一天重复请求拿到的是同一批。
- 没登录回 `401`；上游不认这组凭证也回 `401`，请重新登录。
- 上游说成功但一首歌都没给，回 `422`（`errorKey: resource.not-found`）；上游格式不对回 `502`。
- Serverless 部署没设 `QQ_SESSION_SECRET` 时回 `501`。

### 电台

两条接口都需要登录，没登录回 `401`；Serverless 没设 `QQ_SESSION_SECRET` 时回 `501`。

`GET /radio/list` 列出电台，按分组排好：

```json
{
  "code": 200,
  "groups": [
    { "id": 48, "title": "热门", "radios": [{ "id": 99, "title": "猜你喜欢", "picurl": "https://example.invalid/image.jpg", "listenNum": 1234 }] },
    { "id": 44, "title": "最近", "radios": [] }
  ]
}
```

- 没有可用 id 的分组或电台会被跳过；分组本身是空的（例如还没听过电台时的「最近」）照样保留。上游没给的数字不出现。
- 上游给的清单是空的回 `422`；给了分组却一组都读不出来回 `502`（`upstream.invalid-response`）。

`GET /radio/tracks?id=<电台 id>` 从一个电台拿几首歌，回应和猜你喜欢一样是 `{ code, songs, extras? }`：

- `id=99` 就是「猜你喜欢」，和 `/user/guess-you-like` 同一个来源，可能带推荐理由 `extras`；其他电台目前每次约 9 首，没有 `extras`。
- `id` 必须是正整数，缺了或格式不对回 `400`（`input.invalid`），不会打上游。
- 上游成功但没给歌回 `422`；凭证被 QQ 拒绝回 `401`。补歌时按歌曲标识去重。

### 推荐歌单

`GET /recommend/playlists`，可选 `limit`（默认 25，最多 60）。有登录会话就带着凭证去读，没有就匿名读；Serverless 没设 `QQ_SESSION_SECRET` 也能匿名读。

```json
{
  "code": 200,
  "playlists": [
    {
      "tid": 90001,
      "title": "示例歌单",
      "desc": "示例简介",
      "picurl": "https://example.invalid/image.jpg",
      "songnum": 30,
      "play_cnt": 4321,
      "creator": { "uin": "demo-creator", "encrypt_uin": "demo-encrypted-id", "nick": "示例创建者", "avatar": "https://example.invalid/image.jpg" }
    }
  ],
  "more": true
}
```

- 字段名和歌单列表常用的一样，拿 `tid` 调 `/getSongListDetail` 就能读歌。
- 上游没给的数字（`songnum`、`play_cnt`）就不出现，不会补成 0。
- `more` 只是转述上游的提示。实测这个推荐更像一条推荐流，不是固定长度的列表，所以没有提供「接着读」的参数。
- 会话过期或解不开时当作没登录、匿名读；会话还在但凭证被 QQ 拒绝时回 `401`，前端应清掉这个会话。
- 上游给的列表是空的回 `422`；给了条目但一张都读不出可用的 `tid`，说明上游格式变了，回 `502`（`upstream.invalid-response`）；只有部分条目读不出来时照样回 `200`，读不出来的直接跳过。

### 歌单分类、分类歌单与新歌速递

这三条读的是公开内容，一律匿名读：带了会话也不会用，Serverless 没设 `QQ_SESSION_SECRET` 也能用。

`GET /recommend/categories` 列出官方歌单的分类：

```json
{ "code": 200, "groups": [{ "id": 1, "name": "热门", "categories": [{ "id": 8, "name": "示例分类" }] }] }
```

`GET /recommend/category-playlists?id=<分类 id>&page=1&limit=20` 读一个分类下的歌单。`page` 从 1 开始；`limit` 默认 20、最多 40。歌单字段和 `/recommend/playlists` 一样（`tid`、`title`、`desc`、`picurl`、`play_cnt`、`creator`），拿 `tid` 调 `/getSongListDetail` 就能读歌；另外带上游给的 `total` 和 `more`（这一页之后还有没有）。`id` 缺了或不是正整数回 `400`。

分页使用官方分类内容接口：匿名 `caller` 是字符串 `"0"`、账号值为数字 `0`，上游页码是对外 `page - 1`。`total` 只取这一份内容的 `total_cnt`，`more` 按页码和数量判断，空页仍回 422，不把别的页面总数混进来。内容和排序跟旧分类接口可能不同；目前验证的是普通分类，AI 分类没有验证。

`GET /recommend/new-songs?area=<地区>` 读新歌速递，不给 `area` 就是「最新」（5）。`songs` 保持上游原来的格式；`areas` 列出可选的地区（`id`、`name`），`area` 是这次实际读的地区：

```json
{ "code": 200, "area": 5, "songs": [{ "mid": "demo-song-mid", "name": "示例歌曲" }], "areas": [{ "id": 5, "name": "最新" }] }
```

三条都是：上游成功但没有数据回 `422`，给了条目却一条都读不出来回 `502`（`upstream.invalid-response`），上游业务码不是 0 回 `502` 并保留数字。

### 关键字搜索

`GET /search?keyword=<关键字>&type=song&page=1&limit=10` 按关键字搜索，Node 和 Serverless 都能用。

- `type` 可以是 `song`（不给就是歌曲）、`album`、`playlist`、`singer`；其他值回 `400`。
- `keyword` 必填，去掉前后空白后最多 60 个字；`page` 从 1 开始；`limit` 默认 10、最多 20。
- 不登录也能搜，登录了就带上会话。Serverless 没设 `QQ_SESSION_SECRET` 也能用（只是一律匿名）。
- **不登录搜歌曲常被上游拒绝**：会回 `502`，`errorKey` 是 `search.rejected`（上游码 2001）。这不是「搜不到」，登录后再搜通常就有结果。专辑、歌单、歌手不登录时一般正常。

```json
{ "code": 200, "type": "song", "page": 1, "limit": 10, "total": 36, "more": true, "items": [{ "mid": "demo-song-mid", "name": "示例歌曲" }] }
```

`items` 保持上游原来的格式：歌曲带 `mid`、`file.media_mid`、歌手和专辑的 `mid`；专辑带 `albummid`，歌单带 `dissid`，歌手带 `singerMID`。登录与否用的是同一种上游格式。`total` 是上游给的总数，`more` 表示上游说还有下一页。

真的搜不到回 `200` 加空的 `items`。上游拒绝回 `502` 并保留数字，**不会**当成搜不到；不会自动重试。第二页以后没有完整实测过。

### 出错时的响应

```json
{
  "code": 429,
  "kind": "rate-limited",
  "errorKey": "upstream.rate-limited",
  "message": "Too many requests",
  "retryable": false
}
```

| 状态码 | 什么情况 | 常见的 `errorKey` |
| --- | --- | --- |
| `401` | 没登录，或凭证被 QQ 拒绝 | `auth.required`、`auth.credential-invalid` |
| `422` | 上游成功但没有数据 | `resource.not-found` |
| `429` | 上游限流；上游给了冷却时间才带 `retryAfterMs` 和 `Retry-After` | `upstream.rate-limited` |
| `502` | 上游失败、网络出错或回应格式不对；拿得到的上游数字码放在 `upstreamCode` | `upstream.unknown`、`upstream.http`、`upstream.invalid-response`、`recommendation.rejected`、`search.rejected`、`network.*` |

完整的状态码、`errorKey`、QQ 数字码和播放提示对照见[错误对照表](./errors.md)。上面的数字和歌曲信息都是虚构示例。`message` 是固定的英文说明，不会带上游的原始内容或凭证。

想知道为什么回了 `401` 或 `422`，可以用 `LOG_LEVEL=debug` 启动：会多一条 `recommend.request-diagnostic` 日志，只有接口名、状态码、`errorKey` 和上游的数字码（推荐歌单跳过条目时也会记下跳过几条）。`5xx` 和 `429` 平时就会记一条 `recommend.request-failed` 警告。`LOG_LEVEL` 目前只在 Node 部署上确认有效；serverless 部署要看平台有没有把这个环境变量交给运行时。

## 查询登录通道与后端能力

先调用 `GET /login/channels`，就能知道当前部署支持哪些登录通道和后端功能。这个接口不需要登录，也不访问 QQ 上游。

| 字段 | 怎么读 |
| --- | --- |
| `data.channels` | 可用的扫码通道 id。Node 为 `qq`、`wechat`；serverless 默认只有 `wechat`，注入 QQ 中继后才有 `qq`。`qq` 是手机 QQ 扫码 |
| `data.sessionMode` | Node 为 `stored`，serverless 为 `sealed` |
| `data.configured` | Node 可直接使用内存会话，始终为 `true`；serverless 保持按 `QQ_SESSION_SECRET` 是否存在判断，只有旧密钥时仍为 `false` |
| `data.features` | 按共用接口分组的方法布尔值，说明后端是否已实现相应能力。它与当前用户是否登录、上游是否接受凭证分开；需要登录的功能还要检查 `configured` 和 `/login/status` |

`features` 的分组与方法名：

| 分组 | 已实现的方法 | 尚未实现的方法 |
| --- | --- | --- |
| `auth` | `getLoginStatus`、`logout`、`getQrKey`、`createQr`、`checkQr`、`cancelQr` | — |
| `library` | `getUserPlaylists`、`getUserAlbums`、`getLikedSongIds`、`getLikedSongs` | `getCloudCollection` |
| `catalog` | `getPlaylistTracks`、`getAlbumDetail`、`getAlbumTracks`、`getArtistDetail`、`getArtistSongs`、`getArtistAlbums` | `getPlaylistDetail`、`getCloudTracks`、`getSubscriptionStatus` |
| `playback` | `getSongDetail`、`getAudioSource`、`preview`（`/getMusicPlay` 支持 `preview=1`） | `getReplacement` |
| `search` | `searchSongs`、`searchAlbums`、`searchPlaylists`、`searchArtists`（`/search`，两个运行时都是 `true`） | — |
| `lyrics` | `getLyrics`（`/getLyric`，两个运行时都是 `true`） | `getChorusRanges` |
| `recommendations` | `getPersonalFm`（`/user/guess-you-like`）、`getDailySongs`（`/user/daily-songs`）、`getRecommendedCollections`（`/recommend/playlists`）、`personalFmModes`（可以选电台，见 `radio`）、`getPlaylistCategories`、`getCategoryPlaylists`、`getNewSongs`（`/recommend/categories`、`/recommend/category-playlists`、`/recommend/new-songs`） | `getHistoryEntries`、`getHistoryDates`、`getHistorySongs`、`dislikeSong` |
| `radio` | `getRadioList`（`/radio/list`）、`getRadioTracks`（`/radio/tracks`） | — |
| `mutations` | `updatePlaylistTracks`、`likeSong`、`subscribePlaylist`、`subscribeAlbum` | — |
| `playbackReports` | — | `reportPlayback` |

已有的 `/getSongListDetail` 继续返回原来的歌单数据；`catalog.getPlaylistDetail: false` 指的是尚未提供单独的歌单 metadata 能力。纯前端的可用性判断与本地诊断不属于这里的后端方法声明。

响应示例（只展示部分 `features`）：

```json
{
  "code": 200,
  "data": {
    "channels": ["qq", "wechat"],
    "sessionMode": "stored",
    "configured": true,
    "features": {
      "library": { "getLikedSongs": true },
      "recommendations": { "getDailySongs": true, "dislikeSong": false },
      "mutations": { "likeSong": true, "subscribeAlbum": true }
    }
  }
}
```

新增方法时会在对应分组里加布尔字段。遇到自己不认识的字段可以忽略，查询尚未声明的方法时按不支持处理。

## API接口

下面是原有路由的索引，主要用于 Node 服务。Serverless 支持的范围以 `/login/channels` 为准，不能把整个 Node 路由表当成 Serverless 的功能清单。

示例中的 `demo-*` 和 `90001` 都是虚构值，只展示写法；实际调用时从查询结果取得歌曲、歌手、专辑和歌单标识。为避免不同路由对路径参数的处理差异，这里统一使用 query 参数。

原有接口没有统一改成推荐接口的错误形状。有些曲库接口会用 HTTP `200` 返回包含非零上游码的 body，调用方还要检查 body。`404` 表示没有这条路由，不能用来判断歌单或歌曲为空。

### 获取歌单分类

`GET /getSongListCategories` 返回歌单分类。调用 `/getSongLists` 前可以从这里取得 `categoryId`，无需在客户端复制整份分类表。

### 获取歌单列表

`GET /getSongLists?categoryId=10000000&page=0&limit=20&sortId=5` 返回指定分类的歌单。参数都可省略，示例显示当前默认值；`page` 从 0 开始。

### 批量获取歌单列表

`POST /batchGetSongLists` 接受 JSON body，一次查询多个分类。这里的 `page` / `limit` 保留旧的起止下标语义，分别直接传给上游 `sin` / `ein`，不是 `/getSongLists` 的页号与每页数量：

```json
{
  "categoryIds": [167, 168],
  "page": 0,
  "limit": 19,
  "sortId": 5
}
```

分类 id 请从分类接口取得。

### 获取歌单详情

`GET /getSongListDetail?disstid=90001` 读取歌单。`disstid` 必填；读取官方歌单时可以带登录会话。

QQ 音乐按账号生成的官方歌单（`/user/playlist` 收藏项目中的 `dirType: 3`）有些无法由匿名接口读取，会返回 `code: 10`。请求带着登录会话时，服务会改用登录凭证经 `music.srfDissInfo.aiDissInfo/uniform_get_Dissinfo` 重新读取，并改写成同样的 `cdlist[0]` 结构，`logo` 为第一首歌的专辑图。

重新读取时每页 1000 首，最多读 10 页；读到上限或遇到空页时会停下，这时 `cdlist[0].hasmore` 是 `1`，读完时是 `0`；也可以比较 `cur_song_num` 和 `total_song_num`。匿名接口的原始响应不带 `hasmore`。

重新读取的 `cdlist[0]` 另外带上游给的 `listennum`（播放数）、`uin` 和 `encrypt_uin`（建立者）；上游没给就不出现。`listennum` 和匿名接口的 `visitnum` 是不是同一个统计还没核对，所以字段名照上游原样。上游不理分页、反复给同一页时，重复的歌不会被接上去。

其他歌单仍走匿名接口，响应不变。重新读取失败时返回原来的 `code: 10`，状态码仍为 `200`，不会返回 `401`。Serverless 部署未设置 `QQ_SESSION_SECRET` 时不会重新读取。

### 获取专辑

`GET /getAlbumInfo?albummid=demo-album-mid` 返回专辑资料和歌曲；`albummid` 必填。

### 获取数字专辑

`GET /getDigitalAlbumLists` 返回数字专辑推荐等数据。

### 获取歌手信息

`GET /getSingerDesc?singermid=demo-singer-mid` 返回歌手资料；`singermid` 必填。

### 获取歌手热门歌曲

`GET /getSingerHotsong?singermid=demo-singer-mid&limit=5&page=0` 返回热门歌曲。`singermid` 必填，`limit` 默认 5、`page` 默认 0，保留原有分页算法。

### 获取歌手专辑

`GET /getSingerAlbum?singermid=demo-singer-mid&limit=5&page=0` 返回歌手专辑。`singermid` 必填，`limit` 默认 5；`page` 默认 0，作为专辑列表的起始位置传给上游。

### 获取相似歌手

`GET /getSimilarSinger?singermid=demo-singer-mid` 返回相似歌手；`singermid` 必填。

### 获取歌手列表

`GET /getSingerList` 返回歌手列表。可用 `area`、`sex`、`genre`、`index` 筛选，默认都为 `-100`；`page` 默认 1。具体筛选值以返回数据为准。

### 获取歌手被关注数量信息

`GET /getSingerStarNum?singermid=demo-singer-mid` 返回关注数量；`singermid` 必填。

### 获取歌曲相关信息

`GET /getSongInfo?songmid=demo-song-mid` 返回歌曲资料。还可传 `songid`，从返回结果读取专辑和 `file.media_mid` 等字段。

### 批量获取歌曲相关信息

`POST /batchGetSongInfo` 接受 JSON body。每项是 `[songmid, songid?]`，`songid` 可以省略：

```json
{
  "songs": [["demo-song-mid-a"], ["demo-song-mid-b", 90002]]
}
```

### 获取歌曲播放链接

`GET /getMusicPlay/demo-song-mid` 返回播放结果，也保留旧写法 `?songmid=demo-song-mid`。

| 参数 | 用途 |
| --- | --- |
| `songmid` | 歌曲 mid；多个用逗号分隔 |
| `resType` | `play` 只取播放结果，`all` 保留完整结果；默认 `play` |
| `quality` | `m4a`、`128`、`320`、`ape`、`flac`、`best`；默认 `128` |
| `mediaId` | 可选，使用歌曲详情的 `file.media_mid`；它可能与 `songmid` 不同。试听时只认 14 个字母或数字，格式不对就当没给 |
| `preview` | 可选，`1` 表示要试听文件（免费账号听 VIP 歌时官方也是这样做）；这时忽略 `quality` |
| 会话 | 登录后优先使用当前扫码会话凭证；没有 opaque session 时保留原有行为 |

<a id="获取单个播放链接"></a>

单曲示例：`/getMusicPlay/demo-song-mid?quality=320`。

<a id="获取多个播放链接"></a>
<a id="获取多个播放链接-1"></a>

多曲示例：`/getMusicPlay/demo-song-mid-a,demo-song-mid-b?resType=play`；需要完整结果时改为 `resType=all`。

<a id="歌曲品质"></a>

音质示例：`/getMusicPlay/demo-song-mid?quality=flac`。高音质拿不到链接，不代表低音质也不能播放。上游正常响应但链接为空时，只能确定这一次没有提供音源，不能据此认定下架、会员或地区限制。

**最高可用音质**：`/getMusicPlay/demo-song-mid?quality=best` 会帮你拿这首歌能拿到的最好音质，适合会员账号。带会话时，服务先查一次歌曲详情（每首一个请求，一次最多查 10 首），跳过详情里 `file.size_flac`、`file.size_320mp3` 不大于 0（没有那个文件）的音质，然后按 `flac` → `320` → `128` 一级一级要，拿到就停；每一级把还没拿到链接的歌合成一个请求。每个条目会多一个 `quality`，告诉你实际拿到的是 `flac`、`320` 还是 `128`。三级都没拿到时，回的是 `128` 那一级的结果和提示，`quality` 也是 `128`。详情查不到或超过 10 首的部分直接要 `128`，不猜文件；没带会话时也直接要 `128`。`preview=1` 时仍按试听处理，不走 `best`。不带 `quality` 时请求和回应都和以前一样，条目也不会有 `quality`。

没拿到链接的那首会多一个可选的 `restriction`，拿到链接的条目不变：

```json
{ "url": "", "error": "暂无播放链接",
  "restriction": { "key": "url_unavailable", "evidence": "observed-response", "codes": { "result": 104003, "subcode": 1 },
    "hint": { "key": "playback.reason-unconfirmed", "message": "This song can't be played right now. The exact reason isn't confirmed yet." } } }
```

- `key` 目前只会是 `url_unavailable`（拿不到链接，原因还没确认）。以后有了可靠的对照实验，才会出现 `membership_required`、`region_restricted` 这类更具体的值，所以请把不认识的值也当成「拿不到链接」处理。
- `evidence` 说明这个判断有多可靠；`url_unavailable` 永远是 `observed-response`（只是看到上游没给链接）。
- `codes` 只放这首歌条目里的安全整数（`result`、`subcode`、`errtype`、`code`），一个都没有就省略。这些数字的含义还没确认，不要拿来推断原因。
- `hint` 是给使用者看的原因。带会话的 `m4a`／`128` 失败时，最多为 10 首补查同一会话、同一出口的详情；只有播放条目码 `104003`／`1` 与详情的 `switch`、`msgid`、`alert`、`pay_play` 完整组合吻合，才提示 `playback.maybe-region-restricted`（可能是地区限制）或 `playback.maybe-membership`（可能缺少会员权益）。规则来自一个手机 QQ 免费账号的受控重复实验候选；微信相同特征可复用提示，属于尚未实测的跨通道外推。缺字段、未知特征、查不到详情、匿名或其他音质一律 `playback.reason-unconfirmed`。音乐包和下架仍不分类。`message` 是保留 may 的英文预设，前端可按 key 换文案；提示不改变 `restriction.key`、`evidence`、播放、授权或重试。设置 `QQ_PLAYBACK_HINTS_ENABLED=0`（或 `false`）可全局停用具体提示与额外查询，Node 与 Serverless 都支持。

**原因没确认时再取一次**：带会话的 `m4a`／`128`（包括 `quality=best` 退到最后一级 `128`）有歌拿不到链接、最终提示是 `playback.reason-unconfirmed` 时，服务会用同一会话、同一首、同一音质马上再取一次；这些歌合成一个请求，每首最多多 1 次。再取拿到就直接回链接，前端看到的和一次就成功一样；还是没有，或者再取的请求本身出错，就回第一次的结果，不会让整个请求失败，也不会清会话。已经有地区或会员提示的歌、`320`／`flac`／`ape`、试听和匿名请求都不再取。关掉具体提示时所有失败都是“原因尚未确认”，也照样再取一次。
- 带会话和匿名两条路径都有；`resType=all` 时完整结果照旧，只有 `playUrl` 里多这个字段。

**ape 文件检查**：只有 `quality=ape` 会先查详情中的 `file.size_ape`（每首一次、重复共用、最多 10 首）。确认没有文件时，不取链接，提示 `playback.quality-file-unavailable`，可选 `restriction.failureReason` 为 `quality-file-unavailable`；查询失败、数字缺失或超限时同样不放行，提示 `playback.quality-detail-unavailable`，分类为 `quality-detail-unavailable`。原有 `restriction.key` 仍是 `url_unavailable`，HTTP 状态不变。`320`／`flac` 沿用原行为；`preview=1` 优先按试听规则处理，不检查 ape。

**试听**：带 `preview=1` 时改要歌曲的试听文件。拿到链接的那首会多 `"preview": true`，前端应该把它当成试听来播（长度看歌曲详情的 `file.e_30s`；`file.size_try` 大于 0 代表有试听文件，不代表文件大小），播完算正常结束，不是错误。要之前服务会先查一次这首歌的详情（每首一个请求，一次最多查 10 首）：只有确认 `file.size_try` 大于 0、又知道试听文件名要用的 media id（前端给的有效 `mediaId` 优先，否则用详情里的 `file.media_mid`）才去要。其他情况都不会去要，直接回 `url_unavailable`：带会话、详情读得到而且 `file.size_try` 正好是 `0` 时，`hint.key` 是 `playback.preview-missing`（这首确定没有试听文件，前端可以按会员等级决定要不要建议升级）；详情查不到、media id 不可信、超过 10 首的部分，以及没带会话的匿名请求，`hint.key` 是 `playback.preview-unavailable`（试听不可用或原因尚未确认）；要了上游却没给链接也是这句。不会拿 `songmid` 猜试听文件名，也不会假装有试听。服务不会自动改要试听，要前端明确要求。能力声明里 `playback.preview` 为 `true` 表示支持这个参数。

用 `LOG_LEVEL=debug` 启动 Node 服务后，没拿到链接的条目会记录 `playback.url-unavailable`。日志只留 `phase`、`index`、`quality` 和 `entryCodes` 中的安全整数，不记录歌曲 id、凭证或播放链接。上游数字的含义没确认时不替它命名。

登录态取链沿用独立的 auth HTTP client。Android 取链返回有效 `purl` 但缺少 `sip` 时，服务会探测可用 CDN；探测失败仍使用默认节点。缓存只保留所选节点，不保存完整签名播放链接，且只存在当前服务实例中。

### 获取歌曲歌词

`GET /getLyric?songmid=demo-song-mid` 返回歌词，Node 和 Serverless 都能用，不用登录。`songmid` 是歌曲 mid；可选 `isFormat=true` 请求格式化，默认 `false`。`lyric` 是解好的 LRC 文字；`trans`（翻译）原样转交上游的值，很多歌是空字符串；纯音乐会给一段很短的提示歌词。

想要翻译就带 `trans=1`：旧接口给的翻译是空的时，会再去另一个歌词接口要一次翻译，要到就放进 `trans`（同样是 base64 的 LRC）。外文歌比较常要得到，中文歌多半本来就没有翻译，这时会白打一次请求、`trans` 仍是空字符串。补的那次只试一次，失败也不影响歌词本身，照常回 `200`。不带 `trans=1` 时和以前完全一样，只打一次上游。

### 获取搜索热词

`GET /getHotkey` 返回搜索热词。

### 获取关键字搜索提示

`GET /getSmartbox?key=示例关键词` 返回搜索提示；`key` 必填。

### 获取MV标签

`GET /getMvByTag` 返回 MV 标签。

### 获取MV

`GET /getMv?area_id=15&version_id=7&limit=20&page=0` 返回 MV 列表，示例显示默认值。分类可从返回的标签数据中读取。

### 获取MV播放信息

`GET /getMvPlay?vid=demo-video-id` 返回 MV 播放信息；`vid` 必填。

### 获取歌手MV

`GET /getSingerMv?singermid=demo-singer-mid&num=5&order=time` 返回歌手 MV。`singermid` 必填，`num` 默认 5；数量 query 参数是 `num`。`order=time` 会启用对应的时间排序请求。

### 获取新碟信息

`GET /getNewDisks?page=1&limit=20` 返回新碟信息，示例显示默认值；注意路径中的 `Disks` 拼写。

### 获取首页推荐

`GET /getRecommend` 返回旧的首页推荐结构。它与 `/recommend/playlists` 是两条不同路由，错误处理也不同。

### 获取排行榜单列表

`GET /getTopLists` 返回榜单列表。

### 获取排行榜单详情

`GET /getRanks?topId=4&limit=20&page=0` 返回榜单详情，示例显示默认值。`page` 在这里传给上游的是偏移量。可选 `period` 接受日期，服务会把它转换为相应的年和周。

<a id="获取评论信息cmd代表的意思没太弄明白"></a>

### 获取评论信息

`GET /getComments?id=90001&pagenum=0&pagesize=25` 返回评论。`id` 必填，`pagenum` 默认 0、`pagesize` 默认 25。接着读时，把上一次结果中的 `rootcommentid` 传回来。

其他参数 `cid`、`cmd`、`reqtype`、`biztype` 保留原有传递方式，默认分别为 `205360772`、`8`、`2`、`1`；具体上游含义未完整确认，不把这些参数当作通用分类保证。

### 获取歌曲 + 专辑 图片

`GET /getImageUrl?id=demo-album-mid&size=300x300` 根据图片标识生成图片地址。`id` 必填，`size` 默认 `300x300`，`maxAge` 默认 `2592000`，作为 `max_age` 原样写入图片地址。

### 获取电台列表

`GET /getRadioLists` 读取电台分类列表（旧接口，清单比较旧）。新的登录后电台接口见上面的 `/radio/list` 与 `/radio/tracks`。

### 获取票务信息

`GET /getTicketInfo` 返回票务信息。

### 获取QQ音乐产品的下载地址

`GET /downloadQQMusic` 返回 QQ 音乐产品下载地址。

## 新特性

这一节保留旧的 Web Cookie 接口入口。新应用优先使用扫码会话，不需要手动复制 QQ 原始 Cookie。

### 支持自定义设置cookie

`GET /user/setCookie` 已停用动态设置，始终返回 `403` 和固定说明，不接受写入。早期手动填写原始 Cookie 的使用步骤不适用于当前接口。新应用使用扫码登录即可。

<a id="格式化自定义的-cookie"></a>

### 获取 Cookie

`GET /user/getCookie` 只返回旧配置的脱敏摘要。已配置的 Cookie 会显示为遮罩，`cookieList` 和 `cookieObject` 也会脱敏，不会交出原始凭证。扫码得到的 `qqmusic_session` 是独立的会话，不能从这个接口取得。

<a id="特性提示支持"></a>

旧接口的提示与 body 形状保持各自原有规则，不能统一按推荐接口的 `errorKey` 读取。

登录态读取遇到上游网关码和凭证拒绝码同时出现时，会回 `502` 和原形的安全 `error` 说明，不会把会话当成失效。只有凭证被拒仍回 `401`；只有网关失败仍沿用原来的 `500`。Folia 把这个 `502` 视为网络错误，播放时可能触发音源冷却。

Web 宿主没有全局 `Buffer` 时，扫码和二进制协议使用标准 Web API 的字节实现；Node 保留原 Buffer。serverless 核心无需 npm 包或 Node 运行时模块。Cloudflare 的构建需按宿主设置编译时的日志环境变量；未配置会话密钥的登录路由仍回 `501`。

## 当前架构

- `src/app.ts` 负责启动 Koa、挂载路由和 Explorer。
- `src/controllers/` 处理 HTTP 参数与响应，`src/services/` 访问 QQ 数据。
- `src/protocol/` 保存协议描述与错误分类，`src/transport/` 提供传输组件。
- `src/serverless/` 提供 Web 标准入口；各部署支持的功能由能力接口声明。
- `src/config/apiExplorer.ts` 是 Explorer 的接口清单和参数来源。
- `tests/` 覆盖服务、HTTP 契约、Explorer 和发布产物。

## API结构图

```text
调用方 → Node HTTP / Serverless 入口 → 服务与协议处理 → QQ 音乐
              ↕
         API Explorer（Node）
```

请求配置由包内私有客户端保存，不会改写宿主共享的 `axios.defaults`。登录凭证、设备身份和会话仓库是不同的存储内容，不能互相替代。

## 开发与验证

| 命令 | 用途 |
| --- | --- |
| `npm start` | 运行 TypeScript 源码 |
| `npm run build` | 检查源码和测试的 TypeScript 类型 |
| `npm run lint` | 检查源码 |
| `npm test` | 全套 Jest 离线测试，只允许本机测试连接 |
| `npm run test:contracts` | Folia、Serverless 和发布产物契约测试 |
| `npm run test:legacy-routes` | 预留的旧路由测试入口；当前集合为空，正常结束 |
| `npm run probe:legacy-routes` | 允许真实上游的探测入口；当前集合为空，新增探测后需手动运行 |
| `npm run build:js` | 生成 CommonJS、ESM、类型与运行时资源 |
| `npm run start:dist` | 运行编译产物 |
| `npm run docs` | 在本机预览 Docsify 文档 |

全套 Jest 在 Windows 上使用 PowerShell。离线测试通过表示本地契约通过，不能替代真账号或各宿主的实际验收。发布流程见 [RELEASING.md](https://github.com/yakult-green-tea/qq-music-api/blob/main/RELEASING.md)，贡献方式见 [CONTRIBUTING.md](https://github.com/yakult-green-tea/qq-music-api/blob/main/CONTRIBUTING.md)。

## 排查问题

先确认部署实际加载的包版本、入口和配置，再看脱敏后的状态码与诊断字段。重启本身不能证明某个上游错误已经修复。

一般日志不记录原始上游 body、二维码标识、Cookie、token、设备识别值、账号 id 或完整播放链接。反馈时只提供复现步骤、运行环境和脱敏摘要，敏感 HAR 留在本地。
