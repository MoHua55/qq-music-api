import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import deviceFixture from './fixtures/contracts/device-v1.json';

/**
 * D8: the `exports` contract is tested against the artifact `npm pack` produces, not against the
 * repo source. Those differ in exactly the ways that matter here — `files`, the subpath map and
 * whether the built output is actually present — and a test that imports `src/` would pass while
 * a published package was broken.
 *
 * 🔴 Adding `exports` is the breaking change that makes this a major release: it stops any deep
 * import that is not listed. The assertions below are the contract that justifies 3.0.0.
 */

const repoRoot = path.join(__dirname, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npmCli =
  process.env.npm_execpath ??
  (process.platform === 'win32'
    ? path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
    : undefined);

let fixture: string;
let installed: string;
let listenPort: string;

// Run the npm CLI with Node on Windows so paths and arguments never pass through a shell.
const run = (command: string, args: string[], cwd: string): string =>
  execFileSync(npmCli ? process.execPath : command, npmCli ? [npmCli, ...args] : args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

/** Runs the entry point in a child process, because requiring the root binds a port. */
const runInNode = (
  source: string,
  listen = false,
): { status: number; stdout: string; stderr: string } => {
  const scriptPath = path.join(fixture, `probe-${Math.random().toString(36).slice(2)}.mjs`);
  fs.writeFileSync(scriptPath, source, 'utf8');
  try {
    const stdout = execFileSync(
      process.execPath,
      ['--require', path.join(__dirname, 'helpers/offlineNetwork.cjs'), scriptPath],
      {
        cwd: fixture,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 15000,
        env: {
          ...process.env,
          NODE_ENV: listen ? 'production' : 'test',
          JEST_WORKER_ID: '',
          PORT: listen ? listenPort : '3200',
          LOG_LEVEL: 'silent',
          AUTO_OPEN_EXPLORER: 'false',
          QQ_DISABLE_UPDATE_CHECK: 'true',
          QQ_AUTH_STATE_PATH: 'memory',
          QQ_AUTH_SESSION_PATH: '',
          QQ_SESSION_SECRET: '',
          QQ_SESSION_SECRET_PREVIOUS: '',
        },
      },
    );
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const failure = error as {
      status?: number;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    return {
      status: failure.status ?? 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr || failure.message || '',
    };
  }
};

beforeAll(async () => {
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-artifact-'));
  // `npm pack` does not compile; `prepublishOnly` only runs on publish (appendix D #15).
  run(npm, ['run', 'build:js'], repoRoot);
  const packed = run(npm, ['pack', '--silent', '--pack-destination', fixture], repoRoot).trim();
  const tarball = path.join(fixture, packed.split('\n').pop() as string);

  fs.writeFileSync(
    path.join(fixture, 'package.json'),
    JSON.stringify({ name: 'artifact-fixture', version: '1.0.0', private: true }),
    'utf8',
  );
  installed = path.join(fixture, 'node_modules', '@yakult-green-tea', 'qq-music-api');
  // Test the real tarball without relying on registry metadata in a fresh CI cache.
  execFileSync('tar', ['-xzf', tarball, '-C', fixture]);
  fs.mkdirSync(path.dirname(installed), { recursive: true });
  fs.renameSync(path.join(fixture, 'package'), installed);
  // Runtime dependency declarations are guarded separately by runtime.dependencies.test.ts.
  fs.symlinkSync(
    path.join(repoRoot, 'node_modules'),
    path.join(installed, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  // The public config requires a positive port. Reserve an ephemeral one before the child starts.
  const reservation = createServer();
  await new Promise<void>((resolve, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', resolve);
  });
  const address = reservation.address();
  if (!address || typeof address === 'string') throw new Error('No fixture port allocated');
  listenPort = String(address.port);
  await new Promise<void>((resolve, reject) =>
    reservation.close((error) => (error ? reject(error) : resolve())),
  );
}, 600_000);

afterAll(() => {
  if (fixture)
    fs.rmSync(fixture, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('published artifact', () => {
  it('should ship both builds and the hand-pinned root types', () => {
    expect(fs.existsSync(path.join(installed, 'dist/src/app.js'))).toBe(true);
    expect(fs.existsSync(path.join(installed, 'dist/src/serverless/index.js'))).toBe(true);
    expect(fs.existsSync(path.join(installed, 'dist/src/serverless/index.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(installed, 'dist/src/serverless/mqtt.js'))).toBe(true);
    expect(fs.existsSync(path.join(installed, 'dist/src/serverless/mqtt.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(installed, 'dist-esm/src/serverless/index.js'))).toBe(true);
    expect(fs.existsSync(path.join(installed, 'dist-esm/src/serverless/mqtt.js'))).toBe(true);
    expect(fs.existsSync(path.join(installed, 'types/root.d.ts'))).toBe(true);
  });

  it('should keep the root entry resolvable by require, which is Electron lifeline', () => {
    // §5.3 #7. `main` stays, and `.` resolves to the same CJS file it always did.
    const manifest = JSON.parse(
      fs.readFileSync(path.join(installed, 'package.json'), 'utf8'),
    ) as Record<string, any>;

    expect(manifest.main).toBe('dist/src/app.js');
    expect(manifest.exports['.'].require).toBe('./dist/src/app.js');
    expect(manifest.exports['./package.json']).toBe('./package.json');
  });

  it('should still listen and export the repository hook when the root is required', () => {
    const result = runInNode(`
      import { createRequire } from 'node:module';
      const require = createRequire(import.meta.url);
      const root = require('@yakult-green-tea/qq-music-api');
      const shape = {
        hasDefault: typeof (root.default ?? root) === 'object',
        configure: typeof root.configureAuthSessionRepository,
        // NODE_ENV=test keeps it from binding a port; the export must still exist and be null.
        server: root.server === null ? 'null' : typeof root.server,
      };
      console.log(JSON.stringify(shape));
    `);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({
      hasDefault: true,
      configure: 'function',
      server: 'null',
    });
  });

  it('should expose ./serverless without starting a server or loading Koa', () => {
    // The whole point of the subpath: importing it must not do any of the things the root does.
    const result = runInNode(`
      const before = process.getActiveResourcesInfo?.() ?? [];
      const mod = await import('@yakult-green-tea/qq-music-api/serverless');
      const after = process.getActiveResourcesInfo?.() ?? [];
      console.log(JSON.stringify({
        handler: typeof mod.handleRequest,
        defaultHandler: typeof mod.default,
        sameHandler: mod.default === mod.handleRequest,
        // Nothing may be left running: no listening socket, no timer, no websocket.
        leakedResources: after.filter((r) => !before.includes(r)),
      }));
    `);

    expect(result.status).toBe(0);
    const observed = JSON.parse(result.stdout.trim());
    expect(observed.handler).toBe('function');
    expect(observed.defaultHandler).toBe('function');
    expect(observed.sameHandler).toBe(true);
    expect(observed.leakedResources).toEqual([]);
  });

  it('listens on require and exports a closable server outside the test environment', () => {
    const result = runInNode(
      `
      import { createRequire } from 'node:module';
      import { once } from 'node:events';
      import path from 'node:path';
      const require = createRequire(import.meta.url);
      const root = require('@yakult-green-tea/qq-music-api');
      const server = root.server;
      if (!server.listening) await once(server, 'listening');
      const listening = server.listening;
      const address = server.address();
      let saved = null;
      const record = {
        token: 'a'.repeat(64), credential: { musicid: '10000', musickey: 'fixture-private-key', loginType: 2 },
        device: ${JSON.stringify(deviceFixture.device)}, expiresAt: Date.now() + 60000,
      };
      const injection = root.configureAuthSessionRepository({
        kind: 'electron-fixture', load: () => [record], save: (sessions) => { saved = sessions; },
      });
      const directory = path.dirname(require.resolve('@yakult-green-tea/qq-music-api/package.json'));
      const { qrLoginService } = require(path.join(directory, 'dist/src/services/auth/qrLogin.node.js'));
      await qrLoginService.logout(record.token);
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      console.log(JSON.stringify({ listening, portBound: address.port > 0,
        closed: !server.listening, synchronousHook: injection === undefined,
        singletonUsesRepository: Array.isArray(saved) && saved.length === 0 }));
    `,
      true,
    );
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({
      listening: true,
      portBound: true,
      closed: true,
      synchronousHook: true,
      singletonUsesRepository: true,
    });
  });

  it('keeps the packaged Electron bootstrap hook in the active call path', () => {
    const result = runInNode(`
      import { createRequire } from 'node:module';
      import path from 'node:path';
      const require = createRequire(import.meta.url);
      const directory = path.dirname(require.resolve('@yakult-green-tea/qq-music-api/package.json'));
      const runtimeRequire = createRequire(path.join(directory, 'package.json'));
      const axios = runtimeRequire('axios');
      const create = axios.create.bind(axios);
      axios.create = (config) => create({ ...config, adapter: async () => { throw new Error('fixture bootstrap failure'); } });
      require('@yakult-green-tea/qq-music-api');
      const { qrLoginService: service } = require(path.join(directory, 'dist/src/services/auth/qrLogin.node.js'));
      const { logger } = require(path.join(directory, 'dist/src/util/logger.js'));
      const calls = [];
      const logs = [];
      logger.warn = (event, metadata) => logs.push({ event, metadata });
      const original = service.failBootstrap;
      service.failBootstrap = function(error, stage) {
        calls.push({ argumentCount: arguments.length, error: error instanceof Error, stage });
        return original.call(this, error, stage);
      };
      let status;
      try { await service.createSession('qq'); } catch (error) { status = error.httpStatus; }
      console.log(JSON.stringify({ hookArity: original.length, sessionHookArity: service.failSession.length,
        loggerMethods: ['info', 'warn', 'error'].map(key => typeof logger[key]), calls,
        log: logs.find(item => item.event === 'qq-auth.bootstrap-failed'), status }));
    `);
    expect(result.status).toBe(0);
    const observed = JSON.parse(result.stdout.trim());
    expect(observed).toMatchObject({
      hookArity: 2,
      sessionHookArity: 3,
      loggerMethods: ['function', 'function', 'function'],
      calls: [{ argumentCount: 2, error: true, stage: 'device-bootstrap' }],
      status: 502,
    });
    expect(observed.log).toMatchObject({
      event: 'qq-auth.bootstrap-failed',
      metadata: {
        failureStage: 'device-bootstrap',
        failureReason: 'unexpected-error',
        retryAfterMs: 30000,
      },
    });
  });

  it('keeps the packaged Electron session hook in the active failure path', () => {
    const result = runInNode(`
      import { createRequire } from 'node:module';
      import path from 'node:path';
      const require = createRequire(import.meta.url);
      const directory = path.dirname(require.resolve('@yakult-green-tea/qq-music-api/package.json'));
      const runtimeRequire = createRequire(path.join(directory, 'package.json'));
      const axios = runtimeRequire('axios');
      const create = axios.create.bind(axios);
      axios.create = (options) => create({ ...options, adapter: async (config) => {
        let data;
        if (config.url.includes('api.tencentmusic.com')) {
          data = { data: JSON.stringify({ code: 0, data: { q16: 'q'.repeat(36), q36: 'r'.repeat(36) } }) };
        } else {
          const method = JSON.parse(config.data).req_0.method;
          if (!['GetSession', 'CreateQRCode'].includes(method)) throw new Error('Unstubbed fixture RPC');
          data = { code: 0, req_0: { code: 0, data: method === 'GetSession'
            ? { session: { uid: 10000, sid: 'fixture-sid' } }
            : { qrcodeID: 'fixture-qr', qrcode: 'data:image/png;base64,iVBORw0KGgoBAgME' } } };
        }
        return { status: 200, statusText: 'OK', headers: {}, config, data };
      } });
      runtimeRequire('ws');
      require.cache[runtimeRequire.resolve('ws')].exports = class FixtureSocket {
        constructor() { throw new Error('MQTT handshake failed'); }
      };
      require('@yakult-green-tea/qq-music-api');
      const { qrLoginService: service } = require(path.join(directory, 'dist/src/services/auth/qrLogin.node.js'));
      const { logger } = require(path.join(directory, 'dist/src/util/logger.js'));
      const calls = [];
      const logs = [];
      logger.warn = (event, metadata) => logs.push({ event, metadata });
      const original = service.failSession;
      service.failSession = function(session, error, stage) {
        calls.push({ argumentCount: arguments.length, channel: session.channel, state: session.state,
          error: error instanceof Error, stage });
        return original.call(this, session, error, stage);
      };
      const key = await service.createSession('qq');
      try { await service.createQr(key); } catch {}
      const result = await service.checkQr(key);
      console.log(JSON.stringify({ calls, result, log: logs.find(item => item.event === 'qq-auth.session-failed') }));
    `);
    expect(result.status).toBe(0);
    const observed = JSON.parse(result.stdout.trim());
    expect(observed.calls[0]).toEqual({
      argumentCount: 3,
      channel: 'qq',
      state: 'creating',
      error: true,
      stage: 'mqtt-listener',
    });
    for (const call of observed.calls) {
      expect(call).toMatchObject({
        argumentCount: 3,
        channel: 'qq',
        error: true,
        stage: 'mqtt-listener',
      });
    }
    expect(observed.result).toMatchObject({
      code: 800,
      failureStage: 'mqtt-listener',
      failureReason: 'mqtt-handshake-failed',
      retryAfterMs: 30000,
    });
    expect(observed.log).toMatchObject({
      event: 'qq-auth.session-failed',
      metadata: {
        loginChannel: 'qq',
        failureStage: 'mqtt-listener',
        failureReason: 'mqtt-handshake-failed',
      },
    });
  });

  it('should answer a request through the packaged serverless entry', () => {
    const result = runInNode(`
      const { default: handleRequest } = await import('@yakult-green-tea/qq-music-api/serverless');
      const response = await handleRequest(
        new Request('https://worker.invalid/login/channels'),
        { QQ_SESSION_SECRET: 'a-secret' },
      );
      console.log(JSON.stringify(await response.json()));
    `);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toMatchObject({
      code: 200,
      data: { channels: ['wechat'], sessionMode: 'sealed', configured: true },
    });
  });

  it('should expose ./mqtt without starting the Koa service', () => {
    const result = runInNode(`
      const before = process.getActiveResourcesInfo?.() ?? [];
      const mod = await import('@yakult-green-tea/qq-music-api/mqtt');
      const after = process.getActiveResourcesInfo?.() ?? [];
      console.log(JSON.stringify({
        listenerFactory: typeof mod.createMqttListenOver,
        leakedResources: after.filter((resource) => !before.includes(resource)),
      }));
    `);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({
      listenerFactory: 'function',
      leakedResources: [],
    });
  });

  it('should refuse a deep import that the exports map does not list', () => {
    // 🔴 This is the breaking part of the change, asserted rather than assumed.
    const result = runInNode(`
      try {
        await import('@yakult-green-tea/qq-music-api/dist/src/services/auth/qrLogin.js');
        console.log('resolved');
      } catch (error) {
        console.log(error.code ?? 'threw');
      }
    `);

    expect(result.stdout.trim()).toBe('ERR_PACKAGE_PATH_NOT_EXPORTED');
  });

  it('keeps the public host types available from the installed package', () => {
    const source = path.join(fixture, 'host-contract.ts');
    fs.writeFileSync(
      source,
      `
      import { configureAuthSessionRepository, server } from '@yakult-green-tea/qq-music-api';
      import handler, { handleRequest, type QqQrRelay, type QrEvent } from '@yakult-green-tea/qq-music-api/serverless';
      import { createMqttListenOver, type MqttConnect, type QrEventListener } from '@yakult-green-tea/qq-music-api/mqtt';
      const relay: QqQrRelay = {
        open: async (_id, _image, _ttl) => {}, image: async (_id) => '',
        poll: async (_id, _budget): Promise<QrEvent[]> => [], close: async (_id) => {},
      };
      const env = { QQ_SESSION_SECRET: 'fixture-current', QQ_SESSION_SECRET_PREVIOUS: 'fixture-previous' };
      const response: Promise<Response> = handler(new Request('https://host.invalid/login/status'), env, { qqRelay: relay });
      const other: Promise<Response> = handleRequest(new Request('https://host.invalid/login/channels'), env);
      declare const connect: MqttConnect;
      const listen: (id: string, onEvent: (event: QrEvent) => void, ttl: number) => QrEventListener = createMqttListenOver(connect);
      configureAuthSessionRepository({ kind: 'electron-fixture', load: () => [], save: (sessions) => { sessions.map(session => session.token); } });
      server?.once('listening', () => {});
      server?.close();
      void [response, other, listen];
    `,
    );
    expect(() =>
      execFileSync(
        process.execPath,
        [
          path.join(repoRoot, 'node_modules/typescript/bin/tsc'),
          source,
          '--noEmit',
          '--strict',
          '--skipLibCheck',
          '--esModuleInterop',
          '--target',
          'es2022',
          '--module',
          'node16',
          '--moduleResolution',
          'node16',
          '--typeRoots',
          path.join(repoRoot, 'node_modules/@types'),
        ],
        { cwd: fixture, encoding: 'utf8' },
      ),
    ).not.toThrow();
  });
});
