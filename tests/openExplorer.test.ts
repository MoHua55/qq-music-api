const mockSpawn = jest.fn();
const mockExistsSync = jest.fn();
const mockWriteFileSync = jest.fn();
const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
const mockLoggerState = {
  isTestEnv: false,
  level: 'info',
};

jest.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

jest.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
}));

jest.mock('../src/util/logger', () => ({
  logger: mockLogger,
  loggerState: mockLoggerState,
}));

import {
  AUTO_OPEN_EXPLORER_ENV,
  autoOpenExplorer,
  getExplorerUrl,
  shouldAutoOpenExplorer,
} from '../src/node/openExplorer';

describe('openExplorer util', () => {
  const originalAutoOpenEnv = process.env[AUTO_OPEN_EXPLORER_ENV];
  const originalCI = process.env.CI;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env[AUTO_OPEN_EXPLORER_ENV];
    delete process.env.CI;
    mockLoggerState.isTestEnv = false;
    mockExistsSync.mockReturnValue(false);
    mockSpawn.mockReturnValue({
      on: jest.fn(),
      unref: jest.fn(),
    });
  });

  afterAll(() => {
    process.env[AUTO_OPEN_EXPLORER_ENV] = originalAutoOpenEnv;
    process.env.CI = originalCI;
  });

  it('应在默认情况下禁用自动打开', () => {
    expect(shouldAutoOpenExplorer()).toBe(false);
  });

  it('应在 test 环境下禁用自动打开', () => {
    mockLoggerState.isTestEnv = true;
    process.env[AUTO_OPEN_EXPLORER_ENV] = 'true';

    expect(shouldAutoOpenExplorer()).toBe(false);
  });

  it('应在显式开启且非 test 环境时允许自动打开', () => {
    process.env[AUTO_OPEN_EXPLORER_ENV] = 'true';

    expect(shouldAutoOpenExplorer()).toBe(true);
  });

  it('应在 CI 环境中禁用自动打开', () => {
    process.env[AUTO_OPEN_EXPLORER_ENV] = 'true';
    process.env.CI = 'true';

    expect(shouldAutoOpenExplorer()).toBe(false);
  });

  it('应在没有 marker 时触发浏览器打开', () => {
    process.env[AUTO_OPEN_EXPLORER_ENV] = 'true';

    autoOpenExplorer(3200);

    expect(mockExistsSync).toHaveBeenCalled();
    expect(mockWriteFileSync).toHaveBeenCalled();
    expect(mockSpawn).toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith('explorer.auto_open_started', {
      url: getExplorerUrl(3200),
    });
  });

  it('应在 marker 已存在时跳过浏览器打开', () => {
    process.env[AUTO_OPEN_EXPLORER_ENV] = 'true';
    mockExistsSync.mockReturnValue(true);

    autoOpenExplorer(3200);

    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});
