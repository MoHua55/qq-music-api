const { spawnSync } = require('node:child_process');
const { version } = require('../package.json');

const [action, destination, ...extra] = process.argv.slice(2);
const image = 'qq-music-api:' + version;
const validDestination = typeof destination === 'string'
  && /^[a-z0-9][a-z0-9./:_-]+$/.test(destination)
  && destination.includes('/')
  && !destination.includes('..');
let args;

if (action === 'local' && destination === undefined) args = ['build', '-t', image, '.'];
else if (action === 'tag' && validDestination) args = ['image', 'tag', image, destination];
else if (action === 'push' && validDestination) args = ['image', 'push', destination];

if (!args || extra.length) {
  console.error('Use local, tag <your-registry/repository:tag>, or push <your-registry/repository:tag>.');
  process.exitCode = 1;
} else {
  // build、tag、push 各做一件事，不从作者名称猜远端地址，也不自动串接发布。
  const result = spawnSync('docker', args, { stdio: 'inherit', shell: false });
  process.exitCode = result.status ?? 1;
}
