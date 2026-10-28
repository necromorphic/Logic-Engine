import os from 'node:os';

const environment = {
  node: process.versions.node,
  npm: process.env.npm_config_user_agent?.match(/npm\/([^\s]+)/)?.[1] ?? null,
  sqlite: process.versions.sqlite ?? null,
  platform: process.platform,
  arch: process.arch,
  osType: os.type(),
  osRelease: os.release(),
  osVersion: os.version(),
  hostname: os.hostname(),
};

process.stderr.write('ENVIRONMENT_RECORD_BEGIN\n');
process.stdout.write(JSON.stringify(environment, null, 2) + '\n');
process.stderr.write('ENVIRONMENT_RECORD_END\n');
