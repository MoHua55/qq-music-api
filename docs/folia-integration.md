# Folia 接入清单

这是计划随 **3.2.0** 提供的接入草稿。仓库的包版本目前仍为 3.1.5；本文描述 API 开发分支已经实现的能力，不表示 3.2.0 已发布，也不表示 Folia 已接入这些功能。Folia 端仍需完成下面的适配与验收。

范围是能力声明、猜你喜欢、推荐歌单和这些推荐接口的 `errorKey`。完整调用说明见[使用文档](./README.md)。

## 先升级并确认服务

- [ ] 更新 Folia 根项目与 Docker 的 API 依赖和锁文件，重新构建各自的运行产物。
- [ ] 确认实际加载的 API 版本和入口；npm 包安装成功不能证明 Docker 或 Electron 已使用新产物。
- [ ] 在 Node、Docker、Electron、Workers、Vercel 各自读取 `/login/channels`，按部署实际声明验收。

Electron 的包根入口载入时会启动服务，同一进程只载入一次。会话保存、设备身份和既有扫码流程继续按原有契约处理。

## 按能力显示入口

`GET /login/channels` 不需要登录，也不访问 QQ 上游。读取 `data.features`，按方法判断，而不是只看一个总开关。

| 声明 | API 对应入口 | Folia 的使用方式 |
| --- | --- | --- |
| `recommendations.getPersonalFm` | `/user/guess-you-like` | 实现 `getPersonalFm`，显示猜你喜欢入口 |
| `recommendations.getRecommendedCollections` | `/recommend/playlists` | 实现 `getRecommendedCollections`，显示推荐歌单 |
| `recommendations.getDailySongs` | 当前为 `false` | 不显示日推入口 |
| `mutations.*` | 当前都为 `false` | 不显示写入入口 |
| `search.searchSongs`、`lyrics.getLyrics` | Node 为 `true`，Serverless 为 `false` | 按所连接的运行时判断 |

- [ ] 把后端方法声明接到 provider 的能力判断，分别决定猜你喜欢和推荐歌单入口。
- [ ] `true` 只表示后端已实现，不等于当前用户已登录或 QQ 必定返回成功；需要会话的操作还要检查 `data.configured` 和 `/login/status`。
- [ ] 忽略不认识的新字段；自己需要的方法未声明时按不支持处理。旧后端没有 `features` 时保留既有能力判断，新增推荐入口保持关闭。
- [ ] 只有推荐歌单时不生成猜你喜欢卡片；猜你喜欢不能被当成所有分类电台或每日推荐。

Node 的 `sessionMode` 是 `stored`、`configured` 是 `true`。Serverless 是 `sealed`，`configured` 按当前 `QQ_SESSION_SECRET` 是否存在判断；只有旧密钥时仍为 `false`。手机 QQ 通道需要中继，默认 Serverless 只声明微信。

## 接猜你喜欢

给 `qqTransport` 增加 `GET /user/guess-you-like` 的 operation，再由 QQ provider 的 `getPersonalFm` 使用。它需要当前登录会话，成功响应为：

```json
{
  "code": 200,
  "songs": [{ "mid": "demo-song-mid", "id": 90001, "name": "示例歌曲", "singer": [], "album": {}, "file": {} }],
  "extras": [{ "reason": "示例推荐理由" }]
}
```

示例数据为虚构值。`songs` 保持 QQ 上游歌曲条目的形状，可继续经过 `normalizeQqSong`。`extras` 是可选附加信息，不能要求每次都有，也不能把它当作歌曲数组的一部分。

- [ ] 使用 `songs` 填充或补充播放队列；目前每批通常只有 5 首，不保证每批都是新歌。
- [ ] 补歌时按歌曲标识去重，避免反复追加同一首。
- [ ] 切换账号或来源后，丢弃旧请求的晚到结果。
- [ ] 没登录的 `401` 引导登录；`422` 显示没有匹配的推荐歌曲，不能创建空白假队列。
- [ ] 不要求 API 返回本地电台模式目录，不由一个 `getPersonalFm: true` 推断其他 FM 模式已经实现。

