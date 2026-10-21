// 上游接口改了要能早点发现：对真实 QQ 音乐把匿名读取的路由各请求一次，只比回包结构。
// 会访问真实上游，所以默认拒绝执行，必须带 --yes-call-upstream；不进 CI，也不进默认测试。
//
// 用法：npm run build:js && npm run smoke:upstream -- --yes-call-upstream [--update]
// --update 把这次的结构写进 scripts/smoke/expected.json（确认上游的变化无害后再用）。
// 只在本进程里跑 Node 服务，设备只放内存，不带会话；输出只有路由、状态码和结构差异，没有任何值。

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { CASES } = require('./cases');
const { diffShapes, shapeOf } = require('./structure');

const args = process.argv.slice(2);
if (!args.includes('--yes-call-upstream')) {
  console.error(
    '这个工具会请求真实的 QQ 音乐接口（每条路由一次）。确认要跑，请加 --yes-call-upstream。',
  );
  process.exit(1);
}
const update = args.includes('--update');

const repo = path.resolve(__dirname, '../..');
const expectedFile = path.join(__dirname, 'expected.json');
if (!fs.existsSync(path.join(repo, 'dist/src/app.js'))) {
  console.error('还没有 dist，先跑 npm run build:js');
  process.exit(1);
}

// 必须在载入 dist 之前设好：测试模式下不监听端口、不开浏览器、不查新版本；设备只放内存。
process.env.NODE_ENV = 'test';
process.env.QQ_AUTH_STATE_PATH = 'memory';

const app = require(path.join(repo, 'dist/src/app.js')).default;

// 两次请求之间停一下，别给上游连续打。
const PAUSE_MS = 300;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const run = async () => {
  const server = http.createServer(app.callback());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const values = {};
  const results = {};
  let stopped;
  try {
    for (const item of CASES) {
      const method = item.method ?? 'GET';
      const key = `${method} ${item.path}`;
      const missing = (item.needs ?? []).filter((name) => values[name] === undefined);
      if (missing.length) {
        results[key] = { skipped: `前面没拿到 ${missing.join('、')}` };
        continue;
      }
      const url = new URL(item.path, base);
      for (const [name, value] of Object.entries(item.query?.(values) ?? {}))
        url.searchParams.set(name, String(value));
      const response = await fetch(url, {
        method,
        ...(item.body
          ? {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(item.body(values)),
            }
          : {}),
      });
      let body;
      try {
        body = await response.json();
      } catch {
        body = undefined;
      }
      results[key] = {
        status: response.status,
        ...(typeof body?.code === 'number' ? { code: body.code } : {}),
        shape: shapeOf(
          body,
          0,
          Object.fromEntries(Object.entries(values).map(([name, value]) => [value, name])),
        ),
      };
      // 限流、上游失败或拒绝：立刻停，不继续打。
      if (response.status === 429 || response.status >= 500) {
        stopped = `${key} 回 ${response.status}，已停止`;
        break;
      }
      if (response.ok && item.take && body && typeof body === 'object')
        for (const [name, value] of Object.entries(item.take(body)))
          if (value !== undefined) values[name] = value;
      await sleep(PAUSE_MS);
    }
  } finally {
    server.close();
  }
  return { results, stopped };
};

const report = ({ results, stopped }) => {
  const expected = fs.existsSync(expectedFile)
    ? JSON.parse(fs.readFileSync(expectedFile, 'utf8'))
    : {};
  let changed = 0;
  for (const [key, result] of Object.entries(results)) {
    const before = expected[key];
    if (result.skipped) {
      console.log(`- ${key}：跳过（${result.skipped}）`);
      changed += 1;
      continue;
    }
    const lines = [];
    if (!before) lines.push('快照里还没有这条');
    else if (before.skipped) lines.push('快照里这条是跳过的');
    else {
      if (before.status !== result.status) lines.push(`状态码 ${before.status} → ${result.status}`);
      if (before.code !== result.code) lines.push(`code ${before.code} → ${result.code}`);
      const { changes, additions } = diffShapes(before.shape, result.shape);
      lines.push(...changes, ...additions.map((line) => `（新增）${line}`));
      if (changes.length || before.status !== result.status || before.code !== result.code)
        changed += 1;
    }
    console.log(lines.length ? `! ${key}\n    ${lines.join('\n    ')}` : `  ${key}：结构相同`);
  }
  for (const key of Object.keys(expected))
    if (!(key in results) && !stopped) console.log(`- ${key}：快照里有，这次没跑`);
  if (stopped) console.log(`\n${stopped}`);
  console.log(
    `\n共 ${Object.keys(results).length} 条，和快照不同或跳过的 ${changed} 条${stopped ? '，中途停止' : ''}。`,
  );
  if (update && !stopped) {
    fs.writeFileSync(expectedFile, `${JSON.stringify(results, null, 2)}\n`);
    console.log(`已更新 ${path.relative(repo, expectedFile)}`);
  }
  return stopped ? 2 : changed ? 1 : 0;
};

// 服务里有定时器等句柄，跑完直接退出，不等它们。
run()
  .then((outcome) => process.exit(report(outcome)))
  .catch((error) => {
    console.error(`冒烟没跑完：${error instanceof Error ? error.name : 'Error'}`);
    process.exit(2);
  });
