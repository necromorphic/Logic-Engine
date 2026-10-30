import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
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

test('enumerates regular files recursively with deterministic digest and no content', async () => {
  await withTempRoot(async ({ root }) => {
    await mkdir(join(root, 'chats'));
    await writeFile(join(root, 'chats', 'a.jsonl'), '{"role":"user","content":"secret"}\n');
    await writeFile(join(root, 'settings.json'), '{}');
    const result = await enumerateStableFileInventory(resolve(root));
    assert.equal(result.status, 'complete');
    assert.equal(result.file_count, 2);
    assert.deepEqual(result.entries.map((entry) => entry.path), ['chats/a.jsonl', 'settings.json']);
    assert.match(result.snapshot_sha256, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(result).includes('secret'), false);
    assert.equal((await enumerateStableFileInventory(resolve(root))).snapshot_sha256, result.snapshot_sha256);
  });
});

test('rejects relative and unavailable roots', async () => {
  assert.deepEqual(await enumerateStableFileInventory('relative/path'), {
    status: 'non_ready', code: 'HOST_INVENTORY_ROOT_INVALID'
  });
  assert.deepEqual(await enumerateStableFileInventory(join(tmpdir(), 'missing-host-inventory-root')), {
    status: 'non_ready', code: 'HOST_INVENTORY_ROOT_UNAVAILABLE'
  });
});

test('rejects symlink entries instead of following them outside the root', async () => {
  await withTempRoot(async ({ parent, root }) => {
    const outside = join(parent, 'outside.txt');
    await writeFile(outside, 'outside');
    await symlink(outside, join(root, 'escape.txt'));
    const result = await enumerateStableFileInventory(resolve(root));
    assert.deepEqual(result, { status: 'non_ready', code: 'HOST_INVENTORY_SYMLINK_UNSUPPORTED' });
  });
});

test('rejects a symlink as the configured root', async () => {
  await withTempRoot(async ({ parent, root }) => {
    const link = join(parent, 'root-link');
    await symlink(root, link, 'dir');
    const result = await enumerateStableFileInventory(resolve(link));
    assert.deepEqual(result, { status: 'non_ready', code: 'HOST_INVENTORY_ROOT_UNSAFE' });
  });
});

test('digest changes after an out-of-band file edit', async () => {
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

test('rejects non-regular filesystem entries', async () => {
  await withTempRoot(async ({ root }) => {
    await mkdir(join(root, 'nested'));
    const result = await enumerateStableFileInventory(resolve(root));
    assert.equal(result.status, 'complete');
    assert.equal(result.file_count, 0);
  });
});
