import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectRuntimeClosure } from './helpers/runtimeClosure';

describe('serverless runtime dependency contracts', () => {
  it.each([
    'index.ts',
    'mqtt.ts',
  ])('keeps the whole %s closure free of npm packages and Node builtins', (entry) => {
    const closure = inspectRuntimeClosure(path.join(__dirname, '../src/serverless', entry));
    expect(closure.files).toContain(path.resolve(__dirname, '../src/services/auth/qrLogin.ts'));
    expect(closure.forbidden).toEqual([]);
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
