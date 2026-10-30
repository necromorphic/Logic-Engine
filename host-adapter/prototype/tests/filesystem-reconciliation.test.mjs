import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { webcrypto } from 'node:crypto';
import { HostLifecycleJournal } from '../lifecycle-journal.mjs';
import { enumerateStableFileInventory } from '../fs-inventory.js';
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

async function fixture(t) {
  const journal = new HostLifecycleJournal(new DB());
  await journal.enroll({ conversationId: 'chat', sourceFingerprint: 'chat-fp', messages: [] });
  const parent = await mkdtemp(join(tmpdir(), 'logic-engine-fs-reconciliation-'));
  const root = join(parent, 'data');
  const chatDirectory = join(root, 'chats');
  const file = join(chatDirectory, 'a.jsonl');
  await mkdir(chatDirectory, { recursive: true });
  await writeFile(file, '{"role":"user","mes":"first"}\n');
  t.after(async () => rm(parent, { recursive: true, force: true }));
  const scan = async () => {
    const inventory = await enumerateStableFileInventory(resolve(root));
    assert.equal(inventory.status, 'complete', JSON.stringify(inventory));
    return inventory;
  };
  return { journal, root: resolve(root), file, scan };
}

const reconcile = (journal, inventory, expectedRoot, sourceFingerprint = 'chat-fp') =>
  reconcileFilesystemInventory({
    journal, conversationId: 'chat', inventory, sourceFingerprint, expectedRoot,
  });

test('first complete filesystem scan is durably anchored in the existing lifecycle journal', { skip: process.platform === 'win32' }, async (t) => {
  const f = await fixture(t);
  const inventory = await f.scan();
  const result = await reconcile(f.journal, inventory, f.root);
  assert.equal(result.status, 'BASELINED_REVIEW_ONLY');
  const ledger = await f.journal.exportCaptureLedger('chat');
  assert.equal(ledger.records.at(-1).operation, 'filesystem-inventory-baseline');
  assert.equal(JSON.stringify(ledger).includes('first'), false);
});

test('identical filesystem scan reconciles without growing the journal', { skip: process.platform === 'win32' }, async (t) => {
  const f = await fixture(t);
  const first = await f.scan();
  await reconcile(f.journal, first, f.root);
  const before = (await f.journal.exportCaptureLedger('chat')).sequence;
  const second = await f.scan();
  const result = await reconcile(f.journal, second, f.root);
  assert.equal(result.status, 'UNCHANGED_REVIEW_ONLY');
  assert.equal((await f.journal.exportCaptureLedger('chat')).sequence, before);
});

test('any unexplained add, edit, delete, replacement or restore delta fails closed', { skip: process.platform === 'win32' }, async (t) => {
  const f = await fixture(t);
  const first = await f.scan();
  await reconcile(f.journal, first, f.root);
  await writeFile(f.file, '{"role":"user","mes":"changed"}\n');
  const changed = await reconcile(f.journal, await f.scan(), f.root);
  assert.equal(changed.status, 'NON_READY');
  assert.match(changed.reason, /unexplained filesystem change/);
});

test('caller-created or cloned complete manifests cannot establish a filesystem baseline', { skip: process.platform === 'win32' }, async (t) => {
  const f = await fixture(t);
  const inventory = await f.scan();
  const forged = { ...inventory };
  const result = await reconcile(f.journal, forged, f.root);
  assert.equal(result.status, 'NON_READY');
  assert.match(result.reason, /not produced by the trusted scanner/);
  const ledger = await f.journal.exportCaptureLedger('chat');
  assert.equal(ledger.records.some(record => record.operation === 'filesystem-inventory-baseline'), false);
  assert.equal(Object.isFrozen(inventory.entries), true);
  assert.equal(Object.isFrozen(inventory.entries[0]), true);
  assert.equal(Object.isFrozen(inventory.entries[0].identity), true);
});

test('incomplete or wrong-root inventory cannot establish a baseline', { skip: process.platform === 'win32' }, async (t) => {
  const f = await fixture(t);
  const inventory = await f.scan();
  const incomplete = await reconcile(f.journal, { ...inventory, status: 'non_ready' }, f.root);
  assert.equal(incomplete.status, 'NON_READY');
  assert.match(incomplete.reason, /not produced by the trusted scanner/);
  const wrongRoot = await reconcile(f.journal, inventory, resolve(f.root, '..', 'other-root'));
  assert.equal(wrongRoot.status, 'NON_READY');
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

test('journal atomically refuses an inventory checkpoint if a mutation starts after the preflight check', async () => {
  const journal = new HostLifecycleJournal(new DB());
  await journal.enroll({ conversationId: 'chat', sourceFingerprint: 'chat-fp', messages: [] });
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
