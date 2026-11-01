import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  inspectSillyTavernPatchTarget,
  installSillyTavernPatchPackage,
  uninstallSillyTavernPatchPackage,
} from '../src/deployment/sillytavern-patch-manager.js';

const stPath = process.env.SILLYTAVERN_PATH;
const manifestPath = resolve('host-adapter/extension-gateway/patches/patch-manager-manifest.json');
const targetCommit = '7e8663cd9c184a550b37238218bdd32c6efc68e9';

function git(args) {
  return execFileSync('git', ['-C', stPath, ...args], { encoding: 'utf8' }).trim();
}

test('Patch Manager installs the sole Extension Gateway into a disposable official ST 1.19.0 checkout and safely rolls it back', {
  skip: !stPath,
}, () => {
  const before = inspectSillyTavernPatchTarget(stPath);
  assert.equal(before.commit, targetCommit);
  assert.equal(before.clean, true);

  const installed = installSillyTavernPatchPackage({ stPath, manifestPath });
  assert.equal(installed.status, 'APPLIED');
  assert.equal(installed.target_commit, targetCommit);
  assert.deepEqual(installed.affected_files.sort(), [
    'public/scripts/extensions/third-party/logic-engine-extension-gateway/index.js',
    'public/scripts/extensions/third-party/logic-engine-extension-gateway/manifest.json',
    'public/scripts/extensions/third-party/logic-engine-extension-gateway/server-gateway.mjs',
    'src/server-main.js',
    'src/server-startup.js',
  ].sort());

  const main = readFileSync(resolve(stPath, 'src/server-main.js'), 'utf8');
  const startup = readFileSync(resolve(stPath, 'src/server-startup.js'), 'utf8');
  const gateway = readFileSync(resolve(stPath, 'public/scripts/extensions/third-party/logic-engine-extension-gateway/server-gateway.mjs'), 'utf8');
  const client = readFileSync(resolve(stPath, 'public/scripts/extensions/third-party/logic-engine-extension-gateway/index.js'), 'utf8');

  assert.ok(main.indexOf('app.use(requireLoginMiddleware)') < main.indexOf('setupPrivateEndpoints(app)'));
  assert.match(main, /request\.path !== EXTENSION_GATEWAY_PATH && request\.is\('application\/json'\)/);
  assert.match(main, /await closeDefaultExtensionGateway\(\{ drain: true \}\)/);
  assert.ok(main.indexOf('closeDefaultExtensionGateway') < main.indexOf('await statsOnExit()'));
  assert.match(startup, /mountDefaultExtensionGateway\(app\);[\s\S]*?app\.use\('\/', userDataRouter\)/);
  assert.equal((gateway.match(/app\.post\(EXTENSION_GATEWAY_PATH/g) || []).length, 1);
  assert.match(client, /const GATEWAY_PATH = '\/api\/logic-engine\/extension'/);
  assert.equal(git(['diff', '--name-only']).split('\n').filter(Boolean).length, 5);

  const rolledBack = uninstallSillyTavernPatchPackage({
    stPath,
    packageId: 'logic-engine.sillytavern-extension-gateway',
  });
  assert.equal(rolledBack.status, 'ROLLED_BACK');
  assert.equal(inspectSillyTavernPatchTarget(stPath).clean, true);
  assert.equal(git(['status', '--porcelain=v1', '--untracked-files=all']), '');
});
