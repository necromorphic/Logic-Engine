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

const hash = (value) => createHash('sha256').update(value).digest('hex');
const patch = [
  'diff --git a/config.yaml b/config.yaml',
  'index 1111111..2222222 100644',
  '--- a/config.yaml',
  '+++ b/config.yaml',
  '@@ -1 +1 @@',
  '-before',
  '+after',
  'diff --git a/logic-engine-added.txt b/logic-engine-added.txt',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/logic-engine-added.txt',
  '@@ -0,0 +1 @@',
  '+installed',
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
  writeFileSync(join(st, 'config.yaml'), 'before\n');
  git(st, ['add', 'config.yaml']);
  git(st, ['commit', '-qm', 'base']);
  const targetCommit = git(st, ['rev-parse', 'HEAD']);
  writeFileSync(join(packageDir, 'integration.patch'), patch);
  const patchBytes = readFileSync(join(packageDir, 'integration.patch'));
  const manifest = {
    schema_version: 1,
    package_id: 'logic-engine.st-test',
    target_git_commit: targetCommit,
    patches: [{ path: 'integration.patch', size: patchBytes.length, sha256: hash(patchBytes) }],
  };
  const manifestPath = join(packageDir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return { root, st, packageDir, manifestPath, targetCommit };
}

test('Patch Manager applies verified package, is idempotent, and restores exact files', (t) => {
  const f = fixture(t);
  const applied = installSillyTavernPatchPackage({ stPath: f.st, manifestPath: f.manifestPath });
  assert.equal(applied.status, 'APPLIED');
  assert.equal(readFileSync(join(f.st, 'config.yaml'), 'utf8'), 'after\n');
  assert.equal(readFileSync(join(f.st, 'logic-engine-added.txt'), 'utf8'), 'installed\n');
  assert.equal(installSillyTavernPatchPackage({ stPath: f.st, manifestPath: f.manifestPath }).status, 'ALREADY_APPLIED');
  assert.equal(uninstallSillyTavernPatchPackage({ stPath: f.st, packageId: 'logic-engine.st-test' }).status, 'ROLLED_BACK');
  assert.equal(readFileSync(join(f.st, 'config.yaml'), 'utf8'), 'before\n');
  assert.equal(false, (() => { try { readFileSync(join(f.st, 'logic-engine-added.txt')); return true; } catch { return false; } })());
  assert.equal(inspectSillyTavernPatchTarget(f.st).clean, true);
});

test('Patch Manager refuses dirty worktrees without touching user files', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.st, 'config.yaml'), 'user edit\n');
  assert.throws(() => installSillyTavernPatchPackage({ stPath: f.st, manifestPath: f.manifestPath }), /dirty SillyTavern worktree/);
  assert.equal(readFileSync(join(f.st, 'config.yaml'), 'utf8'), 'user edit\n');
});

test('Patch Manager rejects wrong ST commit and modified patch artifacts', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.st, 'other.txt'), 'change\n');
  git(f.st, ['add', 'other.txt']);
  git(f.st, ['commit', '-qm', 'other target']);
  assert.throws(() => installSillyTavernPatchPackage({ stPath: f.st, manifestPath: f.manifestPath }), /exact target commit/);

  const g = fixture(t);
  writeFileSync(join(g.packageDir, 'integration.patch'), patch + '#tampered\n');
  assert.throws(() => installSillyTavernPatchPackage({ stPath: g.st, manifestPath: g.manifestPath }), /integrity check failed/);
});

test('recovery restores pre-transaction files from a durable APPLYING journal', (t) => {
  const f = fixture(t);
  const applied = installSillyTavernPatchPackage({ stPath: f.st, manifestPath: f.manifestPath });
  assert.equal(applied.status, 'APPLIED');
  const gitDir = git(f.st, ['rev-parse', '--git-path', 'logic-engine-patch-manager']);
  const journalPath = join(f.st, gitDir, 'transaction.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
  journal.state = 'APPLYING';
  writeFileSync(journalPath, JSON.stringify(journal));
  assert.equal(recoverSillyTavernPatchTransaction(f.st).status, 'RECOVERED_ROLLBACK');
  assert.equal(readFileSync(join(f.st, 'config.yaml'), 'utf8'), 'before\n');
  assert.equal(inspectSillyTavernPatchTarget(f.st).clean, true);
});

test('Patch Manager rejects non-Git directories and malformed manifests', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'le-st-not-git-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.throws(() => inspectSillyTavernPatchTarget(root));
  const f = fixture(t);
  writeFileSync(f.manifestPath, JSON.stringify({ schema_version: 1, package_id: 'bad', patches: [] }));
  assert.throws(() => installSillyTavernPatchPackage({ stPath: f.st, manifestPath: f.manifestPath }), /schema or target identity/);
});
