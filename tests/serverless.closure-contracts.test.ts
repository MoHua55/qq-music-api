import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectRuntimeClosure } from './helpers/runtimeClosure';

const HOST_DEFINED_ENV = ['NODE_ENV', 'JEST_WORKER_ID', 'LOG_LEVEL'];

describe('serverless runtime dependency contracts', () => {
  it.each([
    'index.ts',
    'mqtt.ts',
  ])('keeps the whole %s closure free of npm packages and Node builtins', (entry) => {
    const closure = inspectRuntimeClosure(path.join(__dirname, '../src/serverless', entry));
    expect(closure.files).toContain(path.resolve(__dirname, '../src/services/auth/qrLogin.ts'));
    expect(closure.forbidden).toEqual([]);
  });

  // 下游的 Cloudflare 部署只在编译期替换这三个环境变量，其余的 `process.env.*` 会在 Worker
  // 初始化模块时因为没有 `process` 而崩掉；它的部署检查还要求闭包里确实用到 Buffer
  // （宿主因此在入口装全局 Buffer）。两条都照下游检查的写法：读源码文字，不靠打包器。
  it('only reads environment variables the Cloudflare host defines, and still calls Buffer', () => {
    const files = new Set(
      ['index.ts', 'mqtt.ts'].flatMap(
        (entry) => inspectRuntimeClosure(path.join(__dirname, '../src/serverless', entry)).files,
      ),
    );
    const variables = new Set<string>();
    let callsBuffer = false;
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      for (const [, name] of source.matchAll(/\bprocess\.env\.([A-Z0-9_]+)/g)) variables.add(name);
      if (/\bBuffer\s*(?:\.|\()/.test(source)) callsBuffer = true;
    }

    expect(variables.size).toBeGreaterThan(0);
    expect([...variables].filter((name) => !HOST_DEFINED_ENV.includes(name))).toEqual([]);
    expect(callsBuffer).toBe(true);
  });

  it.each([
    "import 'node:fs';",
    "export { default as axios } from 'axios';",
    "const transport = require('ws');",
    "const transport = import('axios');",
    "import transport = require('node:net'); transport();",
    'const transport = import(variable);',
  ])('detects a forbidden dependency behind a barrel: %s', (source) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-contract-graph-'));
    try {
      fs.writeFileSync(path.join(directory, 'entry.ts'), "export * from './barrel';");
      fs.writeFileSync(path.join(directory, 'barrel.ts'), "export * from './leaf';");
      fs.writeFileSync(path.join(directory, 'leaf.ts'), source);
      const closure = inspectRuntimeClosure(path.join(directory, 'entry.ts'));
      expect(closure.files).toHaveLength(3);
      expect(closure.forbidden).toHaveLength(1);
      expect(closure.forbidden[0]).toMatch(/^leaf.ts -> /);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('ignores erased type imports while following runtime cycles', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-contract-graph-'));
    try {
      fs.writeFileSync(
        path.join(directory, 'entry.ts'),
        "import type { A } from 'axios'; import { type B } from 'node:fs'; export type { C } from 'ws'; export { type D } from 'node:net'; import type E = require('node:crypto'); export * from './leaf';",
      );
      fs.writeFileSync(path.join(directory, 'leaf.ts'), "import './entry';");
      const closure = inspectRuntimeClosure(path.join(directory, 'entry.ts'));
      expect(closure.files).toHaveLength(2);
      expect(closure.forbidden).toEqual([]);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
