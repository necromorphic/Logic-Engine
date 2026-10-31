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
          if (this.tx.mode === 'readonly') this.db.finish(this.tx);
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
      if (this.tx.mode === 'readonly') this.db.finish(this.tx);
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
  constructor(db, names, mode) { this.db = db; this.names = names; this.mode = mode; }
  objectStore(name) { return new FakeStore(this.db, this, name); }
  abort() { this.error = Error('transaction aborted'); setImmediate(() => this.onabort?.()); }
}
class FakeDB {
  rows = new Map(); heads = new Map(); failNextWrite = false;
  transaction(names, mode = 'readonly') { return new FakeTransaction(this, names, mode); }
  finish(tx) { setImmediate(() => tx.oncomplete?.()); }
}

function makeFixture(chat = [{ is_user: true, mes: 'hello' }, { is_user: false, mes: 'answer' }], {
  publishDigest = null,
  publishSnapshot = null,
  conversationId = 'chat-1',
  getPersistedInventory = null,
  publishLifecycleEvent = null,
  getLifecycleStatus = null,
} = {}) {
  let failSave = false;
  const db = new FakeDB();
  const journal = new HostLifecycleJournal(db);
  let saveCount = 0;
  let sourceLocator = 'chat-file-1';
  const bridge = createStLifecycleBridge({
    journal,
    getConversationId: () => conversationId,
    getSourceLocator: () => sourceLocator,
    getChat: () => chat,
    publishDigest,
    publishSnapshot,
    getPersistedInventory,
    publishLifecycleEvent,
    getLifecycleStatus,
    saveChat: async () => {
      saveCount++;
      if (failSave) throw Error('simulated native chat save failure');
    },
  });
  return { db, journal, chat, bridge, setLocator(value) { sourceLocator = value; }, getLocator() { return sourceLocator; }, setFailSave(value) { failSave = value; }, get saveCount() { return saveCount; } };
}


async function makePersistedInventory(chat, { sessionId, conversationUuid, userHandle = 'alice' }) {
  const messages = await Promise.all(chat.map(async message => {
    const identity = message._logicEngineLifecycle;
    const rawVersions = Array.isArray(message.swipes) && message.swipes.length
      ? message.swipes : [message.mes];
    const versions = await Promise.all(identity.versions.map(async (version, index) => {
      const bytes = new TextEncoder().encode(String(rawVersions[index]));
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
        .map(value => value.toString(16).padStart(2, '0')).join('');
      return {
        version_id: version.versionId,
        version_index: index,
        parent_version_id: version.parentVersionId ?? null,
        content_sha256: digest,
        active: index === identity.activeVersionIndex,
      };
    }));
    return {
      message_id: identity.messageId,
      role: message.is_user ? 'user' : message.is_system ? 'system' : 'assistant',
      active_version_index: identity.activeVersionIndex,
      versions,
    };
  }));
  return {
    status: 'DOUBLE_SCAN_CANDIDATE',
    authority: 'NON_AUTHORITATIVE',
    completeness: 'DOUBLE_SCANNED_PATH_VIEW_ONLY',
    host_commit: '06bde939fb1e9c4c8d8641d810f0a916b5bce127',
    host_build_claim: '06bde939fb1e9c4c8d8641d810f0a916b5bce127',
    host_build_claim_type: 'DEPLOYMENT_ASSERTION_NOT_RUNTIME_ATTESTATION',
    host_session_id: sessionId,
    host_session_identity: 'SIGNED_AUTHENTICATED_ST_SESSION',
    host_user_handle: userHandle,
    authenticated_user_handle: userHandle,
    requested_conversation_uuid: conversationUuid,
    inventory_sha256: 'a'.repeat(64),
    files: [{
      logical_identity: {
        conversation_uuid: conversationUuid,
        identity_status: 'CURRENT_IDENTITIES_VERIFIED',
        message_count: messages.length,
        identified_message_count: messages.length,
        missing_message_identity_count: 0,
        messages,
      },
    }],
  };
}

test('lifecycle mutations require a matching durable before/after pair', async () => {
  const f = makeFixture();
  await f.bridge.enrollCurrentConversation();

  const before = await f.bridge.beforeMutation('edit-message', [0]);
  assert.equal(before.operation, 'before:edit-message');
  await assert.rejects(
    () => f.bridge.beforeMutation('delete-message', [1]),
    /previous lifecycle operation is incomplete/,
  );

  f.chat[0].mes = 'hello edited';
  const after = await f.bridge.afterMutation('edit-message');
  assert.equal(after.status, 'REVIEW_ONLY');
  await assert.rejects(
    () => f.bridge.afterMutation('edit-message'),
    /afterMutation has no matching durable beforeMutation/,
  );

  const ledger = await f.journal.exportCaptureLedger('chat-1');
  assert.deepEqual(
    ledger.records.filter(record => record.operation.startsWith('before:') || record.operation.startsWith('after:'))
      .map(record => record.operation),
    ['before:edit-message', 'after:edit-message'],
  );
});

