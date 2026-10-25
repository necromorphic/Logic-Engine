import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { HostLifecycleJournal } from '../lifecycle-journal.mjs';
import { createStLifecycleBridge } from '../st-lifecycle-bridge.mjs';

globalThis.crypto ??= webcrypto;
globalThis.IDBKeyRange = { only: value => ({ only: value }) };

class FakeRequest { result = undefined; error = null; onsuccess = null; onerror = null; }
class FakeStore {
  constructor(db) { this.db = db; }
  index() {
    return {
      getAll: range => {
        const request = new FakeRequest();
        queueMicrotask(() => {
          request.result = [...this.db.rows.values()].filter(row => row.conversationId === range.only);
          request.onsuccess?.();
          this.db.finish();
        });
        return request;
      },
    };
  }
  add(record) {
    if (this.db.failNextWrite) {
      this.db.failNextWrite = false;
      throw Error('simulated disk full');
    }
    if (this.db.rows.has(record.id)) throw Error('duplicate key');
    this.db.rows.set(record.id, structuredClone(record));
    queueMicrotask(() => this.db.finish());
  }
}
class FakeTransaction {
  error = null; oncomplete = null; onerror = null; onabort = null;
  constructor(db) { this.db = db; }
  objectStore() { return new FakeStore(this.db); }
}
class FakeDB {
  rows = new Map(); failNextWrite = false; txs = [];
  transaction() { const tx = new FakeTransaction(this); this.txs.push(tx); return tx; }
  finish() { const tx = this.txs.shift(); if (tx) setImmediate(() => tx.oncomplete?.()); }
}

function makeFixture({ failSave = false } = {}) {
  const db = new FakeDB();
  const journal = new HostLifecycleJournal(db);
  const chat = [{ is_user: true, mes: 'hello' }, { is_user: false, mes: 'answer' }];
  let saveCount = 0;
  const bridge = createStLifecycleBridge({
    journal,
    getConversationId: () => 'chat-1',
    getChat: () => chat,
    saveChat: async () => {
      saveCount++;
      if (failSave) throw Error('simulated native chat save failure');
    },
  });
  return { db, journal, chat, bridge, get saveCount() { return saveCount; } };
}

test('enrolled bridge writes event IDs and advances the fingerprint after an edit', async () => {
  const f = makeFixture();
  const enrollment = await f.bridge.enrollCurrentConversation();
  assert.equal(enrollment.status, 'REVIEW_ONLY');
  assert.equal(enrollment.preEnrollmentHistory, 'UNKNOWN_UNRECOVERABLE');
  assert.ok(f.chat.every(message => message._logicEngineLifecycle?.messageId));

  const before = await f.bridge.beforeMutation('edit-message', [0]);
  assert.equal(before.operation, 'before:edit-message');
  assert.ok(before.eventId);

  const oldVersionId = f.chat[0]._logicEngineLifecycle.versions[0].versionId;
  f.chat[0].mes = 'hello edited';
  const after = await f.bridge.afterMutation('edit-message');
  assert.equal(after.status, 'REVIEW_ONLY');
  const currentIdentity = f.chat[0]._logicEngineLifecycle;
  assert.notEqual(currentIdentity.versions[0].versionId, oldVersionId);
  assert.equal(currentIdentity.versions[0].parentVersionId, oldVersionId);

  const next = await f.bridge.beforeMutation('delete-message', [0]);
  assert.equal(next.operation, 'before:delete-message');
  assert.equal((await f.bridge.reconcileCurrentConversation()).status, 'REVIEW_ONLY');
});

test('restart reconciliation fails closed when source changed after the last journal checkpoint', async () => {
  const f = makeFixture();
  await f.bridge.enrollCurrentConversation();
  f.chat[0].mes = 'changed without hook';
  const result = await f.bridge.reconcileCurrentConversation();
  assert.equal(result.status, 'NON_READY');
  assert.match(result.reason, /fingerprint differs/);
  await assert.rejects(f.bridge.beforeMutation('delete-message', [0]), /fingerprint differs/);
});

test('native save failure leaves the journal behind so the next mutation fails closed', async () => {
  const f = makeFixture({ failSave: true });
  await f.bridge.enrollCurrentConversation().catch(() => {});
  // Enrollment save failure must not permit a mutation with an unpersisted mapping.
  await assert.rejects(f.bridge.beforeMutation('edit-message', [0]), /missing durable identity mapping|fingerprint differs/);
});

test('empty chat enrollment is explicit and does not imply pre-enrollment history', async () => {
  const db = new FakeDB(), journal = new HostLifecycleJournal(db), chat = [];
  const bridge = createStLifecycleBridge({
    journal,
    getConversationId: () => 'empty-chat',
    getChat: () => chat,
    saveChat: async () => {},
  });
  const result = await bridge.enrollCurrentConversation();
  assert.equal(result.messageCount, 0);
  assert.equal(result.preEnrollmentHistory, 'UNKNOWN_UNRECOVERABLE');
  assert.equal((await bridge.reconcileCurrentConversation()).status, 'REVIEW_ONLY');
});
