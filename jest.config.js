module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/tests/setup.ts'],
  // The default suite may use its local HTTP hosts, but never a real upstream endpoint.
  setupFilesAfterEnv: ['<rootDir>/tests/helpers/offlineNetwork.cjs'],
  // Keep the reserved legacy probe directory outside the default offline contracts.
  testPathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '<rootDir>/.worktrees/',
    '<rootDir>/dist/',
    '<rootDir>/tests/legacy-routes/',
  ],
  modulePathIgnorePatterns: ['<rootDir>/.worktrees/', '<rootDir>/dist/'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/protocol/**/*.ts',
    'src/transport/**/*.ts',
    'src/controllers/**/*.ts',
    'src/routes/operations/**/*.ts',
    'src/services/**/*.ts',
    'src/util/lyricParse.ts',
    '!src/**/*.d.ts',
    '!src/app.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 50,
      lines: 75,
      statements: 75,
    },
  },
};
