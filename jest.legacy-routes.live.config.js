// 真实上游探测：跑同一批旧路由测试，但不拦截网络，会匿名连到 QQ 音乐的线上接口（不需要账号）。
// 只在明确需要时手动运行，不进 CI；结果会受网络、限流和上游变动影响。
const offline = require('./jest.legacy-routes.config');

module.exports = {
  ...offline,
  setupFilesAfterEnv: [],
};
