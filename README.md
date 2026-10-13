<h1 align="center">QQ Music API</h1>

<p align="center">一个可独立部署、也可嵌入 Node.js / Electron 的非官方 QQ 音乐 API。</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@yakult-green-tea/qq-music-api"><img alt="npm version" src="https://img.shields.io/npm/v/@yakult-green-tea/qq-music-api?style=flat-square"></a>
  <a href="https://github.com/yakult-green-tea/qq-music-api/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/yakult-green-tea/qq-music-api/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/github/license/yakult-green-tea/qq-music-api?style=flat-square"></a>
</p>

这个项目基于 `Koa2 + TypeScript`，通过 Web 接口访问 QQ 音乐数据。除了搜索、歌单、歌词和播放链接等常用能力，这个 fork 还补充了原生扫码登录、登录后的音乐库读取，以及 Node.js / Electron 和 Serverless 的接入方式。

> [!IMPORTANT]
> 本项目由社区维护，与腾讯或 QQ 音乐不存在隶属、授权或合作关系，仅用于技术研究、学习与兼容性开发。使用者应自行遵守所在地法律、平台条款和内容授权要求。

## 这个 fork 增加了什么

- **原生扫码登录**：支持手机 QQ 和微信扫码，不需要手动复制 QQ Cookie；原始凭证由可信后端处理，客户端使用会话标识。
- **登录后的音乐库**：读取个人资料、自建和收藏歌单、“我喜欢”歌曲、收藏专辑，也支持读取自己的不公开歌单。
- **官方歌单读取改进**：完善官方歌单详情和封面读取，减少旧接口不兼容造成的加载失败。
- **Node.js / Electron 接入**：通过 npm 包嵌入服务，可注入加密会话仓库来保存登录态；包内请求配置不会修改宿主共享的 Axios 默认值。
- **Serverless 入口**：提供标准的 `Request / Response` 接口。微信扫码可直接使用；手机 QQ 扫码需要能够维持长连接的中继。不同入口支持的功能以使用文档为准。
- **API Explorer**：用内置表单查看参数、发送请求和预览响应，不必先写调用代码。
- **开发分支中的能力查询与推荐**：查询当前部署的功能和登录通道；登录后读取猜你喜欢，有会话时带凭证读取推荐歌单，没有会话时匿名读取。

能力查询、猜你喜欢和推荐歌单计划随 **3.2.0** 发布，目前仍是开发分支中的功能。请以安装的版本和实际服务支持的能力为准。拿到播放链接也不代表能完整播放，内容和音质仍取决于 QQ 返回的授权结果。

上游来源、维护者与许可证保留说明见 [ATTRIBUTION.md](./ATTRIBUTION.md)。

## 快速开始

需要 **Node.js 20 或更新版本**。如果只是想启动服务，可以安装 npm 包：

```sh
npm install @yakult-green-tea/qq-music-api
node node_modules/@yakult-green-tea/qq-music-api/dist/src/app.js
```

默认服务地址是 `http://localhost:3200`。启动后打开 [API Explorer](http://localhost:3200/explorer)，就能查看接口、填写参数并试用不需要登录的请求。端口可以通过 `PORT` 环境变量修改。

如果要修改源码或运行开发分支：

```sh
git clone https://github.com/yakult-green-tea/qq-music-api.git
cd qq-music-api
npm ci
npm start
```

克隆后默认是 `main`，开发分支中的功能需要切到对应分支。Docker、扫码登录、会话保存和嵌入宿主的配置请看[使用文档](./docs/README.md)。

## 文档与发布

- [使用文档](./docs/README.md)：部署、配置、扫码登录、接口参数和错误处理。
- [贡献指南](./CONTRIBUTING.md)：开发环境、提交流程和测试要求。
- [发布流程](./RELEASING.md)与[变更记录](./CHANGELOG.md)：版本验证、发包步骤和已发布的改动。
- [npm 包](https://www.npmjs.com/package/@yakult-green-tea/qq-music-api)与[GitHub Releases](https://github.com/yakult-green-tea/qq-music-api/releases)：获取已发布版本。
- [安全政策](./SECURITY.md)：报告安全或凭证相关问题。

反馈问题时，请提供复现步骤、Node.js 版本和脱敏后的响应摘要。不要公开登录凭证、session cookie、完整播放链接或含凭证的 HAR。

## 贡献者与来源

本项目是 [Rain120/qq-music-api](https://github.com/Rain120/qq-music-api) 的社区维护 fork，并以 `@yakult-green-tea/qq-music-api` 发布。感谢原作者 [Rain120](https://github.com/Rain120) 以及所有贡献者。

- [chthollyphile](https://github.com/chthollyphile)：Axios 请求隔离、可注入认证会话仓库、Serverless 集成与登录态播放改进。
- [lantudou](https://github.com/lantudou)：登录态自建歌单详情与不公开歌单读取支持。
- 完整贡献记录保留在 Git 历史与 [ATTRIBUTION.md](./ATTRIBUTION.md) 中。

欢迎提交 [Issue](https://github.com/yakult-green-tea/qq-music-api/issues) 或 [Pull Request](https://github.com/yakult-green-tea/qq-music-api/pulls)。

## License

本软件按 [MIT License](./LICENSE) 提供。
