import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { test } from 'node:test';

import { assertVectorServiceDatabasePath } from '../integrations/st-vectorservice/database-path-contract.mjs';

test('ST-VectorService VFS role path must equal server.js vectors.sqlite path', () => {
  const storageDirectory = path.resolve(path.sep, 'st-vector-root', 'vector_storage');
  const expected = path.join(storageDirectory, 'vectors.sqlite');

  assert.equal(assertVectorServiceDatabasePath(expected, storageDirectory), expected);
});

test('ST-VectorService VFS bootstrap rejects a different protected database path', () => {
  const storageDirectory = path.resolve(path.sep, 'st-vector-root', 'vector_storage');
  const wrongPath = path.join(storageDirectory, 'other.sqlite');

  assert.throws(
    () => assertVectorServiceDatabasePath(wrongPath, storageDirectory),
    /must exactly match ST-VectorService DB_PATH/,
  );
});

test('ST-VectorService VFS bootstrap rejects relative role paths', () => {
  assert.throws(
    () => assertVectorServiceDatabasePath('vector_storage/vectors.sqlite', path.resolve('vector_storage')),
    /must be the absolute Host-configured logical DB path/,
  );
});

test('ST-VectorService secure entrypoint is syntactically valid and imports bootstrap before server.js', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const integrationRoot = path.join(root, 'integrations', 'st-vectorservice');
  for (const filename of [
    'database-path-contract.mjs',
    'logic-engine-vfs-bootstrap.mjs',
    'secure-entrypoint.mjs',
    '../../tests/fixtures/secure-vfs-worker.cjs',
  ]) {
    const fullPath = path.join(integrationRoot, filename);
    const checked = spawnSync(process.execPath, ['--check', fullPath], { encoding: 'utf8' });
    assert.equal(checked.status, 0, `${filename} must parse: ${checked.stderr || checked.error || ''}`);
  }

  const entrypoint = fs.readFileSync(path.join(integrationRoot, 'secure-entrypoint.mjs'), 'utf8');
  const bootstrapImport = entrypoint.indexOf("from './logic-engine-vfs-bootstrap.mjs'");
  const serverImport = entrypoint.indexOf('await import(pathToFileURL(serverEntryPath).href)');
  assert.ok(bootstrapImport >= 0 && serverImport > bootstrapImport,
    'secure entrypoint must load the VFS bootstrap before importing server.js');
});
