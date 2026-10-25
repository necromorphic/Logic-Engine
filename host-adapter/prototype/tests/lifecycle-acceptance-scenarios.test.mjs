import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { webcrypto } from 'node:crypto';
import { HostLifecycleJournal } from '../lifecycle-journal.mjs';
import { createStLifecycleBridge } from '../st-lifecycle-bridge.mjs';

globalThis.crypto ??= webcrypto;
globalThis.IDBKeyRange = { only: value => ({ only: value }) };

class Request { result; error = null; onsuccess = null; onerror = null; }
class Store {
  constructor(db, tx, name) { this.db = db; this.tx = tx; this.name = name; }
  index() { return { getAll: range => { const r = new Request(); queueMicrotask(() => { r.result = [...this.db.rows.values()].filter(x => x.conversationId === range.only); r.onsuccess?.(); this.db.finish(this.tx); }); return r; } }; }
  get(key) { const r = new Request(); queueMicrotask(() => { r.result = this.db.heads.get(key); r.onsuccess?.(); this.db.finish(this.tx); }); return r; }
  add(row) { if (this.db.failNextWrite) { this.db.failNextWrite = false; throw Error('simulated disk full'); } if (this.db.rows.has(row.id)) throw Error('duplicate key'); this.db.rows.set(row.id, structuredClone(row)); queueMicrotask(() => this.db.finish(this.tx)); }
  put(row) { this.db.heads.set(row.conversationId, structuredClone(row)); queueMicrotask(() => this.db.finish(this.tx)); }
}
class Transaction {
  error = null; oncomplete = null; onerror = null; onabort = null;
  constructor(db) { this.db = db; }
  objectStore(name) { return new Store(this.db, this, name); }
}
class FakeDB {
  rows = new Map(); heads = new Map(); failNextWrite = false;
  transaction() { return new Transaction(this); }
  finish(tx) { setImmediate(() => tx.oncomplete?.()); }
}
function fixture() {
  const db = new FakeDB();
  const journal = new HostLifecycleJournal(db);
  const chat = [
    { is_user: true, mes: 'hello' },
    { is_user: false, mes: 'swipe A', swipes: ['swipe A', 'swipe B', 'swipe C'], swipe_id: 1 },
  ];
  const bridge = createStLifecycleBridge({
    journal, getConversationId: () => 'scenario-chat', getChat: () => chat,
    saveChat: async () => {},
  });
  return { db, journal, chat, bridge };
}

test('swipe deletion preserves surviving version IDs and does not treat selection as deletion', async () => {
  const f = fixture();
  await f.bridge.enrollCurrentConversation();
  const versions = f.chat[1]._logicEngineLifecycle.versions;
  const ids = versions.map(v => v.versionId);
  const activeBefore = f.chat[1]._logicEngineLifecycle.activeVersionIndex;
  assert.equal(activeBefore, 1);

  await f.bridge.beforeMutation('delete-swipe', [1], { swipeIndex: 1 });
  f.chat[1].swipes.splice(1, 1);
  f.chat[1].mes = 'swipe C';
  f.chat[1].swipe_id = 1;
  await f.bridge.afterMutation('delete-swipe', { removedSwipeIndex: 1, selectedMessageIndex: 1 });

  const after = f.chat[1]._logicEngineLifecycle;
  assert.deepEqual(after.versions.map(v => v.versionId), [ids[0], ids[2]]);
  assert.deepEqual(after.versions.map(v => v.versionIndex), [0, 1]);
  assert.equal(after.activeVersionIndex, 1);
  assert.equal((await f.journal.verifyIntegrity('scenario-chat')).status, 'INTEGRITY_OK');
});

test('write-ahead failure prevents the simulated destructive mutation', async () => {
  const f = fixture();
  await f.bridge.enrollCurrentConversation();
  const beforeText = f.chat[0].mes;
  f.db.failNextWrite = true;
  await assert.rejects(f.bridge.beforeMutation('delete-message', [0]), /MUST abort mutation/);
  // The host call site must await beforeMutation; this test models that contract.
  assert.equal(f.chat[0].mes, beforeText);
  assert.equal((await f.bridge.reconcileCurrentConversation()).status, 'NON_READY');
});

test('bulk-clear journal primitive records affected inventory but clear-chat source coverage stays NON_READY', async () => {
  const f = fixture();
  await f.bridge.enrollCurrentConversation();
  const baselineIds = f.chat.map(m => m._logicEngineLifecycle.messageId);
  const expectedVersionIds = f.chat.flatMap(m => m._logicEngineLifecycle.versions.map(v => v.versionId)).sort();
  await f.bridge.beforeMutation('clear-chat', [0, 1]);
  f.chat.length = 0;
  await f.bridge.afterMutation('clear-chat');
  const rows = [...f.db.rows.values()].sort((a, b) => a.sequence - b.sequence);
  const preClear = rows.find(r => r.operation === 'before:clear-chat');
  assert.ok(preClear);
  assert.deepEqual(
    [...new Set(preClear.payload.affectedVersions.map(v => v.messageId))].sort(),
    [...baselineIds].sort(),
  );
  assert.deepEqual(preClear.payload.affectedVersions.map(v => v.versionId).sort(), expectedVersionIds);
  assert.equal((await f.journal.verifyIntegrity('scenario-chat')).status, 'INTEGRITY_OK');
  const readiness = await f.bridge.reconcileCurrentConversation();
  assert.equal(readiness.status, 'NON_READY');
  assert.ok(readiness.missingPaths.includes('clear-chat'));
});

test('pinned patch explicitly hooks core mutations but does not pretend uncovered paths are hooked', async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const patch = await readFile(resolve(here, '../patches/sillytavern-1.19.0-lifecycle-hooks.patch'), 'utf8');
  for (const marker of [
    "beforeMutation('delete-message'",
    "beforeMutation('delete-swipe'",
    "beforeMutation('edit-message'",
    "afterMutation('delete-swipe'",
    "beforeMutation('select-swipe'",
    "afterMutation('select-swipe'",
    "['swipe', 'regenerate'].includes(type) ? 'create-swipe'",
  ]) assert.ok(patch.includes(marker), `expected pinned patch hook: ${marker}`);

  // These are explicit acceptance gaps, not passing coverage. Any future claim
  // of completeness must add native hooks and runtime evidence for them.
  for (const missing of ['cancel-generation', 'restore', 'import']) {
    assert.equal(patch.includes(`beforeMutation('${missing}'`), false, `unexpected unsupported claim: ${missing}`);
  }
});


test('pinned patch journals edit and swipe deletion only after awaited native save', async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const patch = await readFile(resolve(here, '../patches/sillytavern-1.19.0-lifecycle-hooks.patch'), 'utf8');

  assert.ok(
    patch.includes("     await eventSource.emit(event_types.MESSAGE_UPDATED, this_edit_mes_id);\\n     this_edit_mes_id = undefined;\\n     await saveChatConditional();\\n+    await lifecycleBridge.afterMutation('edit-message');"),
    'edit checkpoint must follow the awaited native save',
  );
  assert.ok(
    patch.includes("     await saveChatConditional();\\n+    await lifecycleBridge.afterMutation('delete-swipe', { removedSwipeIndex: swipeId, selectedMessageIndex: messageId });"),
    'swipe-delete checkpoint must follow the awaited native save',
  );
});
