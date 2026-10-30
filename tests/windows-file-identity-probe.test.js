import test from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, fstatSync, lstatSync, mkdtempSync, openSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('Windows Node path stat omits volume identity while descriptor stat exposes it', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-file-identity-probe-'));
  const path = join(directory, 'approved-import.json');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(path, '{"identity":"probe"}');

  const before = lstatSync(path, { bigint: true });
  const resolvedBefore = realpathSync(path);
  const fd = openSync(path, 0);
  try {
    const opened = fstatSync(fd, { bigint: true });
    const after = lstatSync(path, { bigint: true });
    const resolvedAfter = realpathSync(path);
    const snapshot = {
      before: { dev: String(before.dev), ino: String(before.ino), file: before.isFile(), link: before.isSymbolicLink() },
      opened: { dev: String(opened.dev), ino: String(opened.ino), file: opened.isFile() },
      after: { dev: String(after.dev), ino: String(after.ino), file: after.isFile(), link: after.isSymbolicLink() },
      resolvedBefore,
      resolvedAfter,
      configured: resolve(path),
    };
    console.log('WINDOWS_FILE_IDENTITY_PROBE ' + JSON.stringify(snapshot));
    assert.equal(opened.isFile(), true);
    assert.equal(before.isFile(), true);
    assert.equal(after.isFile(), true);
    assert.equal(after.isSymbolicLink(), false);
    assert.equal(resolve(resolvedBefore), resolve(resolvedAfter));
    // On the pinned Windows Node runtime, path-based stat reports dev=0,
    // while descriptor-based fstat exposes the volume/device value. The file
    // index remains stable, but Node's path stat cannot supply the volume part
    // of a trusted Windows identity. Production anchoring must use FILE_ID_INFO.
    assert.equal(before.dev, 0n, 'path lstat must expose the known missing volume identity');
    assert.equal(after.dev, 0n, 'post-open path lstat must expose the known missing volume identity');
    assert.notEqual(opened.dev, 0n, 'descriptor fstat must expose a non-zero volume/device identity');
    assert.equal(opened.ino, before.ino, 'opened descriptor file index must match pre-open path');
    assert.equal(opened.ino, after.ino, 'opened descriptor file index must match post-open path');
  } finally {
    closeSync(fd);
  }
});
