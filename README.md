<h1 align="center">QQ Music API</h1>

<p align="center">一个可以独立部署，也可以嵌入 Node.js / Electron 的非官方 QQ 音乐 API。</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@yakult-green-tea/qq-music-api"><img alt="npm version" src="https://img.shields.io/npm/v/@yakult-green-tea/qq-music-api?style=flat-square"></a>
  <a href="https://github.com/yakult-green-tea/qq-music-api/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/yakult-green-tea/qq-music-api/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/github/license/yakult-green-tea/qq-music-api?style=flat-square"></a>
</p>

用它可以搜索 QQ 音乐、读取歌曲和歌单、获取歌词与播放链接。登录后，还能读取自己的音乐库和个人推荐。接口细节、部署方式和接入步骤都在[使用文档](./docs/README.md)里。

> 本项目由社区维护，与腾讯或 QQ 音乐没有隶属、授权或合作关系。用于技术研究、学习与兼容性开发；使用者应遵守所在地法律、平台条款和内容授权要求。

## 可以做什么

| 功能 | 说明 |
| --- | --- |
| 搜索与曲库 | 搜索歌曲，读取歌单、专辑、歌手、排行榜和 MV 信息 |
| 歌词与播放链接 | 获取歌词和不同音质的播放链接；实际可播放内容以 QQ 返回结果为准 |
| 扫码登录 | 手机 QQ 与微信扫码，原始凭证保留在服务端 |
| 个人音乐库 | 读取用户资料、自建和收藏歌单、“我喜欢”歌曲、收藏专辑；自己的不公开歌单也可以读取 |
| 猜你喜欢 | 登录后每次取得一批个人推荐歌曲，供播放器补歌 |
| 推荐歌单 | 有登录时使用当前账号凭证，没有登录时匿名读取 |
| 后端能力查询 | 查询当前部署提供的登录通道和功能，让调用方按实际能力显示入口 |
| API Explorer | 用内置表单查看参数、发送请求、预览响应和请求历史 |

能力查询、猜你喜欢和推荐歌单已在开发分支实现，计划随 3.2.0 发布；是否已经可用，以安装的版本和当前服务的能力声明为准。Folia 的接入工作需要在 Folia 端另行完成。

## 在哪里使用

- **独立服务**：通过 HTTP 给网页、播放器或其他客户端提供接口，也可以放进 Docker。
- **Node.js / Electron**：使用 npm 包嵌入可信宿主；可以注入加密会话仓库，在重启后保留登录态。
- **Serverless**：提供 Web 标准的请求入口。微信扫码可直接使用；手机 QQ 扫码需要能够维持长连接的中继。

不同运行环境的功能可能不同。搜索和歌词目前只在 Node 入口提供；扫码通道和会话配置可以通过能力查询确认。包内的请求配置不会修改宿主共享的 Axios 默认值。

## API Explorer

启动 Node 服务后，打开 `http://localhost:3200/explorer`。可以按方法筛选，也可以搜索路由，填写参数后查看响应。

![Explorer 整体预览](./docs/explorer-overview.png)

## 继续阅读

- [使用文档](./docs/README.md)：启动、配置、扫码登录、接口和错误处理。
- [Folia 接入清单](./docs/folia-integration.md)：面向 3.2.0 的接入草稿。
- [贡献指南](./CONTRIBUTING.md)与[发布流程](./RELEASING.md)。
- [变更记录](./CHANGELOG.md)与[安全政策](./SECURITY.md)。
- [项目来源与贡献记录](./ATTRIBUTION.md)；软件按 [MIT License](./LICENSE) 提供。

反馈问题时，请提供复现步骤、Node.js 版本和脱敏后的响应摘要。不要公开登录凭证、session cookie、完整播放链接或含凭证的 HAR。
