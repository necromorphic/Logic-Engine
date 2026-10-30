import test from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, fstatSync, lstatSync, mkdtempSync, openSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('opened descriptor identity matches path snapshots on the current Node runtime', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-file-identity-probe-'));
  const path = join(directory, 'approved-import.json');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(path, '{"identity":"probe"}');

  const before = lstatSync(path, { bigint: true });
  const beforeIdentity = statSync(path, { bigint: true });
  const resolvedBefore = realpathSync(path);
  const fd = openSync(path, 0);
  try {
    const opened = fstatSync(fd, { bigint: true });
    const after = lstatSync(path, { bigint: true });
    const afterIdentity = statSync(path, { bigint: true });
    const resolvedAfter = realpathSync(path);
    const snapshot = {
      before: { dev: String(before.dev), ino: String(before.ino), file: before.isFile(), link: before.isSymbolicLink() },
      beforeIdentity: { dev: String(beforeIdentity.dev), ino: String(beforeIdentity.ino), file: beforeIdentity.isFile() },
      opened: { dev: String(opened.dev), ino: String(opened.ino), file: opened.isFile() },
      after: { dev: String(after.dev), ino: String(after.ino), file: after.isFile(), link: after.isSymbolicLink() },
      afterIdentity: { dev: String(afterIdentity.dev), ino: String(afterIdentity.ino), file: afterIdentity.isFile() },
      resolvedBefore,
      resolvedAfter,
      configured: resolve(path),
    };
    console.log('FILE_IDENTITY_PROBE ' + JSON.stringify(snapshot));
    assert.equal(opened.isFile(), true);
    assert.equal(before.isFile(), true);
    assert.equal(after.isFile(), true);
    assert.equal(after.isSymbolicLink(), false);
    assert.equal(resolve(resolvedBefore), resolve(resolvedAfter));
    assert.equal(before.ino, beforeIdentity.ino, 'lstat and stat must identify the same path object');
    assert.equal(after.ino, afterIdentity.ino, 'post-open lstat and stat must identify the same path object');
    assert.equal(opened.dev, beforeIdentity.dev, 'opened descriptor volume must match pre-open stat');
    assert.equal(opened.ino, beforeIdentity.ino, 'opened descriptor file ID must match pre-open stat');
    assert.equal(opened.dev, afterIdentity.dev, 'opened descriptor volume must match post-open stat');
    assert.equal(opened.ino, afterIdentity.ino, 'opened descriptor file ID must match post-open stat');
  } finally {
    closeSync(fd);
  }
});
