import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expectedProductionSQLiteModules = new Set([
  'src/application/host-version-digest-ledger.js',
  'src/application/sqlite-memory-provider.js',
  'src/security/accepted-head-authority.js',
  'src/security/enroll-accepted-head-domain.js',
  'src/security/memory-dispatch-gateway.js',
  'src/security/recover-accepted-head-domain.js',
  'src/storage/coordinator-lock.js',
  'src/storage/sqlite-store.js',
]);

async function collectJavaScriptFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectJavaScriptFiles(path.join(directory, entry.name), relative));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(relative);
    }
  }
  return files;
}

test('production node:sqlite DatabaseSync opens remain explicitly inventoried', async () => {
  const sourceFiles = await collectJavaScriptFiles(path.join(repositoryRoot, 'src'));
  const actual = new Set();

  for (const relative of sourceFiles) {
    const source = await readFile(path.join(repositoryRoot, relative), 'utf8');
    if (/from\s+['"]node:sqlite['"]/.test(source)
      && /\bnew\s+DatabaseSync\s*\(/.test(source)) {
      actual.add(relative);
    }
  }

  assert.deepEqual(
    [...actual].sort(),
    [...expectedProductionSQLiteModules].sort(),
    'A production SQLite open was added, removed, or moved; update the Issue #770 role inventory and secure-open coverage before merge.',
  );
});
