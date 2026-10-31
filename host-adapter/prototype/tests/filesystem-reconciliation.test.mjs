import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto, createHash } from 'node:crypto';
import { HostLifecycleJournal } from '../lifecycle-journal.mjs';
import { reconcileFilesystemInventory } from '../filesystem-reconciliation.mjs';

globalThis.crypto ??= webcrypto;
globalThis.IDBKeyRange = { only: value => ({ only: value }) };
class Request { result; error=null; onsuccess=null; onerror=null; }
class Store {
  constructor(db,tx){this.db=db;this.tx=tx;}
  index(){return {getAll:range=>{const r=new Request();queueMicrotask(()=>{r.result=[...this.db.rows.values()].filter(x=>x.conversationId===range.only);r.onsuccess?.();this.db.finish(this.tx);});return r;}};}
  get(key){const r=new Request();queueMicrotask(()=>{r.result=this.db.heads.get(key);r.onsuccess?.();this.db.finish(this.tx);});return r;}
  add(row){this.db.rows.set(row.id,structuredClone(row));queueMicrotask(()=>this.db.finish(this.tx));}
  put(row){this.db.heads.set(row.conversationId,structuredClone(row));queueMicrotask(()=>this.db.finish(this.tx));}
}
class Tx {oncomplete=null;onerror=null;onabort=null;constructor(db){this.db=db;}objectStore(){return new Store(this.db,this);}}
class DB {rows=new Map();heads=new Map();transaction(){return new Tx(this);}finish(tx){setImmediate(()=>tx.oncomplete?.());}}

import { mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { enumerateStableFileInventory } from '../fs-inventory.js';

async function fixture(t) {
  const journal = new HostLifecycleJournal(new DB());
  await journal.enroll({ conversationId: 'chat', sourceFingerprint: 'chat-fp', messages: [] });
  const parent = await mkdtemp(join(tmpdir(), 'logic-engine-fs-reconciliation-'));
  const root = join(parent, 'data');
  const chats = join(root, 'chats');
  const file = join(chats, 'a.jsonl');
  await mkdir(chats, { recursive: true });
  await writeFile(file, '{"role":"user","mes":"first"}\\n');
  t.after(async () => rm(parent, { recursive: true, force: true }));
  const scan = async () => {
    const inventory = await enumerateStableFileInventory(resolve(root));
    assert.equal(inventory.status, 'complete', JSON.stringify(inventory));
    return inventory;
  };
  return { journal, root: resolve(root), file, scan };
}
const reconcile = (journal, inventory, expectedRoot, sourceFingerprint = 'chat-fp') =>
  reconcileFilesystemInventory({ journal, conversationId: 'chat', inventory, sourceFingerprint, expectedRoot });

test('caller-constructed filesystem manifest cannot establish a baseline', async () => {
  const journal = await fixtureJournal();
  const entries = [{ path: 'chats/a.jsonl', identity: { dev: '1', ino: '2' }, sha256: 'b'.repeat(64) }];
  const forged = {
    status: 'complete', scope: 'single-root-regular-files-only', root: '/disposable/st-data',
    file_count: 1, snapshot_sha256: createHash('sha256').update(JSON.stringify(entries)).digest('hex'),
    snapshot_id: '00000000-0000-0000-0000-000000000001',
    snapshot_provider: 'windows-vss-client-accessible',
    snapshot_consistency: 'VSS_POINT_IN_TIME_READ_ONLY',
    reparse_points: 'ALL_FILE_ATTRIBUTE_REPARSE_POINT_ENTRIES_REJECTED', entries,
  };
  const result = await reconcileFilesystemInventory({
    journal, conversationId: 'chat', inventory: forged,
    sourceFingerprint: 'chat-fp', expectedRoot: '/disposable/st-data',
  });
  assert.equal(result.status, 'NON_READY');
  assert.match(result.reason, /not produced by the trusted scanner in this process/);
});
async function fixtureJournal() {
  const journal = new HostLifecycleJournal(new DB());
  await journal.enroll({ conversationId: 'chat', sourceFingerprint: 'chat-fp', messages: [] });
  return journal;
}

test('first complete real filesystem scan is durably anchored in the lifecycle journal', { skip: process.platform === 'win32' }, async (t) => {
  const f = await fixture(t);
  const result = await reconcile(f.journal, await f.scan(), f.root);
  assert.equal(result.status, 'BASELINED_REVIEW_ONLY');
  const ledger = await f.journal.exportCaptureLedger('chat');
  assert.equal(ledger.records.at(-1).operation, 'filesystem-inventory-baseline');
  assert.equal(JSON.stringify(ledger).includes('"mes":"first"'), false);
});

test('identical real filesystem scan reconciles without growing the journal', { skip: process.platform === 'win32' }, async (t) => {
  const f = await fixture(t);
  await reconcile(f.journal, await f.scan(), f.root);
  const before = (await f.journal.exportCaptureLedger('chat')).sequence;
  const result = await reconcile(f.journal, await f.scan(), f.root);
  assert.equal(result.status, 'UNCHANGED_REVIEW_ONLY');
  assert.equal((await f.journal.exportCaptureLedger('chat')).sequence, before);
});

test('real add, edit, delete and restore deltas fail closed', { skip: process.platform === 'win32' }, async (t) => {
  const f = await fixture(t);
  await reconcile(f.journal, await f.scan(), f.root);
  await writeFile(f.file, '{"role":"user","mes":"edited"}\\n');
  assert.equal((await reconcile(f.journal, await f.scan(), f.root)).status, 'NON_READY');
  await rm(f.file);
  assert.equal((await reconcile(f.journal, await f.scan(), f.root)).status, 'NON_READY');
  await writeFile(f.file, '{"role":"user","mes":"first"}\\n');
  assert.equal((await reconcile(f.journal, await f.scan(), f.root)).status, 'NON_READY');
});

test('incomplete inventory and caller-mutated manifest cannot establish a baseline', { skip: process.platform === 'win32' }, async (t) => {
  const f = await fixture(t);
  const inventory = await f.scan();
  assert.equal(Object.isFrozen(inventory), true);
  assert.equal(Object.isFrozen(inventory.entries), true);
  assert.equal(Object.isFrozen(inventory.entries[0]), true);
  assert.equal(Object.isFrozen(inventory.entries[0].identity), true);
  assert.throws(() => { inventory.entries[0].sha256 = '0'.repeat(64); }, TypeError);
  const bad = { ...inventory, status: 'non_ready' };
  assert.equal((await reconcile(f.journal, bad, f.root)).status, 'NON_READY');
});

test('filesystem scan cannot be attached to a different conversation journal head', { skip: process.platform === 'win32' }, async (t) => {
  const f = await fixture(t);
  const result = await reconcile(f.journal, await f.scan(), f.root, 'other-chat-fp');
  assert.equal(result.status, 'NON_READY');
  assert.match(result.reason, /differs from the accepted lifecycle journal head/);
});

test('filesystem inventory baseline is denied while a durable Host mutation is pending', { skip: process.platform === 'win32' }, async (t) => {
  const f = await fixture(t);
  await f.journal.beforeMutation({
    conversationId: 'chat', eventId: 'pending-edit', operation: 'edit-message',
    affectedVersions: [], sourceFingerprint: 'chat-fp',
  });
  const result = await reconcile(f.journal, await f.scan(), f.root);
  assert.equal(result.status, 'NON_READY');
  assert.match(result.reason, /mutation is pending/);
  const ledger = await f.journal.exportCaptureLedger('chat');
  assert.equal(ledger.records.some(record => record.operation === 'filesystem-inventory-baseline'), false);
});

test('journal atomically refuses an inventory checkpoint while a mutation is pending', async () => {
  const journal = await fixtureJournal();
  await journal.beforeMutation({
    conversationId: 'chat', eventId: 'pending-race', operation: 'delete-message',
    affectedVersions: [], sourceFingerprint: 'chat-fp',
  });
  const result = await journal.append({
    conversationId: 'chat', eventId: 'inventory-race', operation: 'filesystem-inventory-baseline',
    sourceFingerprint: 'chat-fp', requireNoPendingMutation: true,
    payload: { schemaVersion: 1, inventory: { root: '/disposable/st-data', snapshotSha256: 'a'.repeat(64), fileCount: 0, entries: [] } },
  });
  assert.equal(result.status, 'NON_READY');
  assert.match(result.reason, /mutation is pending/);
  const ledger = await journal.exportCaptureLedger('chat');
  assert.equal(ledger.records.some(record => record.operation === 'filesystem-inventory-baseline'), false);
});


test('file-level modified delta is durably journaled, idempotent, and remains unresolved after restore', { skip: process.platform === 'win32' }, async (t) => {
  const f = await fixture(t);
  await reconcile(f.journal, await f.scan(), f.root);
  await writeFile(f.file, '{"role":"user","mes":"edited"}\\n');

  const changedInventory = await f.scan();
  const changed = await reconcile(f.journal, changedInventory, f.root);
  assert.equal(changed.status, 'NON_READY');
  assert.equal(changed.counts.modified, 1);
  assert.equal(changed.delta.modified[0].path, 'chats/a.jsonl');

  const afterFirst = await f.journal.exportCaptureLedger('chat');
  const observation = afterFirst.records.at(-1);
  assert.equal(observation.operation, 'filesystem-inventory-delta-observed');
  assert.equal(observation.payload.delta.modified[0].path, 'chats/a.jsonl');

  const repeated = await reconcile(f.journal, await f.scan(), f.root);
  assert.equal(repeated.status, 'NON_READY');
  const afterRepeat = await f.journal.exportCaptureLedger('chat');
  assert.equal(afterRepeat.sequence, afterFirst.sequence);

  await writeFile(f.file, '{"role":"user","mes":"first"}\\n');
  const restored = await reconcile(f.journal, await f.scan(), f.root);
  assert.equal(restored.status, 'NON_READY');
  assert.match(restored.reason, /file-level delta was recorded|previously observed filesystem delta remains unresolved/);
});


test('file rename followed by content edit records both path and digest transitions', { skip: process.platform === 'win32' }, async (t) => {
  const f = await fixture(t);
  const baselineInventory = await f.scan();
  await reconcile(f.journal, baselineInventory, f.root);
  const before = baselineInventory.entries.find(entry => entry.path === 'chats/a.jsonl');
  const renamedPath = join(f.root, 'chats', 'renamed.jsonl');
  await rename(f.file, renamedPath);
  await writeFile(renamedPath, '{"role":"user","mes":"renamed and edited"}\\n');

  const afterInventory = await f.scan();
  const result = await reconcile(f.journal, afterInventory, f.root);
  assert.equal(result.status, 'NON_READY');
  assert.equal(result.delta.moved.length, 1);
  assert.equal(result.delta.added.length, 0);
  assert.equal(result.delta.removed.length, 0);
  assert.equal(result.delta.moved[0].from, 'chats/a.jsonl');
  assert.equal(result.delta.moved[0].to, 'chats/renamed.jsonl');
  assert.equal(result.delta.moved[0].beforeSha256, before.sha256);
  assert.equal(result.delta.moved[0].afterSha256,
    afterInventory.entries.find(entry => entry.path === 'chats/renamed.jsonl').sha256);
  assert.equal(result.delta.moved[0].contentChanged, true);
});
