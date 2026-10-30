import test from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, fstatSync, lstatSync, mkdtempSync, openSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('opened descriptor identity matches path snapshots on the current Node runtime', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-file-identity-probe-'));
  const path = join(directory, 'approved-import.json');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(path, '{"identity":"probe"}');

  const before = lstatSync(path, { bigint: true });
  const resolvedBefore = realpathSync(path);
  const fd = openSync(path, 0);
  let identityFd;
  try {
    const opened = fstatSync(fd, { bigint: true });
    const after = lstatSync(path, { bigint: true });
    const resolvedAfter = realpathSync(path);
    identityFd = openSync(path, 0);
    const reopened = fstatSync(identityFd, { bigint: true });
    const finalPath = lstatSync(path, { bigint: true });
    const resolvedFinal = realpathSync(path);
    const snapshot = {
      before: { dev: String(before.dev), ino: String(before.ino), file: before.isFile(), link: before.isSymbolicLink() },
      opened: { dev: String(opened.dev), ino: String(opened.ino), file: opened.isFile() },
      reopened: { dev: String(reopened.dev), ino: String(reopened.ino), file: reopened.isFile() },
      after: { dev: String(after.dev), ino: String(after.ino), file: after.isFile(), link: after.isSymbolicLink() },
      finalPath: { dev: String(finalPath.dev), ino: String(finalPath.ino), file: finalPath.isFile(), link: finalPath.isSymbolicLink() },
      resolvedBefore,
      resolvedAfter,
      resolvedFinal,
      configured: resolve(path),
    };
    console.log('FILE_IDENTITY_PROBE ' + JSON.stringify(snapshot));
    assert.equal(opened.isFile(), true);
    assert.equal(before.isFile(), true);
    assert.equal(after.isFile(), true);
    assert.equal(after.isSymbolicLink(), false);
    assert.equal(finalPath.isFile(), true);
    assert.equal(finalPath.isSymbolicLink(), false);
    assert.equal(resolve(resolvedBefore), resolve(resolvedAfter));
    assert.equal(resolve(resolvedBefore), resolve(resolvedFinal));
    assert.equal(opened.ino, before.ino, 'opened descriptor file ID must match pre-open lstat');
    assert.equal(opened.ino, after.ino, 'opened descriptor file ID must match post-open lstat');
    assert.equal(opened.ino, finalPath.ino, 'opened descriptor file ID must match final lstat');
    assert.equal(opened.dev, reopened.dev, 'independent opens must resolve to the same volume');
    assert.equal(opened.ino, reopened.ino, 'independent opens must resolve to the same file ID');
  } finally {
    if (identityFd !== undefined) closeSync(identityFd);
    closeSync(fd);
  }
});