## 接推荐歌单

给 `qqTransport` 增加 `GET /recommend/playlists` 的 operation，由 QQ provider 的 `getRecommendedCollections` 使用。`limit` 默认 25、最多 60。

| 响应字段 | 使用方式 |
| --- | --- |
| `playlists[].tid` | 歌单标识；可交给现有 `/getSongListDetail` 读取歌曲 |
| `title`、`desc`、`picurl` | 名称、简介、封面 |
| `songnum`、`play_cnt` | 可选的歌曲数、播放数；没给就保留缺失，不能补成 0 |
| `creator` | QQ 给的创建者字段；按共用集合结构归一化 |
| `more` | 上游的后续提示；当前没有续读参数，不能据此生成下一页 offset |

- [ ] 有可用会话时带会话，没有会话时允许匿名读取。
- [ ] 会话解不开或已经过期时 API 会匿名读；会话仍能解析但 QQ 拒绝凭证时返回 `401`，沿用清除坏会话的处理。
- [ ] 归一化 `creator`、`description` 和 `playCount`，保留数字字段缺失与真实 0 的区别。
- [ ] 这些推荐歌单不是当前账号的自建歌单，不能按 `tid` 或 `dirId` 开放编辑。
- [ ] 官方歌单重读的播放数可能是 `listennum`，匿名详情可能是 `visitnum`；两种字段都要识别，不能把它们强行改名成同一套上游结构。

真正的空列表返回 `422`；有条目但全都没有可用的 `tid` 返回 `502`，部分可用时返回 `200` 并跳过不可用条目。Folia 应保留这些区别。

## 处理推荐接口的错误

这套 `errorKey` 已用于上述两条推荐路由。不能把它套到所有旧曲库接口或扫码响应上。

| HTTP 状态 | 常见 `errorKey` | Folia 的处理 |
| --- | --- | --- |
| `401` | `auth.required`、`auth.credential-invalid` | 沿用需要登录或坏会话处理；不能扩大到其他未知上游数字码 |
| `422` | `resource.not-found` | 显示没有推荐内容，保留当前账号和会话 |
| `429` | `upstream.rate-limited` | 仅有 `retryAfterMs` / `Retry-After` 时使用后端给的等待时间 |
| `502` | `upstream.unknown`、`upstream.http`、`upstream.invalid-response`、`recommendation.rejected`、`network.*` | 提示推荐请求失败，保留脱敏诊断；不能当作没有结果 |
| `501` | 沿用会话配置接口的原有响应 | Serverless 未配置会话时，猜你喜欢显示会话配置提示；推荐歌单仍可匿名读取 |

- [ ] 在推荐 operation 的 adapter 中识别 `422`，避免现有 transport 把它只显示成一般网络错误。
- [ ] `404` 只按旧后端没有路由处理；不是数据为空。Node 和 Serverless 都要验证这条回落。
- [ ] `message` 是固定英文说明；界面文案和多语言由 Folia 根据 `errorKey` 决定。
- [ ] 诊断只保留安全字段，如 `errorKey`、状态码和上游数字码；不记录原始 body、会话值或完整 URL。
- [ ] 上游业务码 `2001` 在推荐路由返回 `502` / `upstream.unknown`；不能把它解释为限流或自动加冷却时间。

## 接入验收

- [ ] 猜你喜欢完成初次取歌、补歌、去重、切换来源后的晚到防护。
- [ ] 推荐歌单分别覆盖匿名、已登录、过期会话和 QQ 拒绝凭证。
- [ ] 真空列表、全部条目无法读取、部分条目可用显示不同结果；失败不会被改成空结果。
- [ ] 旧后端缺路由时安全降级，仍能使用原有歌单、登录和播放功能。
- [ ] 既有扫码状态、HTTP 状态、Cookie、用户资料和播放结果的读取保持兼容。
- [ ] 各部署入口分别验证；本地离线契约测试不能替代 Folia 与真实账号的运行验收。
