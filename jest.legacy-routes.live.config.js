// 独立真实上游探测的配置，当前隔离目录为空。
// 不拦截网络，只在明确授权后运行，不进 CI；结果会受网络和上游变动影响。
const offline = require('./jest.legacy-routes.config');

module.exports = {
  ...offline,
  setupFilesAfterEnv: [],
};
