import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  inspectSillyTavernPatchTarget,
  installSillyTavernPatchPackage,
  recoverSillyTavernPatchTransaction,
  uninstallSillyTavernPatchPackage,
} from '../src/deployment/sillytavern-patch-manager.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const clientPath = 'public/scripts/extensions/third-party/logic-engine-extension-gateway/index.js';
const serverPath = 'public/scripts/extensions/third-party/logic-engine-extension-gateway/server-gateway.mjs';
const nativeStartupPath = 'src/server-startup.js';
const nativeServerMainPath = 'src/server-main.js';
const patch = [
  'diff --git a/' + clientPath + ' b/' + clientPath,
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/' + clientPath,
  '@@ -0,0 +1 @@',
  '+installed-client',
  'diff --git a/' + serverPath + ' b/' + serverPath,
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/' + serverPath,
  '@@ -0,0 +1 @@',
  '+installed-server',
  'diff --git a/' + nativeStartupPath + ' b/' + nativeStartupPath,
  '--- a/' + nativeStartupPath,
  '+++ b/' + nativeStartupPath,
  '@@ -1 +1 @@',
  '-original-startup',
  '+patched-startup',
  'diff --git a/' + nativeServerMainPath + ' b/' + nativeServerMainPath,
  '--- a/' + nativeServerMainPath,
  '+++ b/' + nativeServerMainPath,
  '@@ -1 +1 @@',
  '-original-main',
  '+patched-main',
  '',
].join('\n');

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'le-st-patch-manager-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const st = join(root, 'SillyTavern');
  const packageDir = join(root, 'package');
  mkdirSync(st);
  mkdirSync(packageDir);
  git(st, ['init', '-q']);
  git(st, ['config', 'user.email', 'test@example.invalid']);
  git(st, ['config', 'user.name', 'Patch Manager Test']);
  writeFileSync(join(st, 'config.yaml'), 'unchanged\n');
  mkdirSync(join(st, 'src'));
  writeFileSync(join(st, nativeStartupPath), 'original-startup\n');
  writeFileSync(join(st, nativeServerMainPath), 'original-main\n');
  git(st, ['add', 'config.yaml', nativeStartupPath, nativeServerMainPath]);
  git(st, ['commit', '-qm', 'base']);
  const targetCommit = git(st, ['rev-parse', 'HEAD']);
  writeFileSync(join(packageDir, 'integration.patch'), patch);
  const patchBytes = readFileSync(join(packageDir, 'integration.patch'));
  const manifest = {
    schema_version: 1,
    package_id: 'logic-engine.st-test',
    target_git_commit: targetCommit,
    target_paths: [clientPath, serverPath, nativeStartupPath, nativeServerMainPath],
    patches: [{ path: 'integration.patch', size: patchBytes.length, sha256: hash(patchBytes) }],
  };
  const manifestPath = join(packageDir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return { root, st, packageDir, manifestPath, targetCommit };
}

test('Patch Manager installs only the integrated Extension package, is idempotent, and restores exact files', t => {
  const f = fixture(t);
  const applied = installSillyTavernPatchPackage({ stPath: f.st, manifestPath: f.manifestPath });
  assert.equal(applied.status, 'APPLIED');
  assert.equal(readFileSync(join(f.st, clientPath), 'utf8'), 'installed-client\n');
  assert.equal(readFileSync(join(f.st, serverPath), 'utf8'), 'installed-server\n');
  assert.equal(readFileSync(join(f.st, nativeStartupPath), 'utf8'), 'patched-startup\n');
  assert.equal(readFileSync(join(f.st, nativeServerMainPath), 'utf8'), 'patched-main\n');
  assert.equal(readFileSync(join(f.st, 'config.yaml'), 'utf8'), 'unchanged\n');
  assert.equal(installSillyTavernPatchPackage({ stPath: f.st, manifestPath: f.manifestPath }).status, 'ALREADY_APPLIED');
  assert.equal(uninstallSillyTavernPatchPackage({ stPath: f.st, packageId: 'logic-engine.st-test' }).status, 'ROLLED_BACK');
  assert.equal(exists(join(f.st, clientPath)), false);
  assert.equal(exists(join(f.st, serverPath)), false);
  assert.equal(readFileSync(join(f.st, nativeStartupPath), 'utf8'), 'original-startup\n');
  assert.equal(readFileSync(join(f.st, nativeServerMainPath), 'utf8'), 'original-main\n');
  assert.equal(inspectSillyTavernPatchTarget(f.st).clean, true);
});

function exists(path) {
  try { readFileSync(path); return true; } catch { return false; }
}

