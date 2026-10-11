// 保留下来的旧路由测试：它们只断言状态码落在某个集合里，所以不放在默认测试里。
// 这个配置照样拦截所有外网连接，上游请求一律失败，只用来确认这些路由在上游不可用时
// 仍会正常回应、不会挂住；它不能证明路由拿得到真实数据。
const base = require('./jest.config');

const LEGACY_ROUTES = '<rootDir>/tests/legacy-routes/';

module.exports = {
  ...base,
  collectCoverage: false,
  testMatch: [`${LEGACY_ROUTES}**/*.test.ts`],
  testPathIgnorePatterns: base.testPathIgnorePatterns.filter(
    (pattern) => pattern !== LEGACY_ROUTES,
  ),
  setupFilesAfterEnv: ['<rootDir>/tests/helpers/offlineNetwork.cjs'],
};