test('persisted ST inventory is cross-checked against the session-bound conversation without claiming authority', async () => {
  const sessionId = '2e6b0a80-4e73-4c66-aaf3-7a6e62c7f401';
  const installationId = '3e6b0a80-4e73-4c66-aaf3-7a6e62c7f402';
  const conversationUuid = '4e6b0a80-4e73-4c66-aaf3-7a6e62c7f403';
  const conversationId = sessionId + ':' + installationId + ':' + conversationUuid;
  const chat = [{ is_user: true, mes: 'private user sentinel' }, { is_user: false, mes: 'private assistant sentinel' }];
  let inventory = null;
  const publishedSnapshots = [];
  const f = makeFixture(chat, {
    conversationId,
    getPersistedInventory: async () => inventory,
    publishSnapshot: async snapshot => {
      publishedSnapshots.push(structuredClone(snapshot));
      return { reconciliation: { code: 'HOST_INVENTORY_INCOMPLETE' } };
    },
  });
  await f.bridge.enrollCurrentConversation();
  inventory = await makePersistedInventory(chat, { sessionId, conversationUuid });
  const publishedBeforeSync = publishedSnapshots.length;

  const verified = await f.bridge.verifyPersistedInventory();
  assert.equal(verified.status, 'MATCHED_NON_AUTHORITATIVE');
  assert.equal(verified.authority, 'NON_AUTHORITATIVE');
  assert.equal(verified.host_session_bound, true);
  assert.equal(verified.installation_attestation, false);
  assert.equal(verified.message_count, 2);
  assert.equal(verified.version_count, 2);
  assert.equal(JSON.stringify(verified).includes('private user sentinel'), false);
  assert.equal(JSON.stringify(verified).includes('private assistant sentinel'), false);

  const synced = await f.bridge.syncCurrentDigestInventory();
  assert.equal(synced.status, 'NON_READY');
  assert.equal(publishedSnapshots.length, publishedBeforeSync + 1);
  assert.equal(publishedSnapshots.at(-1).complete, false);

  const mismatched = structuredClone(inventory);
  mismatched.files[0].logical_identity.messages[0].versions[0].content_sha256 = '0'.repeat(64);
  inventory = mismatched;
  const rejected = await f.bridge.verifyPersistedInventory();
  assert.equal(rejected.status, 'NON_READY');
  assert.match(rejected.reason, /version identity or digest differs/);
  const blockedSync = await f.bridge.syncCurrentDigestInventory();
  assert.equal(blockedSync.status, 'NON_READY');
  assert.equal(publishedSnapshots.length, publishedBeforeSync + 1);

  inventory = { ...mismatched, host_session_id: '5e6b0a80-4e73-4c66-aaf3-7a6e62c7f404' };
  const wrongSession = await f.bridge.verifyPersistedInventory();
  assert.equal(wrongSession.status, 'NON_READY');
  assert.match(wrongSession.reason, /not bound to the current authenticated conversation/);
});

test('configured Core publisher receives digest-only baseline, replacement tombstone, and active version in order', async () => {
  const published = [];
  const f = makeFixture([{ is_user: false, mes: 'swipe A', swipes: ['swipe A', 'swipe B'], swipe_id: 0 }], {
    publishDigest: async entry => { published.push(structuredClone(entry)); },
  });
  await f.bridge.enrollCurrentConversation();
  assert.equal(published.length, 2);
  assert.deepEqual(published.map(entry => entry.active), [false, true]);
  assert.ok(published.every(entry => entry.conversation_id === 'chat-1'
    && Object.hasOwn(entry, 'parent_version_id')
    && (entry.parent_version_id === null || typeof entry.parent_version_id === 'string')
    && /^[a-f0-9]{64}$/.test(entry.content_sha256)
    && !Object.keys(entry).some(key => /raw|text_body|content_text|message_body/i.test(key))));
  published.length = 0;

  const oldVersionIds = f.chat[0]._logicEngineLifecycle.versions.map(version => version.versionId);
  await f.bridge.beforeMutation('edit-message', [0]);
  f.chat[0].mes = 'edited answer';
  f.chat[0].swipes = ['edited answer'];
  f.chat[0].swipe_id = 0;
  await f.bridge.afterMutation('edit-message');

  assert.equal(published.length, 3);
  assert.equal(published[0].active, true);
  assert.equal(published[0].deleted, false);
  assert.deepEqual(new Set(published.slice(1).map(entry => entry.version_id)), new Set(oldVersionIds));
  assert.ok(published.slice(1).every(entry => entry.deleted === true && entry.active === false));
  assert.ok(published.every(entry => !JSON.stringify(entry).includes('edited answer')));
});