test('Patch Manager refuses unrelated dirty worktrees without touching user files', t => {
  const f = fixture(t);
  writeFileSync(join(f.st, 'config.yaml'), 'user edit\n');
  assert.throws(() => installSillyTavernPatchPackage({ stPath: f.st, manifestPath: f.manifestPath }), /dirty SillyTavern worktree/);
  assert.equal(readFileSync(join(f.st, 'config.yaml'), 'utf8'), 'user edit\n');
});

test('Patch Manager rejects wrong ST commit and modified Extension package artifacts', t => {
  const f = fixture(t);
  writeFileSync(join(f.st, 'other.txt'), 'change\n');
  git(f.st, ['add', 'other.txt']);
  git(f.st, ['commit', '-qm', 'other target']);
  assert.throws(() => installSillyTavernPatchPackage({ stPath: f.st, manifestPath: f.manifestPath }), /exact target commit/);

  const g = fixture(t);
  writeFileSync(join(g.packageDir, 'integration.patch'), patch + '#tampered\n');
  assert.throws(() => installSillyTavernPatchPackage({ stPath: g.st, manifestPath: g.manifestPath }), /integrity check failed/);
});

test('Patch Manager rejects undeclared or out-of-policy paths, including config and unrelated extensions', t => {
  const f = fixture(t);
  const forbiddenPaths = [
    'plugins/logic-engine-extension-gateway/server-plugin/index.mjs',
    'src/server.js',
    'src/endpoints/arbitrary.js',
    'src/plugin-loader.js',
    'public/script.js',
    'config.yaml',
    'public/scripts/extensions/third-party/other-extension/index.js',
    'public/scripts/extensions/third-party/logic-engine-extension-gateway/../../../../../src/server-startup.js',
  ];
  for (const forbiddenPath of forbiddenPaths) {
    const badPatch = [
      'diff --git a/' + forbiddenPath + ' b/' + forbiddenPath,
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/' + forbiddenPath,
      '@@ -0,0 +1 @@',
      '+must-not-install',
      '',
    ].join('\n');
    writeFileSync(join(f.packageDir, 'integration.patch'), badPatch);
    const bytes = readFileSync(join(f.packageDir, 'integration.patch'));
    writeFileSync(f.manifestPath, JSON.stringify({
      schema_version: 1,
      package_id: 'logic-engine.st-test',
      target_git_commit: f.targetCommit,
      target_paths: [forbiddenPath],
      patches: [{ path: 'integration.patch', size: bytes.length, sha256: hash(bytes) }],
    }));
    assert.throws(
      () => installSillyTavernPatchPackage({ stPath: f.st, manifestPath: f.manifestPath }),
      /Patch Manager allowlist/,
      forbiddenPath,
    );
  }
  assert.equal(readFileSync(join(f.st, 'config.yaml'), 'utf8'), 'unchanged\n');
});

test('Patch Manager requires every allowlisted native source target to be explicitly declared', t => {
  const f = fixture(t);
  const nativeStartupPath = 'src/endpoints/backends/chat-completions.js';
  const nativePatch = [
    'diff --git a/' + nativeStartupPath + ' b/' + nativeStartupPath,
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/' + nativeStartupPath,
    '@@ -0,0 +1 @@',
    '+must-be-declared',
    '',
  ].join('\n');
  writeFileSync(join(f.packageDir, 'integration.patch'), nativePatch);
  const bytes = readFileSync(join(f.packageDir, 'integration.patch'));
  writeFileSync(f.manifestPath, JSON.stringify({
    schema_version: 1,
    package_id: 'logic-engine.st-test',
    target_git_commit: f.targetCommit,
    target_paths: [clientPath, serverPath],
    patches: [{ path: 'integration.patch', size: bytes.length, sha256: hash(bytes) }],
  }));
  assert.throws(
    () => installSillyTavernPatchPackage({ stPath: f.st, manifestPath: f.manifestPath }),
    /not an explicitly declared path/,
  );
  assert.equal(exists(join(f.st, nativeStartupPath)), false);
});

