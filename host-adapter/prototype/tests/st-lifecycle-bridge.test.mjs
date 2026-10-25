import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { HostLifecycleJournal } from '../lifecycle-journal.mjs';
import { createStLifecycleBridge } from '../st-lifecycle-bridge.mjs';

globalThis.crypto ??= webcrypto;
globalThis.IDBKeyRange = { only: value => ({ only: value }) };

class FakeRequest { result = undefined; error = null; onsuccess = null; onerror = null; }
class FakeStore {
  constructor(db, tx, name) { this.db = db; this.tx = tx; this.name = name; }
  index() {
    return {
      getAll: range => {
        const request = new FakeRequest();
        queueMicrotask(() => {
          request.result = [...this.db.rows.values()].filter(row => row.conversationId === range.only);
          request.onsuccess?.();
          this.db.finish(this.tx);
        });
        return request;
      },
    };
  }
  get(key) {
    const request = new FakeRequest();
    queueMicrotask(() => {
      request.result = this.db.heads.get(key);
      request.onsuccess?.();
      this.db.finish(this.tx);
    });
    return request;
  }
  add(record) {
    if (this.db.failNextWrite) {
      this.db.failNextWrite = false;
      throw Error('simulated disk full');
    }
    if (this.db.rows.has(record.id)) throw Error('duplicate key');
    this.db.rows.set(record.id, structuredClone(record));
    queueMicrotask(() => this.db.finish(this.tx));
  }
  put(record) {
    this.db.heads.set(record.conversationId, structuredClone(record));
    queueMicrotask(() => this.db.finish(this.tx));
  }
}
class FakeTransaction {
  error = null; oncomplete = null; onerror = null; onabort = null;
  constructor(db, names) { this.db = db; this.names = names; }
  objectStore(name) { return new FakeStore(this.db, this, name); }
}
class FakeDB {
  rows = new Map(); heads = new Map(); failNextWrite = false;
  transaction(names) { return new FakeTransaction(this, names); }
  finish(tx) { setImmediate(() => tx.oncomplete?.()); }
}

function makeFixture() {
  let failSave = false;
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
  return { db, journal, chat, bridge, setFailSave(value) { failSave = value; }, get saveCount() { return saveCount; } };
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
  const readiness = await f.bridge.reconcileCurrentConversation();
  assert.equal(readiness.status, 'NON_READY');
  assert.ok(readiness.missingPaths.includes('cancel-generation'));
  assert.ok(readiness.missingPaths.includes('restore'));
  for (const path of ['message-send', 'message-receive', 'generation-start', 'generation-end', 'generation-stop', 'partial-generation', 'persistence-ordering', 'export', 'copy-branch', 'chat-switch', 'external-edit', 'rollback', 'restart', 'replay']) {
    assert.ok(readiness.missingPaths.includes(path), `expected uncovered lifecycle path: ${path}`);
  }
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
  const f = makeFixture();
  await f.bridge.enrollCurrentConversation();
  await f.bridge.beforeMutation('edit-message', [0]);
  f.chat[0].mes = 'changed by edit';
  f.setFailSave(true);
  await assert.rejects(f.bridge.afterMutation('edit-message'), /simulated native chat save failure/);
  f.setFailSave(false);
  await assert.rejects(f.bridge.beforeMutation('delete-message', [0]), /fingerprint differs/);
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
  const readiness = await bridge.reconcileCurrentConversation();
  assert.equal(readiness.status, 'NON_READY');
  assert.ok(readiness.missingPaths.includes('cancel-generation'));
});

test('restart reconciliation rejects a corrupted journal even when chat fingerprint still matches', async () => {
  const f = makeFixture();
  await f.bridge.enrollCurrentConversation();
  const baseline = [...f.db.rows.values()][0];
  baseline.payload.messages[0].role = 'tampered';
  const result = await f.bridge.reconcileCurrentConversation();
  assert.equal(result.status, 'NON_READY');
  assert.match(result.reason, /digest mismatch/);
});

test('clear-chat captures all enrolled versions before removing the chat array', async () => {
  const f = makeFixture();
  await f.bridge.enrollCurrentConversation();
  const before = await f.bridge.beforeMutation('clear-chat', [0, 1]);
  assert.equal(before.operation, 'before:clear-chat');
  assert.equal(before.payload.affectedVersions.length, 2);

  f.chat.length = 0;
  await f.bridge.afterMutation('clear-chat');
  assert.equal((await f.journal.verifyIntegrity('chat-1')).status, 'INTEGRITY_OK');

  const readiness = await f.bridge.reconcileCurrentConversation();
  assert.equal(readiness.status, 'NON_READY');
  assert.ok(!readiness.missingPaths.includes('clear-chat'));
  assert.ok(readiness.missingPaths.includes('cancel-generation'));
});

test('unavailable bridge re-checks enrollment marker for the current chat before each mutation', async () => {
  const { createUnavailableStLifecycleBridge } = await import('../st-lifecycle-bridge.mjs');
  let conversationId = 'chat-1';
  const markers = new Map();
  const storage = { getItem: key => markers.get(key) ?? null };
  const error = Error('IndexedDB unavailable');
  const bridge = createUnavailableStLifecycleBridge({
    getConversationId: () => conversationId,
    storage,
    error,
  });

  assert.deepEqual(await bridge.beforeMutation('delete-message', [0]), { status: 'NOT_ENROLLED' });
  markers.set('logic-engine-host-lifecycle:chat-1', 'NON_READY');
  await assert.rejects(
    bridge.beforeMutation('delete-message', [0]),
    /NON_READY: enrolled Host journal unavailable: IndexedDB unavailable/,
  );

  conversationId = 'chat-2';
  assert.deepEqual(await bridge.beforeMutation('delete-message', [0]), { status: 'NOT_ENROLLED' });
  conversationId = 'chat-1';
  await assert.rejects(
    bridge.afterMutation('delete-message'),
    /NON_READY: enrolled Host journal unavailable: IndexedDB unavailable/,
  );
});

test('pre-mutation rejects duplicate or out-of-range indexes and reconciliation rejects identity collisions', async () => {
  const f = makeFixture();
  await f.bridge.enrollCurrentConversation();

  await assert.rejects(
    f.bridge.beforeMutation('delete-message', [0, 0]),
    /duplicate source message indexes/,
  );
  await assert.rejects(
    f.bridge.beforeMutation('delete-message', [f.chat.length]),
    /invalid source message index/,
  );

  f.chat[1]._logicEngineLifecycle.versions[0].versionId =
    f.chat[0]._logicEngineLifecycle.versions[0].versionId;
  const result = await f.bridge.reconcileCurrentConversation();
  assert.equal(result.status, 'NON_READY');
  assert.match(result.reason, /duplicate logical version identity/);
});

test('reconciliation rejects identity metadata whose digest no longer matches native message content', async () => {
  const f = makeFixture();
  await f.bridge.enrollCurrentConversation();
  f.chat[0]._logicEngineLifecycle.versions[0].payloadDigest = 'tampered-digest';
  const result = await f.bridge.reconcileCurrentConversation();
  assert.equal(result.status, 'NON_READY');
  assert.match(result.reason, /version digest does not match native source content/);
});
