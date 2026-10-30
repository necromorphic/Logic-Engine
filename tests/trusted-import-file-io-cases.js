import test from 'node:test';
import assert from 'node:assert/strict';
import {
  closeSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_TRUSTED_IMPORT_BYTES,
  readBoundedFileDescriptor,
} from '../src/application/trusted-import-file.js';

test('trusted import descriptor reads at most the configured limit plus one byte', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-trusted-import-bounded-read-'));
  const path = join(directory, 'source.json');
  const bytes = Buffer.alloc(MAX_TRUSTED_IMPORT_BYTES + 2, 0x41);
  bytes[MAX_TRUSTED_IMPORT_BYTES + 1] = 0x42;
  writeFileSync(path, bytes);
  const fd = openSync(path, 'r');

  t.after(() => {
    closeSync(fd);
    rmSync(directory, { recursive: true, force: true });
  });

  assert.throws(
    () => readBoundedFileDescriptor(fd),
    { code: 'INVALID_TRUSTED_IMPORT_FILE' },
  );

  // The helper must stop immediately after the first byte beyond the limit.
  const nextByte = Buffer.alloc(1);
  assert.equal(readSync(fd, nextByte, 0, 1, null), 1);
  assert.equal(nextByte[0], 0x42);
});

test('trusted import FIFO open is non-blocking before regular-file validation', {
  skip: process.platform !== 'linux',
}, (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-trusted-import-fifo-'));
  const fifoPath = join(directory, 'source.fifo');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  execFileSync('mkfifo', [fifoPath]);

  const script = `
    import { openTrustedImportDescriptor } from './src/application/trusted-import-file.js';
    import { closeSync, fstatSync } from 'node:fs';
    const fd = openTrustedImportDescriptor(process.argv[1]);
    try {
      if (fstatSync(fd).isFile()) process.exitCode = 2;
    } finally {
      closeSync(fd);
    }
  `;
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', script, fifoPath],
    { cwd: process.cwd(), encoding: 'utf8', timeout: 3000 },
  );

  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