test('recovery restores pre-transaction state from a durable APPLYING journal', t => {
  const f = fixture(t);
  const applied = installSillyTavernPatchPackage({ stPath: f.st, manifestPath: f.manifestPath });
  assert.equal(applied.status, 'APPLIED');
  const gitDir = git(f.st, ['rev-parse', '--git-path', 'logic-engine-patch-manager']);
  const journalPath = join(f.st, gitDir, 'transaction.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
  journal.state = 'APPLYING';
  writeFileSync(journalPath, JSON.stringify(journal));
  assert.equal(recoverSillyTavernPatchTransaction(f.st).status, 'RECOVERED_ROLLBACK');
  assert.equal(exists(join(f.st, clientPath)), false);
  assert.equal(exists(join(f.st, serverPath)), false);
  assert.equal(inspectSillyTavernPatchTarget(f.st).clean, true);
});

test('Patch Manager rejects non-Git directories and malformed manifests', t => {
  const root = mkdtempSync(join(tmpdir(), 'le-st-not-git-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.throws(() => inspectSillyTavernPatchTarget(root));
  const f = fixture(t);
  writeFileSync(f.manifestPath, JSON.stringify({ schema_version: 1, package_id: 'bad', patches: [] }));
  assert.throws(() => installSillyTavernPatchPackage({ stPath: f.st, manifestPath: f.manifestPath }), /schema or target identity/);
});

test('uninstall refuses to overwrite edits made after Extension package installation', t => {
  const f = fixture(t);
  installSillyTavernPatchPackage({ stPath: f.st, manifestPath: f.manifestPath });
  writeFileSync(join(f.st, clientPath), 'user edit after install\n');
  assert.throws(() => uninstallSillyTavernPatchPackage({ stPath: f.st, packageId: 'logic-engine.st-test' }), /refusing to overwrite user changes/);
  assert.equal(readFileSync(join(f.st, clientPath), 'utf8'), 'user edit after install\n');
  assert.equal(inspectSillyTavernPatchTarget(f.st).patchManagerJournal.state, 'APPLIED');
});


const nativePath = 'src/server-startup.js';

function nativeFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'le-st-native-patch-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const st = join(root, 'SillyTavern');
  const packageDir = join(root, 'package');
  mkdirSync(join(st, 'src'), { recursive: true });
  mkdirSync(packageDir);
  git(st, ['init', '-q']);
  git(st, ['config', 'user.email', 'test@example.invalid']);
  git(st, ['config', 'user.name', 'Patch Manager Test']);
  writeFileSync(join(st, nativePath), 'export const startup = "original";\n');
  git(st, ['add', nativePath]);
  git(st, ['commit', '-qm', 'base']);
  const targetCommit = git(st, ['rev-parse', 'HEAD']);
  const nativePatch = [
    'diff --git a/' + nativePath + ' b/' + nativePath,
    'index 1111111..2222222 100644',
    '--- a/' + nativePath,
    '+++ b/' + nativePath,
    '@@ -1 +1 @@',
    '-export const startup = "original";',
    '+export const startup = "patched";',
    '',
  ].join('\n');
  writeFileSync(join(packageDir, 'native.patch'), nativePatch);
  const bytes = readFileSync(join(packageDir, 'native.patch'));
  const manifestPath = join(packageDir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify({
    schema_version: 1,
    package_id: 'logic-engine.native-test',
    target_git_commit: targetCommit,
    target_paths: [nativePath],
    patches: [{ path: 'native.patch', size: bytes.length, sha256: hash(bytes) }],
  }));
  return { st, manifestPath };
}

test('Patch Manager accepts an exact manifest-declared native ST source path and rolls it back', t => {
  const f = nativeFixture(t);
  assert.deepEqual(
    installSillyTavernPatchPackage({ stPath: f.st, manifestPath: f.manifestPath }).affected_files,
    [nativePath],
  );
  assert.equal(readFileSync(join(f.st, nativePath), 'utf8'), 'export const startup = "patched";\n');
  assert.equal(
    installSillyTavernPatchPackage({ stPath: f.st, manifestPath: f.manifestPath }).status,
    'ALREADY_APPLIED',
  );
  assert.equal(
    uninstallSillyTavernPatchPackage({ stPath: f.st, packageId: 'logic-engine.native-test' }).status,
    'ROLLED_BACK',
  );
  assert.equal(readFileSync(join(f.st, nativePath), 'utf8'), 'export const startup = "original";\n');
  assert.equal(inspectSillyTavernPatchTarget(f.st).clean, true);
});

test('Patch Manager recovers an interrupted native-source transaction without widening its journal scope', t => {
  const f = nativeFixture(t);
  installSillyTavernPatchPackage({ stPath: f.st, manifestPath: f.manifestPath });
  const gitDir = git(f.st, ['rev-parse', '--git-path', 'logic-engine-patch-manager']);
  const journalPath = join(f.st, gitDir, 'transaction.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
  assert.deepEqual(journal.target_paths, [nativePath]);
  journal.state = 'APPLYING';
  writeFileSync(journalPath, JSON.stringify(journal));
  assert.equal(recoverSillyTavernPatchTransaction(f.st).status, 'RECOVERED_ROLLBACK');
  assert.equal(readFileSync(join(f.st, nativePath), 'utf8'), 'export const startup = "original";\n');
  assert.equal(inspectSillyTavernPatchTarget(f.st).clean, true);
});
