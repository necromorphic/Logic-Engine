import test from 'node:test';
import assert from 'node:assert/strict';
import { link, mkdtemp, mkdir, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { enumerateStableFileInventory } from '../fs-inventory.js';

async function withTempRoot(run) {
  const parent = await mkdtemp(join(tmpdir(), 'logic-engine-host-inventory-'));
  const root = join(parent, 'data');
  await mkdir(root);
  try { await run({ parent, root }); }
  finally { await rm(parent, { recursive: true, force: true }); }
}

test('enumerates regular files recursively with deterministic digest and no content', { skip: process.platform === 'win32' }, async () => {
  await withTempRoot(async ({ root }) => {
    await mkdir(join(root, 'chats'));
    await writeFile(join(root, 'chats', 'a.jsonl'), '{"role":"user","content":"secret"}\n');
    await writeFile(join(root, 'settings.json'), '{}');
    const result = await enumerateStableFileInventory(resolve(root));
    assert.equal(result.status, 'complete');
    assert.equal(result.file_count, 2);
    assert.deepEqual(result.entries.map((entry) => entry.path), ['chats/a.jsonl', 'settings.json']);
    assert.match(result.snapshot_sha256, /^[a-f0-9]{64}$/);
    assert.equal(typeof result.entries[0].identity.ctimeMs, 'number');
    assert.equal(JSON.stringify(result).includes('secret'), false);
    assert.equal((await enumerateStableFileInventory(resolve(root))).snapshot_sha256, result.snapshot_sha256);
  });
});

test('rejects relative and unavailable roots', async () => {
  assert.deepEqual(await enumerateStableFileInventory('relative/path'), {
    status: 'non_ready', code: 'HOST_INVENTORY_ROOT_INVALID'
  });
  const unavailable = await enumerateStableFileInventory(join(tmpdir(), 'missing-host-inventory-root'));
  assert.equal(unavailable.status, 'non_ready');
  assert.match(unavailable.code, /^HOST_(INVENTORY_ROOT_UNAVAILABLE|VSS|INVENTORY_WINDOWS)_/);
});

test('rejects symlink entries instead of following them outside the root', { skip: process.platform === 'win32' }, async () => {
  await withTempRoot(async ({ parent, root }) => {
    const outside = join(parent, 'outside.txt');
    await writeFile(outside, 'outside');
    await symlink(outside, join(root, 'escape.txt'));
    const result = await enumerateStableFileInventory(resolve(root));
    assert.deepEqual(result, { status: 'non_ready', code: 'HOST_INVENTORY_SYMLINK_UNSUPPORTED' });
  });
});

test('rejects a symlink as the configured root', { skip: process.platform === 'win32' }, async () => {
  await withTempRoot(async ({ parent, root }) => {
    const link = join(parent, 'root-link');
    await symlink(root, link, 'dir');
    const result = await enumerateStableFileInventory(resolve(link));
    assert.deepEqual(result, { status: 'non_ready', code: 'HOST_INVENTORY_ROOT_UNSAFE' });
  });
});

test('digest changes after an out-of-band file edit', { skip: process.platform === 'win32' }, async () => {
  await withTempRoot(async ({ root }) => {
    const file = join(root, 'chat.jsonl');
    await writeFile(file, 'before');
    const before = await enumerateStableFileInventory(resolve(root));
    await writeFile(file, 'after!');
    const after = await enumerateStableFileInventory(resolve(root));
    assert.equal(before.status, 'complete');
    assert.equal(after.status, 'complete');
    assert.notEqual(after.snapshot_sha256, before.snapshot_sha256);
    assert.notEqual(after.entries[0].sha256, before.entries[0].sha256);
  });
});

test('rejects non-regular filesystem entries', { skip: process.platform === 'win32' }, async () => {
  await withTempRoot(async ({ root }) => {
    await mkdir(join(root, 'nested'));
    const result = await enumerateStableFileInventory(resolve(root));
    assert.equal(result.status, 'complete');
    assert.equal(result.file_count, 0);
  });
});


test('delete and same-byte restore are distinct filesystem generations', { skip: process.platform === 'win32' }, async () => {
  await withTempRoot(async ({ root }) => {
    const file = join(root, 'chat.jsonl');
    const backup = join(root, '..', 'backup.tmp');
    await writeFile(file, 'same bytes');
    const before = await enumerateStableFileInventory(resolve(root));
    await writeFile(backup, 'same bytes');
    await rm(file);
    const deleted = await enumerateStableFileInventory(resolve(root));
    await writeFile(file, await readFile(backup));
    const restored = await enumerateStableFileInventory(resolve(root));
    assert.equal(before.status, 'complete');
    assert.equal(deleted.status, 'complete');
    assert.equal(restored.status, 'complete');
    assert.notEqual(deleted.snapshot_sha256, before.snapshot_sha256);
    assert.notEqual(restored.snapshot_sha256, before.snapshot_sha256);
  });
});

test('rejects hard-linked duplicate file identities', { skip: process.platform === 'win32' }, async () => {
  await withTempRoot(async ({ root }) => {
    const first = join(root, 'one.jsonl');
    const second = join(root, 'two.jsonl');
    await writeFile(first, 'same inode');
    await link(first, second);
    assert.deepEqual(await enumerateStableFileInventory(resolve(root)), {
      status: 'non_ready', code: 'HOST_INVENTORY_DUPLICATE_FILE_IDENTITY'
    });
  });
});


test('Windows inventory fails closed when the VSS snapshot provider is unavailable', { skip: process.platform !== 'win32' }, async () => {
  await withTempRoot(async ({ root }) => {
    const result = await enumerateStableFileInventory(resolve(root));
    if (result.status === 'complete') {
      assert.equal(result.snapshot_provider, 'windows-vss-client-accessible');
      assert.equal(result.snapshot_consistency, 'VSS_POINT_IN_TIME_READ_ONLY');
    } else {
      assert.match(result.code, /^HOST_(VSS|INVENTORY_WINDOWS|INVENTORY_ROOT_UNAVAILABLE)_/);
    }
  });
});


test('rejects oversized files before unbounded reads', { skip: process.platform === 'win32' }, async () => {
  await withTempRoot(async ({ root }) => {
    const file = join(root, 'oversized.jsonl');
    await writeFile(file, '');
    await truncate(file, 256 * 1024 * 1024 + 1);
    assert.deepEqual(await enumerateStableFileInventory(resolve(root)), {
      status: 'non_ready',
      code: 'HOST_INVENTORY_FILE_SIZE_LIMIT',
    });
  });
});
