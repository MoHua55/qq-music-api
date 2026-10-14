import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const run = (args: string[], status = 0) => {
  const calls: string[][] = [];
  const processStub = { argv: ['node', 'build-images.js', ...args], exitCode: 0 };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'scripts/build-images.js'), 'utf8'), {
    require: (name: string) => {
      if (name === '../package.json') return pkg;
      if (name === 'child_process' || name === 'node:child_process')
        return {
          exec: (command: string, _options: unknown, callback: Function) => {
            calls.push(command.split(' '));
            callback(null, '', '');
          },
          spawnSync: (command: string, params: string[]) => {
            calls.push([command, ...params]);
            return { status };
          },
        };
      throw new Error('Unexpected dependency');
    },
    process: processStub,
    console: { log() {}, error() {} },
  });
  return { calls, exitCode: processStub.exitCode };
};

describe('Docker commands', () => {
  it('build only creates a local image', () => {
    expect(run(['local']).calls).toEqual([
      ['docker', 'build', '-t', `qq-music-api:${pkg.version}`, '.'],
    ]);
  });
  it('tag requires an explicit destination and never pushes', () => {
    expect(run(['tag', 'registry.example/test/api:review']).calls).toEqual([
      ['docker', 'image', 'tag', `qq-music-api:${pkg.version}`, 'registry.example/test/api:review'],
    ]);
  });
  it('push is an explicit separate action', () => {
    expect(run(['push', 'registry.example/test/api:review']).calls).toEqual([
      ['docker', 'image', 'push', 'registry.example/test/api:review'],
    ]);
  });
  it.each([
    ['remote'],
    ['tag'],
    ['push'],
    ['push', 'registry.example/test/api:review;whoami'],
  ])('invalid action %j never executes Docker', (...args) => {
    const result = run(args);
    expect(result.calls).toEqual([]);
    expect(result.exitCode).toBe(1);
  });
  it('Docker failure is returned to npm', () => {
    expect(run(['local'], 7).exitCode).toBe(7);
  });
  it('build command has no automatic remote action and run persists state', () => {
    expect(pkg.scripts['build:remote-images']).toBeUndefined();
    expect(pkg.scripts['build:images']).toBe('npm run build:local-images');
    expect(pkg.scripts['run:images']).toContain('qq-music-api-state:/app/.auth-state');
  });
});
