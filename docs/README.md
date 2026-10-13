<h2 align="center" id="qqmusicapi">QQ Music API</h2>

这是非官方、社区维护的 QQ 音乐 API，可以独立部署，也可以嵌入 Node.js 或 Electron。软件按 [MIT License](https://github.com/yakult-green-tea/qq-music-api/blob/main/LICENSE) 提供。项目来源与许可证说明见 [ATTRIBUTION.md](https://github.com/yakult-green-tea/qq-music-api/blob/main/ATTRIBUTION.md)。

先按自己的用途往下看：

- [启动服务](#启动服务)：本机、npm 包和 Docker 的运行方式。
- [API Explorer](#api-explorer)：用表单查看参数和响应。
- [QQ 音乐原生扫码登录](#qq-音乐原生扫码登录)：扫码流程、会话和用户资料。
- [查询登录通道与后端能力](#查询登录通道与后端能力)：判断当前部署支持什么。
- [猜你喜欢与推荐歌单](#猜你喜欢与推荐歌单)：歌曲、歌单和错误响应。
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

本地 Docker 镜像的构建和运行：

```powershell
npm run build:local-images
npm run run:images
```

默认映射本机 3200 端口。嵌入方通过 npm 安装本包时，需要更新依赖版本、锁文件并重新构建，才能用到新版本。

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
| `AUTO_OPEN_EXPLORER` | `false` | 启动后自动打开 Explorer；开发命令会设为 true |
| `QQ_AUTH_STATE_PATH` | `.auth-state/qq-device.json` | Android 设备身份文件；设为 `memory` 时只留在内存 |
| `QQ_ENABLE_UPDATE_CHECK` | `false` | 启动时检查 npm 新版本 |
| `LOG_LEVEL` | `info` | Node 服务的日志级别；排查时可设为 `debug` |
| `QQ_SESSION_SECRET` | 无 | Serverless 会话加密密钥 |
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

### 嵌入 Node.js 与 Electron

包根入口载入时就会调用 `app.listen()`，并导出 HTTP server 句柄 `server`。同一进程只应载入一次；宿主监听 `listening` / `error`，退出时调用 `server.close()`。

默认会话只保存在进程内，重启后要重新登录。需要跨重启保存时，可信宿主可在载入包后立即调用 `configureAuthSessionRepository({ kind, load, save })`。`load()` 应返回解密后的会话列表，`save(sessions)` 接收包含凭证的完整会话。

会话仓库必须由宿主加密。完整凭证不能进入 renderer、浏览器存储、普通 JSON 文件或日志；renderer 只保存 opaque `qqmusic_session`。Electron 可在主进程使用 `safeStorage`，但只有明文后端时不应保存凭证。仓库读写失败会退回内存行为，不阻断重新扫码。

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
| `/user/playlist` | 可选 `uid`、`favoriteOffset` | 自建与收藏歌单 |
| `/user/liked-songs` | `offset`、`limit`，最多 100 | 内建“我喜欢”的歌曲分页 |
| `/user/playlist-detail` | 建议传 `tid`；可选 `dirid`、`offset`、`limit`，最多 100 | 登录用户自己歌单的歌曲分页，包括不公开歌单 |
| `/user/albums` | `offset`、`limit`，默认 20、最多 100 | 收藏专辑分页 |

`/user/playlist` 只支持当前账号。`uid` 不传就是本人，传其他账号会回 `400`，说明为 `uid must be the logged-in account`。

### 收藏歌单接着读

自建与收藏歌单会合并去重。收藏每页读取 100 条，每轮最多 1000 条：

- 全部读完时，`more: false`，`total` 等于本轮列表长度。
- 到 1000 条仍没读完时，`more: true`，`total` 是自建数加上上游给的收藏总数；用 `nextFavoriteOffset` 作为下一次的 `favoriteOffset`。续读只返回收藏歌单。
- 空页或上游反复给同一页时也会停止，`more: true`，但没有 `nextFavoriteOffset`，调用方不能无限重试。

### 选对歌单详情接口

内建“我喜欢”走 `/user/liked-songs`。它的 `dirId: 201` 不是普通歌单 id，不要把它当作通用 `disstid`。

自建歌单走 `/user/playlist-detail`，建议总是传 `tid`；`tid` 与 `dirid` 至少传一个，否则回 `400`。只传 `dirid` 仅适用于当前账号自己的目录。

收藏的他人歌单走 `/getSongListDetail`。收藏条目也可能有 `dirId`，所以不能凭它判断归属；自建条目常有 `dirName` / `songNum`，收藏条目常用 `name` / `songnum` / `orderTime`，还要结合创建者判断。把收藏歌单送到自己的歌单接口，可能读不到完整歌曲。

匿名接口读不到不公开歌单时，可能仍回上游 `code: 0` 和空列表，因此空列表不能证明这张歌单真的为空。

### 歌单封面

普通收藏歌单优先沿用 `logo`，为空时看 `albumPicUrl`，补成 `picUrl` / `bigpicUrl`；已有字段不覆盖。官方收藏歌单（`dirType: 2` 或 `3`）使用第一首歌的专辑封面。条目已有可用专辑图时直接生成；缺少时每轮最多为 20 张读取第一首歌，读取失败不影响列表返回。`logo` 与 `albumPicUrl` 的上游原值保留。

`/user/albums` 返回 `albums`、`total` 和 `more`。不要把其他专辑接口的非零码或全零结构当作本路由没有收藏。

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

`GET /recommend/new-songs?area=<地区>` 读新歌速递，不给 `area` 就是「最新」（5）。`songs` 保持上游原来的格式；`areas` 列出可选的地区（`id`、`name`），`area` 是这次实际读的地区：

```json
{ "code": 200, "area": 5, "songs": [{ "mid": "demo-song-mid", "name": "示例歌曲" }], "areas": [{ "id": 5, "name": "最新" }] }
```

三条都是：上游成功但没有数据回 `422`，给了条目却一条都读不出来回 `502`（`upstream.invalid-response`），上游业务码不是 0 回 `502` 并保留数字。

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
| `502` | 上游失败、网络出错或回应格式不对；拿得到的上游数字码放在 `upstreamCode` | `upstream.unknown`、`upstream.http`、`upstream.invalid-response`、`recommendation.rejected`、`network.*` |

上面的数字和歌曲信息都是虚构示例。`message` 是固定的英文说明，不会带上游的原始内容或凭证。

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
| `playback` | `getSongDetail`、`getAudioSource` | `getReplacement` |
| `search` | `searchSongs` 仅 Node 为 `true`，对应现有搜索路由；serverless 为 `false` | — |
| `lyrics` | `getLyrics` 仅 Node 为 `true`，对应现有歌词路由；serverless 为 `false` | `getChorusRanges` |
| `recommendations` | `getPersonalFm`（`/user/guess-you-like`）、`getRecommendedCollections`（`/recommend/playlists`）、`personalFmModes`（可以选电台，见 `radio`）、`getPlaylistCategories`、`getCategoryPlaylists`、`getNewSongs`（`/recommend/categories`、`/recommend/category-playlists`、`/recommend/new-songs`） | `getDailySongs`、`getHistoryEntries`、`getHistoryDates`、`getHistorySongs`、`dislikeSong` |
| `radio` | `getRadioList`（`/radio/list`）、`getRadioTracks`（`/radio/tracks`） | — |
| `mutations` | — | `updatePlaylistTracks`、`likeSong`、`subscribePlaylist`、`subscribeAlbum` |
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
      "recommendations": { "getDailySongs": false },
      "mutations": { "likeSong": false }
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
| `quality` | `m4a`、`128`、`320`、`ape`、`flac`；默认 `128` |
| `mediaId` | 可选，使用歌曲详情的 `file.media_mid`；它可能与 `songmid` 不同 |
| 会话 | 登录后优先使用当前扫码会话凭证；没有 opaque session 时保留原有行为 |

<a id="获取单个播放链接"></a>

单曲示例：`/getMusicPlay/demo-song-mid?quality=320`。

<a id="获取多个播放链接"></a>
<a id="获取多个播放链接-1"></a>

多曲示例：`/getMusicPlay/demo-song-mid-a,demo-song-mid-b?resType=play`；需要完整结果时改为 `resType=all`。

<a id="歌曲品质"></a>

音质示例：`/getMusicPlay/demo-song-mid?quality=flac`。高音质拿不到链接，不代表低音质也不能播放。上游正常响应但链接为空时，只能确定这一次没有提供音源，不能据此认定下架、会员或地区限制。

没拿到链接的那首会多一个可选的 `restriction`，拿到链接的条目不变：

```json
{ "url": "", "error": "暂无播放链接",
  "restriction": { "key": "url_unavailable", "evidence": "observed-response", "codes": { "result": 104003, "subcode": 1 },
    "hint": { "key": "playback.maybe-region-restricted", "message": "This song may not be available in your region." } } }
```

- `key` 目前只会是 `url_unavailable`（拿不到链接，原因还没确认）。以后有了可靠的对照实验，才会出现 `membership_required`、`region_restricted` 这类更具体的值，所以请把不认识的值也当成「拿不到链接」处理。
- `evidence` 说明这个判断有多可靠；`url_unavailable` 永远是 `observed-response`（只是看到上游没给链接）。
- `codes` 只放这首歌条目里的安全整数（`result`、`subcode`、`errtype`、`code`），一个都没有就省略。这些数字的含义还没确认，不要拿来推断原因。
- `hint` 是给使用者看的原因，只是「可能」：服务会用同一个会话（匿名播放就匿名）再查一次这首歌的详情，从里面的限制讯号挑一句。`key` 有 `playback.maybe-region-restricted`（可能是地区限制）、`playback.maybe-music-pack`（可能要付费音乐包）、`playback.maybe-membership`（可能要会员）、`playback.maybe-taken-down`（看不出原因，或详情读不到时的兜底：可能已下架）。`message` 是英文预设文案，前端可以直接显示，也可以按 `key` 换成自己的文字。`hint` 不会改变 `key` 和 `evidence`。
- 因为要查详情，有歌拿不到链接时会多一个上游请求（一次最多查 10 首）。
- 带会话和匿名两条路径都有；`resType=all` 时完整结果照旧，只有 `playUrl` 里多这个字段。

用 `LOG_LEVEL=debug` 启动 Node 服务后，没拿到链接的条目会记录 `playback.url-unavailable`。日志只留 `phase`、`index`、`quality` 和 `entryCodes` 中的安全整数，不记录歌曲 id、凭证或播放链接。上游数字的含义没确认时不替它命名。

登录态取链沿用独立的 auth HTTP client。Android 取链返回有效 `purl` 但缺少 `sip` 时，服务会探测可用 CDN；探测失败仍使用默认节点。缓存只保留所选节点，不保存完整签名播放链接，且只存在当前服务实例中。

### 获取歌曲歌词

`GET /getLyric?songmid=demo-song-mid` 返回歌词。`songmid` 是歌曲 mid；可选 `isFormat=true` 请求格式化，默认 `false`。

### 获取搜索热词

`GET /getHotkey` 返回搜索热词。

### 获取关键字搜索提示

`GET /getSmartbox?key=示例关键词` 返回搜索提示；`key` 必填。

### 获取搜索结果

`GET /getSearchByKey?key=示例关键词&limit=10&page=1` 查询搜索结果。`key` 必填，`limit` 默认 10、`page` 默认 1。可选 `remoteplace` 默认 `song`，其他值包括 `album`、`mv`、`playlist`、`user`、`lyric`；注意参数拼写是 `remoteplace`。

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
