const { spawnSync } = require('node:child_process');
const { version } = require('../package.json');

const volume = process.argv[2];
if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*:\/app\/\.auth-state$/.test(volume ?? '')) {
  console.error('Provide a named volume mounted at /app/.auth-state.');
  process.exitCode = 1;
} else {
  const args = ['run', '-d', '--name', 'qq-music-api', '-p', '3200:3200', '-v', volume];
  // 只传环境变量名，密钥由 Docker 从当前进程读取，不放进命令或日志。
  if (process.env.QQ_SESSION_SECRET) args.push('-e', 'QQ_SESSION_SECRET');
  args.push(`qq-music-api:${version}`);
  const result = spawnSync('docker', args, { stdio: 'inherit', shell: false });
  process.exitCode = result.status ?? 1;
}
