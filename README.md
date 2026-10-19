# QQ Music API

一个非官方的 QQ 音乐 API，支持独立部署，也可以嵌入 Node.js 或 Electron。

[![npm version](https://img.shields.io/npm/v/@yakult-green-tea/qq-music-api?style=flat-square)](https://www.npmjs.com/package/@yakult-green-tea/qq-music-api)
[![CI](https://github.com/yakult-green-tea/qq-music-api/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/yakult-green-tea/qq-music-api/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/yakult-green-tea/qq-music-api?style=flat-square)](./LICENSE)

## 能做什么

- **搜索与曲库**：搜索歌曲、专辑、歌单和歌手，读取歌单详情、歌词和翻译，查询热搜与搜索建议。
- **扫码登录与个人音乐库**：用手机 QQ、微信或 QQ 音乐 App 扫码，读取个人资料、自建和收藏歌单、“我喜欢”、收藏专辑、会员状态和音乐云盘；支持读取自己的不公开歌单。
- **推荐与电台**：猜你喜欢、每日 30 首、推荐歌单、歌单分类、新歌、新碟、排行榜、刷歌模式和电台。
- **歌曲、歌手与 MV**：相似歌曲、相关歌单、歌手资料和作品、歌曲评论、MV 列表、详情与播放链接。
- **歌单与收藏管理**：建立、改名和删除自己的普通歌单，加歌、删歌，收藏歌单和专辑，给歌曲点红心，以及查询收藏状态。写入不自动重试，结果不明时先读回确认。
- **播放链接**：获取音频链接、请求试听或最高可用音质；拿不到链接时保留上游数字码，只有符合已验证特征时才给出地区或会员相关提示。
- **API Explorer**：在内置页面里查看接口、填写参数并检查响应。

功能是否可用还取决于部署方式、登录会话和 QQ 的响应。先调用 `/login/channels` 查看当前部署的能力，具体参数和验证限制见[使用文档](./docs/README.md)。拿到播放链接不代表能完整播放，内容和音质仍受授权结果限制。

## 快速开始

需要 **Node.js 20 或更新版本**和 npm。安装后直接启动：

```sh
npm install @yakult-green-tea/qq-music-api
node node_modules/@yakult-green-tea/qq-music-api/dist/src/app.js
```

默认端口是 `3200`，可以通过 `PORT` 修改。启动后打开 [API Explorer](http://localhost:3200/explorer)，就能查看参数并试用公开接口。

从源码运行：

```sh
git clone https://github.com/yakult-green-tea/qq-music-api.git
cd qq-music-api
npm ci
npm start
```

需要固定版本时，请使用对应的 release tag；`main` 可能包含尚未发布的改动。

### Docker

在仓库根目录运行以下命令。需要跨重启保存登录时，先设置自己的 `QQ_SESSION_SECRET`：

```sh
npm run build:local-images
npm run run:images
```

镜像使用 Node.js 24，只安装生产依赖，默认映射本机 `3200` 端口。运行脚本会挂载 `qq-music-api-state` 卷；重建时复用同一个卷和密钥，才能保留设备身份与加密会话。没有密钥时会话只存内存，重启后需要重新登录。详见[部署与配置](./docs/README.md#启动服务)。

### Electron 与 Serverless

Electron 在主进程加载根模块即可启动服务，导出的 `server` 用于监听启动结果和关闭服务。宿主可以通过 `configureAuthSessionRepository` 注入加密会话仓库，配置方法见[嵌入 Node.js 与 Electron](./docs/README.md#嵌入-nodejs-与-electron)。

Vercel、Cloudflare Workers 等宿主使用 `@yakult-green-tea/qq-music-api/serverless` 的 `handleRequest(request, env, options)`，并由平台传入 `QQ_SESSION_SECRET`。这是可嵌入的请求处理函数，部署入口、跨来源 CORS 和预检由宿主负责。详见 [Serverless 接入](./docs/README.md#serverless-接入)。

## 登录通道与宿主差异

通道由 `channel` 参数选择；请用对应的 App 扫码。

| 通道 | 扫码方式 | Node.js / Docker / Electron | Serverless，无中继 | Serverless，有中继 |
| --- | --- | --- | --- | --- |
| `qq` | 手机 QQ 扫码 | MQTT 长连接 | 默认使用 ptlogin HTTP 网页登录，可关闭 | MQTT 中继 |
| `wechat` | 微信扫码 | 支持 | 支持 | 支持 |
| `qqmusic` | QQ 音乐 App 扫码 | MQTT 长连接 | 不提供 | MQTT 中继 |

QQ 音乐 App 扫码使用 App 当前登录的账号。Serverless 的中继由宿主提供，例如 Cloudflare Durable Object，本包不附带中继服务。没有中继时，设置 `QQ_PTLOGIN_HTTP_ENABLED=0` 可关闭手机 QQ 网页登录。可用通道以 `/login/channels` 的 `data.channels` 为准。

Node 使用 `stored` 会话，默认保存在内存，可配置加密持久化，并在凭证快到期、有请求时自动续期。Serverless 使用 `sealed` 会话，客户端需要在到期前调用 `POST /login/refresh` 并保存新 token，从首次扫码起最多续到 30 天。完整流程见[扫码登录](./docs/README.md#qq-音乐原生扫码登录)。

部署前还要留意：

- **Serverless 的搜索与播放可能受限**：实测过同一账号在本地能播放，网页版却有几首拿不到链接；搜索也可能返回成功但结果为空。原因尚未完全确认，不能保证换部署就能解决。
- **设备数有上限**：新的设备身份可能触发 `20279`。先在 QQ 音乐 App 的设备管理中移除不再使用的设备，再重新扫码；请妥善保留设备文件和会话密钥。
- **Serverless 登出有边界**：客户端清除 token 后退出登录，已签发的 sealed token 不会立即被服务端撤销。

## 文档、版本与集成

- [使用文档](./docs/README.md)：部署配置、登录流程、接口参数和响应示例。
- [错误对照表](./docs/errors.md)：HTTP 状态、`kind`、`errorKey`、上游数字码和重试规则。
- [相容与版本政策](./docs/compatibility.md)：稳定接口、保留路径、版本规则、退役流程与升级方式。
- [变更记录](./CHANGELOG.md)、[npm 包](https://www.npmjs.com/package/@yakult-green-tea/qq-music-api)和 [GitHub Releases](https://github.com/yakult-green-tea/qq-music-api/releases)：查看改动并获取发布版本。

当前版本系列为 `3.3.x`；`3.3.4` 移除 9 条已预告的旧路由，升级前请查看[相容政策](./docs/compatibility.md)和[替代路由](./docs/README.md#已移除)。

Folia 是已知下游，使用本项目提供 QQ 音乐接入。本包发版不会自动更新 Folia；它需要单独更新依赖和锁文件，重新构建或部署。自行部署 API 的用户则更新自己运行的服务。

## 安全与反馈

本项目由社区维护，与腾讯或 QQ 音乐没有隶属、授权或合作关系。使用时请遵守平台条款和内容授权要求。

原始登录凭证只应留在可信后端。不要在公开 Issue、日志或截图里放 Cookie、二维码标识、会话 token、设备文件、账号标识或完整播放链接；也不要上传含凭证的 HAR。安全问题请通过[私密报告渠道](./SECURITY.md)反馈。

欢迎[报告问题](https://github.com/yakult-green-tea/qq-music-api/issues)、改进文档或提交代码。回报问题时请附包版本、运行环境、最小复现步骤，以及脱敏后的状态码和诊断字段。开发和验证要求见[贡献指南](./CONTRIBUTING.md)，发布步骤见[发布流程](./RELEASING.md)。

## 授权与致谢

本项目采用 [MIT License](./LICENSE)，保留原作者 Rain120 的来源记录与原始许可证。感谢 chthollyphile 在请求隔离、会话仓库、Serverless 集成、登录态播放和 QIMEI 时钟偏差恢复方面的贡献，以及 lantudou 对登录态自建歌单详情和不公开歌单读取的支持。完整说明见 [ATTRIBUTION.md](./ATTRIBUTION.md) 与 Git 历史。
