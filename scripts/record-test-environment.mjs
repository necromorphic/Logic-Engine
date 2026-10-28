import os from 'node:os';

console.log(JSON.stringify({
  node: process.versions.node,
  npm: process.env.npm_config_user_agent?.match(/npm\/([^\s]+)/)?.[1] ?? null,
  sqlite: process.versions.sqlite ?? null,
  platform: process.platform,
  arch: process.arch,
  osType: os.type(),
  osRelease: os.release(),
  osVersion: os.version(),
  hostname: os.hostname(),
}, null, 2));
