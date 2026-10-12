// 开发诊断靠 LOG_LEVEL=debug 打开。这里只证明 Node 上这个开关有效；
// serverless 的宿主怎么提供 process.env.LOG_LEVEL 要另外在各平台确认。

const loadLogger = (level: string | undefined) => {
  const previous = process.env.LOG_LEVEL;
  if (level === undefined) delete process.env.LOG_LEVEL;
  else process.env.LOG_LEVEL = level;
  try {
    let loaded!: typeof import('../src/util/logger');
    jest.isolateModules(() => {
      loaded = require('../src/util/logger');
    });
    return loaded;
  } finally {
    if (previous === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = previous;
  }
};

describe('logger level', () => {
  afterEach(() => jest.restoreAllMocks());

  it('writes debug events when LOG_LEVEL=debug', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const { logger, loggerState } = loadLogger('debug');

    logger.debug('fixture.event', { n: 1 });

    expect(loggerState.level).toBe('debug');
    expect(log).toHaveBeenCalledWith('fixture.event', { n: 1 });
  });

  it('keeps debug events silent at the info level', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const { logger } = loadLogger('info');

    logger.debug('fixture.event', { n: 1 });
    logger.info('fixture.info');

    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('fixture.info');
  });

  it('ignores an unknown level and keeps the default', () => {
    const { loggerState } = loadLogger('verbose');

    // 测试环境的默认级别是 error；正式环境是 info
    expect(loggerState.level).toBe('error');
  });
});
