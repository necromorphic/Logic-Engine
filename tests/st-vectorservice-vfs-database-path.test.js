import assert from 'node:assert/strict';
import path from 'node:path';
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
