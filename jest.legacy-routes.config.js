// 旧路由测试已改成模拟上游的契约，放回默认测试集。
// 这个隔离目录目前为空；保留配置和外网拦截，供以后需要单独隔离的测试使用。
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
