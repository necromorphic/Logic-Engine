import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { withWindowsVssSnapshot } from '../windows-vss-snapshot.mjs';
import { isVerifiedFileInventory } from '../fs-inventory.js';
import {
  enumerateStableFileInventory,
  enumerateStableFileInventoryFromWindowsSnapshot,
} from '../fs-inventory.js';

async function withTempRoot(run) {
  const parent = await mkdtemp(join(tmpdir(), 'logic-engine-vss-inventory-'));
  const root = join(parent, 'data');
  await mkdir(root);
  try { await run({ parent, root }); }
  finally { await rm(parent, { recursive: true, force: true }); }
}

test('Windows VSS inventory is a complete point-in-time snapshot with reparse audit metadata', {
  skip: process.platform !== 'win32',
  timeout: 180_000,
}, async () => {
  await withTempRoot(async ({ root }) => {
    await writeFile(join(root, 'chat.jsonl'), 'snapshot bytes');
    await writeFile(join(root, 'settings.json'), '{}');
    const result = await enumerateStableFileInventory(resolve(root));
    assert.equal(result.status, 'complete', JSON.stringify(result));
    assert.equal(result.snapshot_provider, 'windows-vss-client-accessible');
    assert.equal(result.snapshot_consistency, 'VSS_POINT_IN_TIME_READ_ONLY');
    assert.equal(result.reparse_points, 'ALL_FILE_ATTRIBUTE_REPARSE_POINT_ENTRIES_REJECTED');
    assert.equal(result.file_count, 2);
    assert.equal(isVerifiedFileInventory(result), true);
    assert.equal(isVerifiedFileInventory({ ...result }), false);
    assert.equal(Object.isFrozen(result.entries), true);
    assert.equal(result.entries.every(entry => Object.isFrozen(entry) && Object.isFrozen(entry.identity)), true);
    assert.equal(result.entries.every(entry => entry.identity.ino !== '0'), true);
    assert.equal(result.entries.every(entry => entry.sha256.length === 64), true);
  });
});

test('concurrent VSS inventory requests wait out the provider busy state', {
  skip: process.platform !== 'win32',
  timeout: 240_000,
}, async () => {
  await withTempRoot(async ({ root }) => {
    await writeFile(join(root, 'chat.jsonl'), 'concurrent snapshot input');
    const results = await Promise.all([
      enumerateStableFileInventory(resolve(root)),
      enumerateStableFileInventory(resolve(root)),
    ]);
    assert.equal(results.every(result => result.status === 'complete'), true, JSON.stringify(results));
    assert.notEqual(results[0].snapshot_id, results[1].snapshot_id);
  });
});

test('VSS snapshot remains unchanged while the live source is concurrently modified', {
  skip: process.platform !== 'win32',
  timeout: 180_000,
}, async () => {
  await withTempRoot(async ({ root }) => {
    const file = join(root, 'chat.jsonl');
    await writeFile(file, 'before snapshot');
    await withWindowsVssSnapshot(root, async lease => {
      await writeFile(file, 'concurrent writer changed live source');
      const snapshot = await enumerateStableFileInventoryFromWindowsSnapshot(lease);
      assert.equal(snapshot.status, 'complete', JSON.stringify(snapshot));
      assert.equal(await readFile(join(lease.snapshotRoot, 'chat.jsonl'), 'utf8'), 'before snapshot');
      assert.equal(snapshot.entries[0].sha256.length, 64);
    });
    assert.equal(await readFile(file, 'utf8'), 'concurrent writer changed live source');
  });
});

test('VSS snapshots distinguish delete and same-byte restore as separate file generations', {
  skip: process.platform !== 'win32',
  timeout: 240_000,
}, async () => {
  await withTempRoot(async ({ parent, root }) => {
    const file = join(root, 'chat.jsonl');
    const backup = join(parent, 'backup.jsonl');
    await writeFile(file, 'same payload');
    const before = await enumerateStableFileInventory(resolve(root));
    await writeFile(backup, 'same payload');
    await rm(file);
    const deleted = await enumerateStableFileInventory(resolve(root));
    await writeFile(file, await readFile(backup));
    const restored = await enumerateStableFileInventory(resolve(root));
    assert.equal(before.status, 'complete', JSON.stringify(before));
    assert.equal(deleted.status, 'complete', JSON.stringify(deleted));
    assert.equal(restored.status, 'complete', JSON.stringify(restored));
    assert.notEqual(deleted.snapshot_sha256, before.snapshot_sha256);
    assert.notEqual(restored.snapshot_sha256, before.snapshot_sha256);
  });
});

test('VSS provider rejects a junction/reparse point before inventory is exposed', {
  skip: process.platform !== 'win32',
  timeout: 180_000,
}, async () => {
  await withTempRoot(async ({ parent, root }) => {
    const outside = join(parent, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'secret.txt'), 'must not be inventoried');
    await symlink(outside, join(root, 'junction'), 'junction');
    await assert.rejects(
      () => withWindowsVssSnapshot(root, async () => assert.fail('reparse tree must never reach scanner')),
      /HOST_VSS_REPARSE_POINT_PRESENT/,
    );
  });
});

test('VSS provider rejects a reparse-point ancestor of the configured data root', {
  skip: process.platform !== 'win32',
  timeout: 180_000,
}, async () => {
  await withTempRoot(async ({ parent }) => {
    const outside = join(parent, 'real-parent');
    const dataRoot = join(outside, 'data');
    const junction = join(parent, 'redirected-parent');
    await mkdir(dataRoot, { recursive: true });
    await writeFile(join(dataRoot, 'chat.jsonl'), 'must not be inventoried through an ancestor junction');
    await symlink(outside, junction, 'junction');
    await assert.rejects(
      () => withWindowsVssSnapshot(join(junction, 'data'), async () => assert.fail('reparse ancestor must never reach scanner')),
      /HOST_VSS_REPARSE_POINT_PRESENT/,
    );
  });
});

test('expired or fabricated VSS lease cannot be used by the Windows scanner', {
  skip: process.platform !== 'win32',
}, async () => {
  const result = await enumerateStableFileInventoryFromWindowsSnapshot({
    snapshotRoot: 'C:\\\\fake',
    root: 'C:\\\\fake',
    snapshotId: '00000000-0000-0000-0000-000000000000',
    provider: 'windows-vss-client-accessible',
    consistency: 'VSS_POINT_IN_TIME_READ_ONLY',
    reparsePoints: 'ALL_FILE_ATTRIBUTE_REPARSE_POINT_ENTRIES_REJECTED',
  });
  assert.deepEqual(result, {
    status: 'non_ready',
    code: 'HOST_INVENTORY_WINDOWS_SNAPSHOT_UNTRUSTED',
  });
});