test('Core publisher emits explicit root lineage and sends parents before newly captured children', async () => {
  const published = [];
  const f = makeFixture([{ is_user: false, mes: 'swipe A', swipes: ['swipe A'], swipe_id: 0 }], {
    publishDigest: async entry => { published.push(structuredClone(entry)); },
  });
  await f.bridge.enrollCurrentConversation();
  const parentId = f.chat[0]._logicEngineLifecycle.versions[0].versionId;
  assert.equal(published[0].parent_version_id, null);
  published.length = 0;

  await f.bridge.beforeMutation('create-swipe', [0]);
  f.chat[0].swipes.push('swipe B');
  f.chat[0].swipe_id = 1;
  f.chat[0].mes = 'swipe B';
  await f.bridge.afterMutation('create-swipe');

  assert.equal(published.length, 2);
  assert.equal(published[0].version_id, parentId);
  assert.equal(published[0].parent_version_id, null);
  assert.equal(published[1].parent_version_id, parentId);
  assert.equal(published[1].active, true);
  assert.equal(published[1].deleted, false);
});

test('digest sync retry replays durable tombstones after a partial failed publication', async () => {
  let fail = false;
  const published = [];
  const f = makeFixture([{ is_user: false, mes: 'swipe A', swipes: ['swipe A', 'swipe B'], swipe_id: 0 }], {
    publishDigest: async entry => {
      if (fail) throw Error('upstream unavailable');
      published.push(structuredClone(entry));
    },
  });
  await f.bridge.enrollCurrentConversation();
  published.length = 0;
  const removedVersionId = f.chat[0]._logicEngineLifecycle.versions[0].versionId;

  await f.bridge.beforeMutation('delete-swipe', [0], { swipeIndex: 0 });
  f.chat[0].swipes.splice(0, 1);
  f.chat[0].mes = 'swipe B';
  f.chat[0].swipe_id = 0;
  fail = true;
  const after = await f.bridge.afterMutation('delete-swipe', { removedSwipeIndex: 0, selectedMessageIndex: 0 });
  assert.equal(after.coreCaptureStatus, 'NON_READY');

  fail = false;
  published.length = 0;
  const retry = await f.bridge.syncCurrentDigestInventory();
  assert.equal(retry.status, 'CAPTURED_REVIEW_ONLY');
  assert.ok(published.some(entry => entry.version_id === removedVersionId
    && entry.deleted === true && entry.active === false));
});

test('Core publisher failure stays NON_READY and can be retried without re-enrolling', async () => {
  let fail = true;
  const f = makeFixture([{ is_user: false, mes: 'hello' }], {
    publishDigest: async () => {
      if (fail) throw Error('upstream contains sensitive details');
    },
  });
  const enrollment = await f.bridge.enrollCurrentConversation();
  assert.equal(enrollment.coreCaptureStatus, 'NON_READY');
  assert.equal(f.saveCount, 1);
  assert.ok(f.chat[0]._logicEngineLifecycle?.messageId);

  fail = false;
  const retry = await f.bridge.syncCurrentDigestInventory();
  assert.equal(retry.status, 'CAPTURED_REVIEW_ONLY');
  assert.equal(retry.published, true);
  assert.equal((await f.bridge.getCoreCaptureStatus()).status, 'CAPTURED_REVIEW_ONLY');
});

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
  for (const path of ['generation-start', 'generation-end', 'generation-stop', 'partial-generation', 'persistence-ordering', 'export', 'copy-branch', 'chat-switch', 'external-edit', 'rollback', 'restart', 'replay']) {
    assert.ok(readiness.missingPaths.includes(path), `expected uncovered lifecycle path: ${path}`);
  }
});

test('message deletion emits digest-only tombstones for every removed version', async () => {
  const f = makeFixture();
  await f.bridge.enrollCurrentConversation();
  const removed = f.chat[0]._logicEngineLifecycle;
  await f.bridge.beforeMutation('delete-message', [0]);
  f.chat.splice(0, 1);
  await f.bridge.afterMutation('delete-message');

  const latest = [...f.db.rows.values()].sort((a, b) => b.sequence - a.sequence)[0];
  assert.equal(latest.operation, 'after:delete-message');
  assert.deepEqual(latest.payload.tombstones.map(v => ({
    messageId: v.messageId, versionId: v.versionId, deleted: v.deleted, active: v.active,
  })), removed.versions.map(v => ({
    messageId: removed.messageId, versionId: v.versionId, deleted: true, active: false,
  })));
  assert.ok(latest.payload.tombstones.every(v => !Object.keys(v).some(key => /text|content|raw/i.test(key))));
});

test('message deletion tombstones survive journal re-open and remain digest-only', async () => {
  const f = makeFixture();
  await f.bridge.enrollCurrentConversation();
  const removed = structuredClone(f.chat[0]._logicEngineLifecycle);
  await f.bridge.beforeMutation('delete-message', [0]);
  f.chat.splice(0, 1);
  await f.bridge.afterMutation('delete-message');

  // Simulate a process restart: instantiate a new journal over the same
  // persisted backing store rather than reusing the in-memory journal object.
  const restartedJournal = new HostLifecycleJournal(f.db);
  const exported = await restartedJournal.exportCaptureLedger('chat-1');
  assert.equal(exported.status, 'REVIEW_ONLY');
  const deletion = exported.records.find(row => row.operation === 'after:delete-message');
  assert.ok(deletion);
  assert.deepEqual(deletion.payload.tombstones.map(v => ({
    messageId: v.messageId, versionId: v.versionId, payloadDigest: v.payloadDigest,
    deleted: v.deleted, active: v.active,
  })), removed.versions.map(v => ({
    messageId: removed.messageId, versionId: v.versionId, payloadDigest: v.payloadDigest,
    deleted: true, active: false,
  })));
  assert.ok(exported.records.every(row =>
    !JSON.stringify(row).includes('hello') && !JSON.stringify(row).includes('answer')));
});

