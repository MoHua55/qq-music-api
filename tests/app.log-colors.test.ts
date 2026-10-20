import request from 'supertest';

// 嵌入 Electron 时整个主进程共用 String.prototype，载入本包不能往上面加东西；
// 日志会被嵌入方收走，就算终端支持颜色，文字里也不该夹着 ANSI 颜色码。
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`);

type LoadedApp = { app: { callback: () => Parameters<typeof request>[0] }; messages: string[] };

const loadApp = (): LoadedApp => {
  const messages: string[] = [];
  let app: LoadedApp['app'] | undefined;
  jest.isolateModules(() => {
    const { logger } = require('../src/util/logger');
    for (const level of ['debug', 'info', 'warn', 'error'] as const) {
      jest.spyOn(logger, level).mockImplementation((message: unknown) => {
        messages.push(String(message));
      });
    }
    app = require('../src/app').default;
  });
  if (!app) throw new Error('app 没有载入');
  return { app, messages };
};

describe('载入 app 不污染全局，日志不带颜色码', () => {
  const originalForceColor = process.env.FORCE_COLOR;

  beforeEach(() => {
    process.env.FORCE_COLOR = '1';
  });

  afterEach(() => {
    if (originalForceColor === undefined) delete process.env.FORCE_COLOR;
    else process.env.FORCE_COLOR = originalForceColor;
    jest.restoreAllMocks();
  });

  it('载入前后 String.prototype 的属性不变', () => {
    const before = Object.getOwnPropertyNames(String.prototype).sort();
    loadApp();
    expect(Object.getOwnPropertyNames(String.prototype).sort()).toEqual(before);
  });

  it('强制开颜色时，启动日志和请求日志也是纯文字', async () => {
    const { app, messages } = loadApp();
    await request(app.callback()).get('/fixture-missing-route');

    expect(messages.length).toBeGreaterThan(0);
    const plain = messages.map((message) => message.replace(new RegExp(ANSI.source, 'g'), ''));
    expect(plain.some((message) => message.startsWith('GET '))).toBe(true);
    for (const message of messages) expect(message).not.toMatch(ANSI);
  });
});