test('swipe deletion emits an explicit tombstone for the removed version identity', async () => {
  const f = makeFixture([{ is_user: false, mes: 'swipe A', swipes: ['swipe A', 'swipe B'], swipe_id: 0 }]);
  await f.bridge.enrollCurrentConversation();
  const identity = f.chat[0]._logicEngineLifecycle;
  const removedVersionId = identity.versions[0].versionId;

  await f.bridge.beforeMutation('delete-swipe', [0], { swipeIndex: 0 });
  f.chat[0].swipes.splice(0, 1);
  f.chat[0].mes = 'swipe B';
  f.chat[0].swipe_id = 0;
  await f.bridge.afterMutation('delete-swipe', { removedSwipeIndex: 0, selectedMessageIndex: 0 });

  const latest = [...f.db.rows.values()].sort((a, b) => b.sequence - a.sequence)[0];
  assert.ok(latest.payload.tombstones.some(v =>
    v.messageId === identity.messageId && v.versionId === removedVersionId
      && v.deleted === true && v.active === false && v.reason === 'swipe-deleted'));
  assert.deepEqual(f.chat[0]._logicEngineLifecycle.versions.map(v => v.versionId), [identity.versions[0].versionId]);
});

test('uncovered server-side lifecycle operations fail closed before a caller mutates source', async () => {
  const f = makeFixture();
  await f.bridge.enrollCurrentConversation();
  const unsupported = [
    'delete-chat', 'delete-group-chat', 'delete-character-chat-recursive',
    'import-character-chat', 'import-group-chat', 'backup-restore', 'create-branch', 'group-metadata-migration',
    'generation-start', 'generation-end', 'generation-stop', 'generation-cancel',
    'partial-generation-finalization', 'regenerate', 'clear-chat', 'chat-switch',
    'export-chat', 'external-edit', 'rollback', 'restart', 'replay', 'persistence-ordering',
  ];
  for (const operation of unsupported) {
    await assert.rejects(
      f.bridge.beforeMutation(operation, []),
      error => error.message.includes('NON_READY: unsupported/uninstrumented Host lifecycle operation ' + operation),
    );
  }
  const readiness = await f.bridge.reconcileCurrentConversation();
  assert.equal(readiness.status, 'NON_READY');
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

test('speaker-label changes are fingerprinted and require an instrumented edit checkpoint', async () => {
  const f = makeFixture();
  await f.bridge.enrollCurrentConversation();
  f.chat[0].name = 'untracked speaker substitution';
  const changed = await f.bridge.reconcileCurrentConversation();
  assert.equal(changed.status, 'NON_READY');
  assert.match(changed.reason, /fingerprint differs/);
  await assert.rejects(f.bridge.beforeMutation('delete-message', [0]), /fingerprint differs/);

  const g = makeFixture();
  await g.bridge.enrollCurrentConversation();
  await g.bridge.beforeMutation('edit-message', [0]);
  g.chat[0].name = 'speaker label changed by supported edit';
  await g.bridge.afterMutation('edit-message');
  await g.bridge.beforeMutation('delete-message', [0]);
});

test('source locator substitution and unverified rename both fail closed before source mutation', async () => {
  const copied = makeFixture();
  await copied.bridge.enrollCurrentConversation();
  copied.setLocator('copied-chat-file');
  const changed = await copied.bridge.reconcileCurrentConversation();
  assert.equal(changed.status, 'NON_READY');
  assert.match(changed.reason, /fingerprint differs/);
  await assert.rejects(copied.bridge.beforeMutation('delete-message', [0]), /fingerprint differs/);

  const renamed = makeFixture();
  await renamed.bridge.enrollCurrentConversation();
  await assert.rejects(
    renamed.bridge.beforeMutation('rename-chat', []),
    /NON_READY: unsupported\/uninstrumented Host lifecycle operation rename-chat/,
  );
  assert.equal(renamed.getLocator(), 'chat-file-1');
});

test('native save failure leaves the journal behind so the next mutation fails closed', async () => {
  const f = makeFixture();
  await f.bridge.enrollCurrentConversation();
  await f.bridge.beforeMutation('edit-message', [0]);
  f.chat[0].mes = 'changed by edit';
  f.setFailSave(true);
  await assert.rejects(f.bridge.afterMutation('edit-message'), /simulated native chat save failure/);
  f.setFailSave(false);
  await assert.rejects(f.bridge.beforeMutation('delete-message', [0]), /previous lifecycle operation is incomplete/);
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

test('unhooked clear-chat fails closed before source mutation', async () => {
  const f = makeFixture();
  await f.bridge.enrollCurrentConversation();
  await assert.rejects(
    f.bridge.beforeMutation('clear-chat', [0, 1]),
    /NON_READY: unsupported\/uninstrumented Host lifecycle operation clear-chat/,
  );
  assert.equal(f.chat.length, 2);
  const readiness = await f.bridge.reconcileCurrentConversation();
  assert.equal(readiness.status, 'NON_READY');
  assert.ok(readiness.missingPaths.includes('clear-chat'));
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

test('new-message reconciliation fails closed when an existing identity is missing', async () => {
  const f = makeFixture();
  await f.bridge.enrollCurrentConversation();
  await f.bridge.beforeMutation('create-message', []);
  const before = await f.journal.verifyIntegrity('chat-1');
  delete f.chat[0]._logicEngineLifecycle;
  f.chat.push({ is_user: false, mes: 'new reply' });

  await assert.rejects(
    f.bridge.afterMutation('create-message', { createdMessageIndex: 2 }),
    /missing durable identity on pre-existing message/,
  );
  const after = await f.journal.verifyIntegrity('chat-1');
  assert.equal(after.sequence, before.sequence);
  assert.equal(f.chat[0]._logicEngineLifecycle, undefined);
});

test('create-message checkpoint refuses to absorb an unhooked edit in earlier messages', async () => {
  const f = makeFixture();
  await f.bridge.enrollCurrentConversation();
  await f.bridge.beforeMutation('create-message', []);
  const before = await f.journal.verifyIntegrity('chat-1');
  f.chat[0].mes = 'external edit before new message';
  f.chat.push({ is_user: false, mes: 'new reply' });

  await assert.rejects(
    f.bridge.afterMutation('create-message', { createdMessageIndex: 2 }),
    /pre-existing source changed before create-message checkpoint/,
  );
  const after = await f.journal.verifyIntegrity('chat-1');
  assert.equal(after.sequence, before.sequence);
});

test('create-message assigns identity only to the explicitly appended tail message', async () => {
  const f = makeFixture();
  await f.bridge.enrollCurrentConversation();
  const oldMessageIds = f.chat.map(message => message._logicEngineLifecycle.messageId);
  await f.bridge.beforeMutation('create-message', []);
  f.chat.push({ is_user: false, mes: 'new reply' });

  const result = await f.bridge.afterMutation('create-message', { createdMessageIndex: 2 });
  assert.equal(result.status, 'REVIEW_ONLY');
  assert.deepEqual(f.chat.slice(0, 2).map(message => message._logicEngineLifecycle.messageId), oldMessageIds);
  assert.ok(f.chat[2]._logicEngineLifecycle.messageId);
});

test('message-send checkpoint records the inserted user message and receive preserves the lineage', async () => {
  const f = makeFixture();
  await f.bridge.enrollCurrentConversation();
  const oldMessageIds = f.chat.map(message => message._logicEngineLifecycle.messageId);

  await f.bridge.beforeMutation('message-send', []);
  f.chat.push({ is_user: true, mes: 'new user turn' });
  const sent = await f.bridge.afterMutation('message-send', { createdMessageIndex: 2 });
  assert.equal(sent.status, 'REVIEW_ONLY');
  assert.deepEqual(f.chat.slice(0, 2).map(message => message._logicEngineLifecycle.messageId), oldMessageIds);
  const sentMessageId = f.chat[2]._logicEngineLifecycle.messageId;

  await f.bridge.beforeMutation('message-receive', []);
  f.chat.push({ is_user: false, mes: 'assistant reply' });
  const received = await f.bridge.afterMutation('message-receive', { createdMessageIndex: 3 });
  assert.equal(received.status, 'REVIEW_ONLY');
  assert.equal(f.chat[2]._logicEngineLifecycle.messageId, sentMessageId);
  assert.ok(f.chat[3]._logicEngineLifecycle.messageId);
});

test('message-send supports insertion at a requested historical index', async () => {
  const f = makeFixture();
  await f.bridge.enrollCurrentConversation();
  const oldMessageIds = f.chat.map(message => message._logicEngineLifecycle.messageId);

  await f.bridge.beforeMutation('message-send', []);
  f.chat.splice(1, 0, { is_user: true, mes: 'inserted in history' });
  const sent = await f.bridge.afterMutation('message-send', { createdMessageIndex: 1 });

  assert.equal(sent.status, 'REVIEW_ONLY');
  assert.equal(f.chat[0]._logicEngineLifecycle.messageId, oldMessageIds[0]);
  assert.equal(f.chat[2]._logicEngineLifecycle.messageId, oldMessageIds[1]);
  assert.ok(f.chat[1]._logicEngineLifecycle.messageId);
  assert.equal((await f.journal.verifyIntegrity('chat-1')).status, 'INTEGRITY_OK');
});

test('reconciliation rejects copied/restored sidecar IDs even when native message content is unchanged', async () => {
  const f = makeFixture();
  await f.bridge.enrollCurrentConversation();
  const originalFingerprint = await f.bridge.currentFingerprint();
  const originalMessageId = f.chat[0]._logicEngineLifecycle.messageId;
  const originalVersionId = f.chat[0]._logicEngineLifecycle.versions[0].versionId;

  // Simulate a copied/restored metadata snapshot whose native message text is
  // identical, so the native-source fingerprint alone cannot detect the swap.
  f.chat[0]._logicEngineLifecycle.messageId = 'copied-message-id';
  f.chat[0]._logicEngineLifecycle.versions[0].versionId = 'copied-version-id';

  assert.equal(await f.bridge.currentFingerprint(), originalFingerprint);
  const result = await f.bridge.reconcileCurrentConversation();
  assert.equal(result.status, 'NON_READY');
  assert.match(result.reason, /identity metadata differs from the last journaled identity snapshot/);

  // Restore the original identities; the same unchanged source should reconcile
  // as integrity-valid, while still remaining NON_READY for incomplete coverage.
  f.chat[0]._logicEngineLifecycle.messageId = originalMessageId;
  f.chat[0]._logicEngineLifecycle.versions[0].versionId = originalVersionId;
  const restored = await f.bridge.reconcileCurrentConversation();
  assert.equal(restored.status, 'NON_READY');
  assert.match(restored.reason, /incomplete mutation instrumentation|native hook coverage/);
});


test('pre-mutation rejects sidecar identity changes even when native content fingerprint is unchanged', async () => {
  const f = makeFixture();
  await f.bridge.enrollCurrentConversation();
  const fingerprint = await f.bridge.currentFingerprint();
  f.chat[0]._logicEngineLifecycle.messageId = 'substituted-message-id';
  assert.equal(await f.bridge.currentFingerprint(), fingerprint);
  await assert.rejects(
    f.bridge.beforeMutation('edit-message', [0]),
    /identity metadata differs from journal/,
  );
});

test('swipe selection records a pre-mutation checkpoint and preserves immutable version IDs', async () => {
  const f = makeFixture([
    {
      is_user: false,
      mes: 'answer A',
      swipes: ['answer A', 'answer B'],
      swipe_id: 0,
    },
  ]);
  await f.bridge.enrollCurrentConversation();
  const beforeIds = f.chat[0]._logicEngineLifecycle.versions.map(version => version.versionId);
  const before = await f.bridge.beforeMutation('select-swipe', [0], { targetSwipeIndex: 1 });
  assert.equal(before.operation, 'before:select-swipe');
  assert.ok(before.eventId);

  // Model the native selection mutation only after the before checkpoint exists.
  f.chat[0].swipe_id = 1;
  f.chat[0].mes = 'answer B';
  const after = await f.bridge.afterMutation('select-swipe', { selectedMessageIndex: 0 });
  assert.equal(after.status, 'REVIEW_ONLY');
  assert.equal(f.chat[0]._logicEngineLifecycle.activeVersionIndex, 1);
  assert.deepEqual(
    f.chat[0]._logicEngineLifecycle.versions.map(version => version.versionId),
    beforeIds,
    'selecting a retained swipe must not mint or rewrite version identity',
  );

  const journalRows = [...f.db.rows.values()].filter(row => row.conversationId === 'chat-1');
  const beforeRow = journalRows.find(row => row.operation === 'before:select-swipe');
  const afterRow = journalRows.find(row => row.operation === 'after:select-swipe');
  assert.ok(beforeRow && afterRow);
  assert.ok(beforeRow.sequence < afterRow.sequence);
});


test('edit/delete checkpoints preserve identity and digests without retaining raw message text', async () => {
  const f = makeFixture();
  await f.bridge.enrollCurrentConversation();

  const oldMessageId = f.chat[1]._logicEngineLifecycle.messageId;
  const oldVersionId = f.chat[1]._logicEngineLifecycle.versions[0].versionId;
  await f.bridge.beforeMutation('edit-message', [1]);
  f.chat[1].mes = 'answer revised';
  await f.bridge.afterMutation('edit-message');

  const ledgerAfterEdit = await f.journal.exportCaptureLedger('chat-1');
  const beforeEdit = ledgerAfterEdit.records.find(row => row.operation === 'before:edit-message');
  const afterEdit = ledgerAfterEdit.records.find(row => row.operation === 'after:edit-message');
  assert.equal(beforeEdit.payload.affectedVersions[0].messageId, oldMessageId);
  assert.equal(beforeEdit.payload.affectedVersions[0].versionId, oldVersionId);
  assert.equal(Object.hasOwn(beforeEdit.payload.affectedVersions[0], 'content'), false);
  assert.ok(beforeEdit.payload.affectedVersions[0].payloadDigest);
  assert.ok(afterEdit.payload.versionPayloads.some(version =>
    version.messageId === oldMessageId &&
    version.parentVersionId === oldVersionId &&
    version.payloadDigest && !Object.hasOwn(version, 'content')
  ));
  const persistedAfterEdit = JSON.stringify([...f.db.rows.values()]);
  const exportedAfterEdit = JSON.stringify(ledgerAfterEdit);
  for (const rawText of ['hello', 'answer', 'answer revised']) {
    assert.equal(persistedAfterEdit.includes(rawText), false, `IndexedDB journal persisted raw message text: ${rawText}`);
    assert.equal(exportedAfterEdit.includes(rawText), false, `capture-ledger export contains raw message text: ${rawText}`);
  }

  await f.bridge.beforeMutation('delete-message', [1]);
  f.chat.splice(1, 1);
  await f.bridge.afterMutation('delete-message');
  const ledgerAfterDelete = await f.journal.exportCaptureLedger('chat-1');
  const beforeDelete = ledgerAfterDelete.records.find(row => row.operation === 'before:delete-message');
  assert.ok(beforeDelete.payload.affectedVersions.some(version => version.payloadDigest));
  assert.ok(beforeDelete.payload.affectedVersions.every(version => !Object.hasOwn(version, 'content')));
  const persistedAfterDelete = JSON.stringify([...f.db.rows.values()]);
  const exportedAfterDelete = JSON.stringify(ledgerAfterDelete);
  for (const rawText of ['hello', 'answer', 'answer revised']) {
    assert.equal(persistedAfterDelete.includes(rawText), false, `IndexedDB journal persisted raw message text after delete: ${rawText}`);
    assert.equal(exportedAfterDelete.includes(rawText), false, `capture-ledger export contains raw message text after delete: ${rawText}`);
  }
  assert.equal(ledgerAfterDelete.preEnrollmentHistory, 'UNKNOWN_UNRECOVERABLE');
  assert.equal(ledgerAfterDelete.status, 'REVIEW_ONLY');
});

test('fresh journal/bridge instances replay the persisted journal rows after restart', async () => {
  const f = makeFixture();
  await f.bridge.enrollCurrentConversation();
  await f.bridge.beforeMutation('edit-message', [0]);
  f.chat[0].mes = 'hello after restart';
  await f.bridge.afterMutation('edit-message');

  const rowsBeforeRestart = [...f.db.rows.values()]
    .filter(row => row.conversationId === 'chat-1')
    .sort((a, b) => a.sequence - b.sequence);
  const headBeforeRestart = f.db.heads.get('chat-1');
  assert.ok(rowsBeforeRestart.length >= 3);
  assert.equal(headBeforeRestart.sequence, rowsBeforeRestart.at(-1).sequence);

  // Simulate process restart by discarding both live objects and reconstructing
  // them over the same persisted backing database. This remains a FakeDB test,
  // not proof of real browser IndexedDB or Android/Termux crash durability.
  const restartedJournal = new HostLifecycleJournal(f.db);
  const restartedBridge = createStLifecycleBridge({
    journal: restartedJournal,
    getConversationId: () => 'chat-1',
    getSourceLocator: () => 'chat-file-1',
    getChat: () => f.chat,
    saveChat: async () => {},
  });
  const integrity = await restartedJournal.verifyIntegrity('chat-1');
  assert.equal(integrity.status, 'INTEGRITY_OK');
  assert.equal(integrity.sequence, headBeforeRestart.sequence);

  const ledger = await restartedJournal.exportCaptureLedger('chat-1');
  assert.equal(ledger.status, 'REVIEW_ONLY');
  assert.deepEqual(
    ledger.records.map(row => [row.sequence, row.eventId, row.recordDigest]),
    rowsBeforeRestart.map(row => [row.sequence, row.eventId, row.recordDigest]),
  );

  const reconciliation = await restartedBridge.reconcileCurrentConversation();
  assert.equal(reconciliation.status, 'NON_READY');
  assert.match(
    reconciliation.reason,
    /incomplete mutation instrumentation|native hook coverage|no trusted pinned-source attestation/,
  );
});

test('unique raw-content sentinels never enter persisted journal rows or exported ledger', async () => {
  const sentinels = [
    'HOST_RAW_CONTENT_SENTINEL_USER_7c9e21',
    'HOST_RAW_CONTENT_SENTINEL_ASSISTANT_4b8a63',
    'HOST_RAW_CONTENT_SENTINEL_EDITED_1d5f90',
  ];
  const f = makeFixture([
    { is_user: true, mes: sentinels[0] },
    { is_user: false, mes: sentinels[1] },
  ]);
  await f.bridge.enrollCurrentConversation();

  await f.bridge.beforeMutation('edit-message', [1]);
  f.chat[1].mes = sentinels[2];
  await f.bridge.afterMutation('edit-message');

  const assertNoRawSentinels = async stage => {
    const persisted = JSON.stringify({
      rows: [...f.db.rows.values()],
      heads: [...f.db.heads.values()],
    });
    const exported = JSON.stringify(await f.journal.exportCaptureLedger('chat-1'));
    for (const sentinel of sentinels) {
      assert.equal(persisted.includes(sentinel), false, `persisted journal contains raw source text at ${stage}: ${sentinel}`);
      assert.equal(exported.includes(sentinel), false, `capture-ledger export contains raw source text at ${stage}: ${sentinel}`);
    }
  };

  await assertNoRawSentinels('after edit');

  await f.bridge.beforeMutation('delete-message', [1]);
  f.chat.splice(1, 1);
  await f.bridge.afterMutation('delete-message');
  await assertNoRawSentinels('after delete');
});


test('Host sends a digest-only Core snapshot through reconcile while explicitly withholding completeness', async () => {
  const observed = [];
  const f = makeFixture(undefined, {
    publishSnapshot: async snapshot => {
      observed.push(structuredClone(snapshot));
      return {
        inventory_status: 'NON_READY',
        reconciliation: { status: 'non_ready', code: 'HOST_INVENTORY_NOT_AUTHORIZED' },
      };
    },
  });
  const enrolled = await f.bridge.enrollCurrentConversation();
  assert.equal(observed.length, 1);
  assert.equal(observed[0].conversation_id, 'chat-1');
  assert.equal(observed[0].complete, false);
  assert.equal(observed[0].versions.length, 2);
  assert.equal(observed[0].versions.every(version =>
    Object.keys(version).sort().join(',') === 'active,content_sha256,deleted,message_id,parent_version_id,version_id'), true);
  assert.equal(JSON.stringify(observed[0]).includes('hello'), false);
  assert.equal(JSON.stringify(observed[0]).includes('answer'), false);
  assert.equal(enrolled.coreCaptureStatus, 'NON_READY');
  assert.equal((await f.bridge.getCoreCaptureStatus()).status, 'NON_READY');
});


test('Core receives a durable prepare before mutation and a matching commit after native persistence', async () => {
  const events = [];
  let remote = { status: 'NO_PENDING_MUTATION' };
  const f = makeFixture(undefined, {
    publishLifecycleEvent: async event => {
      events.push(structuredClone(event));
      if (event.event_type === 'MUTATION_PREPARED') {
        remote = { status: 'PENDING_MUTATION', mutation_id: event.mutation_id, operation: event.operation };
      } else {
        remote = { status: 'NO_PENDING_MUTATION' };
      }
      return { lifecycle: { status: 'appended' } };
    },
    getLifecycleStatus: async () => structuredClone(remote),
  });
  await f.bridge.enrollCurrentConversation();
  const before = await f.bridge.beforeMutation('edit-message', [0]);
  assert.equal(events[0].event_type, 'MUTATION_PREPARED');
  assert.equal(events[0].mutation_id, before.payload.details.hostLifecycle.mutationId);
  assert.match(events[0].mutation_digest, /^[a-f0-9]{64}$/);
  assert.equal(typeof events[0].occurred_at, 'string');
  assert.equal(remote.status, 'PENDING_MUTATION');

  f.chat[0].mes = 'edited and persisted';
  await f.bridge.afterMutation('edit-message');
  assert.equal(events[1].event_type, 'MUTATION_COMMITTED');
  assert.equal(events[1].mutation_id, before.payload.details.hostLifecycle.mutationId);
  assert.equal(events[1].mutation_digest, events[0].mutation_digest);
  assert.equal(events[1].receipt_digest, undefined, 'browser must not submit a trusted persisted-state receipt');
  assert.equal(typeof events[1].occurred_at, 'string');
  assert.equal(events[1].operation, 'edit-message');
  assert.equal(remote.status, 'NO_PENDING_MUTATION');
  assert.equal(JSON.stringify(events).includes('edited and persisted'), false);
});

test('Core pending mutation is recovered by replaying the local durable after receipt after restart', async () => {
  const events = [];
  let remote = { status: 'NO_PENDING_MUTATION' };
  let failCommit = true;
  const f = makeFixture(undefined, {
    publishLifecycleEvent: async event => {
      events.push(structuredClone(event));
      if (event.event_type === 'MUTATION_PREPARED') {
        remote = { status: 'PENDING_MUTATION', mutation_id: event.mutation_id, operation: event.operation };
      } else if (failCommit) {
        throw Error('simulated Core transport interruption after local persistence');
      } else {
        remote = { status: 'NO_PENDING_MUTATION' };
      }
      return { lifecycle: { status: 'appended' } };
    },
    getLifecycleStatus: async () => structuredClone(remote),
  });
  await f.bridge.enrollCurrentConversation();
  const before = await f.bridge.beforeMutation('edit-message', [0]);
  f.chat[0].mes = 'persisted before Core reconnect';
  await assert.rejects(() => f.bridge.afterMutation('edit-message'),
    /Core did not durably accept the completed Host mutation/);
  assert.equal(remote.status, 'PENDING_MUTATION');
  failCommit = false;

  const resumed = await f.bridge.beforeMutation('create-swipe', [0]);
  const commitEvents = events.filter(event => event.event_type === 'MUTATION_COMMITTED');
  assert.equal(commitEvents.length, 2, 'the lost response is retried with the exact persisted event envelope');
  const [firstCommit, replay] = commitEvents;
  assert.deepEqual(replay, firstCommit);
  assert.equal(replay.mutation_id, before.payload.details.hostLifecycle.mutationId);
  assert.equal(replay.mutation_digest, events[0].mutation_digest);
  assert.equal(replay.receipt_digest, undefined, 'replay asks the server to reuse its durable receipt');
  assert.equal(replay.operation, 'edit-message');
  assert.equal(remote.status, 'PENDING_MUTATION');
  assert.equal(resumed.operation, 'before:create-swipe');
});
