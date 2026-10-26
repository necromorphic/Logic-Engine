import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HostVersionDigestLedger } from '../src/application/host-version-digest-ledger.js';

function setup(t, verifyInventorySnapshot = async () => true) {
  const directory = mkdtempSync(join(tmpdir(), 'logic-host-digest-ledger-'));
  const ledger = new HostVersionDigestLedger({
    path: join(directory, 'provider.sqlite'),
    coordinatorPath: join(directory, 'coordinator.sqlite'),
    verifyInventorySnapshot
  });
  t.after(() => {
    try { ledger.close(); } catch {}
    rmSync(directory, { recursive: true, force: true });
  });
  return ledger;
}
const digest = (text) => createHash('sha256').update(text).digest('hex');
const tuple = { world_id: 'world-a', conversation_id: 'chat-a', message_id: 'message-a', version_id: 'version-a' };
const entry = (overrides = {}) => ({
  ...tuple, content_sha256: digest('sample raw message not stored'), active: true, deleted: false, ...overrides
});

test('digest-only capture is idempotent and stores no raw text', (t) => {
  const ledger = setup(t);
  assert.deepEqual(ledger.captureVersion(entry()), { status: 'captured' });
  assert.deepEqual(ledger.captureVersion(entry()), { status: 'duplicate' });
  const row = ledger.db.prepare('SELECT * FROM host_version_digest_ledger').get();
  assert.equal(row.content_sha256, digest('sample raw message not stored'));
  assert.equal(Object.keys(row).some((key) => /content_text|raw_text|message_body/i.test(key)), false);
  assert.equal(ledger.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_records'").get(), undefined);
});

test('digest conflict and NON_READY state survive Provider restart', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-host-digest-ledger-restart-'));
  const path = join(directory, 'provider.sqlite');
  const coordinatorPath = join(directory, 'coordinator.sqlite');
  let ledger = new HostVersionDigestLedger({ path, coordinatorPath, verifyInventorySnapshot: async () => true });
  ledger.captureVersion(entry());
  ledger.captureVersion(entry({ content_sha256: digest('conflicting durable bytes') }));
  ledger.close();

  ledger = new HostVersionDigestLedger({ path, coordinatorPath, verifyInventorySnapshot: async () => true });
  assert.equal(ledger.getInventoryState(tuple.world_id, tuple.conversation_id).status, 'NON_READY');
  assert.equal(ledger.db.prepare('SELECT version_id FROM host_version_active_pointer').get().version_id, 'version-a');
  t.after(() => {
    try { ledger.close(); } catch {}
    rmSync(directory, { recursive: true, force: true });
  });
});

test('same identity with different digest records conflict and forces NON_READY', (t) => {
  const ledger = setup(t);
  ledger.captureVersion(entry());
  assert.deepEqual(ledger.captureVersion(entry({ content_sha256: digest('different bytes') })),
    { status: 'conflict', code: 'HOST_VERSION_DIGEST_CONFLICT' });
  assert.equal(ledger.getInventoryState(tuple.world_id, tuple.conversation_id).status, 'NON_READY');
});

test('conflicting digest cannot change the active pointer before NON_READY', (t) => {
  const ledger = setup(t);
  ledger.captureVersion(entry());
  ledger.captureVersion(entry({
    version_id: 'version-b', content_sha256: digest('second version'), active: false
  }));
  assert.equal(ledger.db.prepare('SELECT version_id FROM host_version_active_pointer').get().version_id, 'version-a');

  assert.deepEqual(ledger.captureVersion(entry({
    version_id: 'version-b', content_sha256: digest('conflicting bytes'), active: true
  })), { status: 'conflict', code: 'HOST_VERSION_DIGEST_CONFLICT' });

  assert.equal(ledger.getInventoryState(tuple.world_id, tuple.conversation_id).status, 'NON_READY');
  assert.equal(ledger.db.prepare('SELECT version_id FROM host_version_active_pointer').get().version_id, 'version-a');
});

test('active selection preserves alternatives and exact tombstone does not delete another version', (t) => {
  const ledger = setup(t);
  ledger.captureVersion(entry());
  ledger.captureVersion(entry({ version_id: 'version-b', content_sha256: digest('second'), active: false }));
  assert.deepEqual(ledger.selectActiveVersion({ ...tuple, version_id: 'version-b' }), { status: 'selected' });
  assert.equal(ledger.db.prepare('SELECT COUNT(*) AS n FROM host_version_digest_ledger').get().n, 2);
  assert.equal(ledger.db.prepare('SELECT version_id FROM host_version_active_pointer').get().version_id, 'version-b');
  assert.deepEqual(ledger.tombstoneVersion(tuple), { status: 'tombstoned' });
  assert.equal(ledger.db.prepare("SELECT lifecycle FROM host_version_digest_ledger WHERE version_id='version-b'").get().lifecycle, 'present');
});

test('untrusted inventory snapshot cannot make ledger ready', async (t) => {
  const ledger = setup(t, async () => false);
  assert.deepEqual(await ledger.reconcileConversation({
    world_id: tuple.world_id, conversation_id: tuple.conversation_id, complete: true, versions: [entry()]
  }), { status: 'non_ready', code: 'HOST_INVENTORY_NOT_AUTHORIZED' });
  assert.equal(ledger.db.prepare('SELECT COUNT(*) AS n FROM host_version_digest_ledger').get().n, 0);
  assert.equal(ledger.getInventoryState(tuple.world_id, tuple.conversation_id), null);
});

test('trusted complete snapshot recovers missed capture and publishes readiness', async (t) => {
  const ledger = setup(t, async (snapshot) => snapshot.complete === true);
  const result = await ledger.reconcileConversation({
    world_id: tuple.world_id, conversation_id: tuple.conversation_id, complete: true, versions: [entry()]
  });
  assert.equal(result.status, 'ready');
  assert.equal(ledger.db.prepare('SELECT version_id FROM host_version_active_pointer').get().version_id, tuple.version_id);
});

test('known version disappearance from full snapshot fails closed', async (t) => {
  const ledger = setup(t);
  ledger.captureVersion(entry());
  assert.deepEqual(await ledger.reconcileConversation({
    world_id: tuple.world_id, conversation_id: tuple.conversation_id, complete: true, versions: []
  }), { status: 'non_ready', code: 'HOST_INVENTORY_DISAPPEARANCE' });
  assert.equal(ledger.getInventoryState(tuple.world_id, tuple.conversation_id).status, 'NON_READY');
});

test('complete snapshot rejects a deleted version marked active', async (t) => {
  const ledger = setup(t);
  const result = await ledger.reconcileConversation({
    world_id: tuple.world_id, conversation_id: tuple.conversation_id, complete: true,
    versions: [entry({ deleted: true, active: true })]
  });
  assert.deepEqual(result, {
    status: 'non_ready', code: 'HOST_INVENTORY_DELETED_VERSION_ACTIVE'
  });
  assert.equal(ledger.db.prepare('SELECT COUNT(*) AS n FROM host_version_digest_ledger').get().n, 0);
  assert.equal(ledger.getInventoryState(tuple.world_id, tuple.conversation_id), null);
});

test('duplicate identities in a snapshot are rejected', async (t) => {
  const ledger = setup(t);
  assert.deepEqual(await ledger.reconcileConversation({
    world_id: tuple.world_id, conversation_id: tuple.conversation_id, complete: true, versions: [entry(), entry()]
  }), { status: 'non_ready', code: 'HOST_INVENTORY_DUPLICATE_IDENTITY' });
});

test('snapshot conflict is preflighted before any earlier version from that snapshot is applied', async (t) => {
  const ledger = setup(t);
  ledger.captureVersion(entry());
  const newEntry = entry({ message_id: 'message-b', version_id: 'version-b', content_sha256: digest('new'), active: true });
  const conflict = entry({ content_sha256: digest('mutated bytes') });
  const result = await ledger.reconcileConversation({
    world_id: tuple.world_id, conversation_id: tuple.conversation_id, complete: true,
    versions: [newEntry, conflict]
  });
  assert.deepEqual(result, { status: 'non_ready', code: 'HOST_VERSION_DIGEST_CONFLICT' });
  assert.equal(ledger.db.prepare("SELECT COUNT(*) AS n FROM host_version_digest_ledger WHERE message_id='message-b'").get().n, 0);
  assert.equal(ledger.getInventoryState(tuple.world_id, tuple.conversation_id).status, 'NON_READY');
});

test('snapshot with two active versions for one message is rejected', async (t) => {
  const ledger = setup(t);
  const result = await ledger.reconcileConversation({
    world_id: tuple.world_id, conversation_id: tuple.conversation_id, complete: true,
    versions: [entry(), entry({ version_id: 'version-b', content_sha256: digest('second'), active: true })]
  });
  assert.deepEqual(result, { status: 'non_ready', code: 'HOST_INVENTORY_MULTIPLE_ACTIVE_VERSIONS' });
  assert.equal(ledger.db.prepare('SELECT COUNT(*) AS n FROM host_version_digest_ledger').get().n, 0);
  assert.equal(ledger.getInventoryState(tuple.world_id, tuple.conversation_id), null);
});

test('trusted snapshot rebuild clears a stale active pointer when no version is active', async (t) => {
  const ledger = setup(t);
  ledger.captureVersion(entry());
  const result = await ledger.reconcileConversation({
    world_id: tuple.world_id, conversation_id: tuple.conversation_id, complete: true,
    versions: [entry({ active: false })]
  });
  assert.equal(result.status, 'ready');
  assert.equal(ledger.db.prepare('SELECT COUNT(*) AS n FROM host_version_active_pointer').get().n, 0);
});

test('tombstoned version reappearance marks conversation NON_READY', async (t) => {
  const ledger = setup(t);
  ledger.captureVersion(entry());
  ledger.tombstoneVersion(tuple);
  const result = await ledger.reconcileConversation({
    world_id: tuple.world_id, conversation_id: tuple.conversation_id, complete: true, versions: [entry()]
  });
  assert.deepEqual(result, { status: 'non_ready', code: 'HOST_TOMBSTONE_REAPPEARED' });
  assert.equal(ledger.getInventoryState(tuple.world_id, tuple.conversation_id).status, 'NON_READY');
});

test('ledger mutations after READY invalidate the published inventory state', async (t) => {
  const ledger = setup(t, async () => true);
  const snapshot = (versions) => ({
    world_id: tuple.world_id, conversation_id: tuple.conversation_id, complete: true, versions
  });
  assert.equal((await ledger.reconcileConversation(snapshot([entry()]))).status, 'ready');

  ledger.captureVersion(entry({
    message_id: 'message-b', version_id: 'version-b', content_sha256: digest('second'), active: false
  }));
  assert.equal(ledger.getInventoryState(tuple.world_id, tuple.conversation_id).status, 'NON_READY');
  assert.equal(ledger.getInventoryState(tuple.world_id, tuple.conversation_id).failure_code,
    'HOST_LEDGER_MUTATED_AFTER_RECONCILIATION');

  assert.equal((await ledger.reconcileConversation(snapshot([entry(), entry({
    message_id: 'message-b', version_id: 'version-b', content_sha256: digest('second'), active: false
  })]))).status, 'ready');
  ledger.selectActiveVersion({ ...tuple, message_id: 'message-b', version_id: 'version-b' });
  assert.equal(ledger.getInventoryState(tuple.world_id, tuple.conversation_id).status, 'NON_READY');

  assert.equal((await ledger.reconcileConversation(snapshot([entry(), entry({
    message_id: 'message-b', version_id: 'version-b', content_sha256: digest('second'), active: false
  })]))).status, 'ready');
  ledger.tombstoneVersion(tuple);
  assert.equal(ledger.getInventoryState(tuple.world_id, tuple.conversation_id).status, 'NON_READY');
});

test('identical concurrent reconciliations converge to READY', async (t) => {
  let enteredCount = 0;
  let release;
  const enteredPromise = new Promise((resolve) => { release = resolve; });
  let unblock;
  const gate = new Promise((resolve) => { unblock = resolve; });
  const ledger = setup(t, async () => {
    enteredCount += 1;
    if (enteredCount === 2) release();
    await gate;
    return true;
  });
  const snapshot = { world_id: tuple.world_id, conversation_id: tuple.conversation_id, complete: true, versions: [entry()] };
  const first = ledger.reconcileConversation(snapshot);
  const second = ledger.reconcileConversation(snapshot);
  await enteredPromise;
  unblock();
  const results = await Promise.all([first, second]);
  assert.deepEqual(results.map((x) => x.status), ['ready', 'ready']);
  assert.equal(ledger.getInventoryState(tuple.world_id, tuple.conversation_id).status, 'READY');
});

test('reconciliation cannot republish READY after a concurrent digest conflict', async (t) => {
  let blockVerification = false;
  let entered;
  let release;
  const enteredPromise = new Promise((resolve) => { entered = resolve; });
  const releasePromise = new Promise((resolve) => { release = resolve; });
  const ledger = setup(t, async () => {
    if (blockVerification) {
      entered();
      await releasePromise;
    }
    return true;
  });
  const snapshot = {
    world_id: tuple.world_id, conversation_id: tuple.conversation_id, complete: true, versions: [entry()]
  };
  assert.equal((await ledger.reconcileConversation(snapshot)).status, 'ready');

  blockVerification = true;
  const pending = ledger.reconcileConversation(snapshot);
  await enteredPromise;
  assert.deepEqual(ledger.captureVersion(entry({
    content_sha256: digest('concurrent conflicting digest')
  })), { status: 'conflict', code: 'HOST_VERSION_DIGEST_CONFLICT' });
  release();

  assert.deepEqual(await pending, {
    status: 'non_ready', code: 'HOST_LEDGER_CHANGED_DURING_VERIFICATION'
  });
  assert.equal(ledger.getInventoryState(tuple.world_id, tuple.conversation_id).status, 'NON_READY');
  assert.equal(ledger.getInventoryState(tuple.world_id, tuple.conversation_id).failure_code,
    'HOST_LEDGER_CHANGED_DURING_VERIFICATION');
});

test('reconciliation cannot republish READY after a concurrent unknown tombstone', async (t) => {
  let blockVerification = false;
  let entered;
  let release;
  const enteredPromise = new Promise((resolve) => { entered = resolve; });
  const releasePromise = new Promise((resolve) => { release = resolve; });
  const ledger = setup(t, async () => {
    if (blockVerification) {
      entered();
      await releasePromise;
    }
    return true;
  });
  const snapshot = {
    world_id: tuple.world_id, conversation_id: tuple.conversation_id, complete: true, versions: [entry()]
  };
  assert.equal((await ledger.reconcileConversation(snapshot)).status, 'ready');

  blockVerification = true;
  const pending = ledger.reconcileConversation(snapshot);
  await enteredPromise;
  assert.deepEqual(ledger.tombstoneVersion({
    ...tuple, message_id: 'missing-message', version_id: 'missing-version'
  }), { status: 'non_ready', code: 'HOST_VERSION_UNKNOWN' });
  release();

  assert.deepEqual(await pending, {
    status: 'non_ready', code: 'HOST_LEDGER_CHANGED_DURING_VERIFICATION'
  });
  assert.equal(ledger.getInventoryState(tuple.world_id, tuple.conversation_id).status, 'NON_READY');
  assert.equal(ledger.getInventoryState(tuple.world_id, tuple.conversation_id).failure_code,
    'HOST_LEDGER_CHANGED_DURING_VERIFICATION');
});

test('reconciliation rejects if ledger changes while the verifier is awaiting', async (t) => {
  let entered;
  let release;
  const enteredPromise = new Promise((resolve) => { entered = resolve; });
  const releasePromise = new Promise((resolve) => { release = resolve; });
  const ledger = setup(t, async () => {
    entered();
    await releasePromise;
    return true;
  });
  const snapshot = {
    world_id: tuple.world_id, conversation_id: tuple.conversation_id, complete: true, versions: [entry()]
  };
  const pending = ledger.reconcileConversation(snapshot);
  await enteredPromise;
  ledger.captureVersion(entry({
    message_id: 'concurrent-message', version_id: 'concurrent-version',
    content_sha256: digest('concurrent'), active: false
  }));
  release();
  assert.deepEqual(await pending, {
    status: 'non_ready', code: 'HOST_LEDGER_CHANGED_DURING_VERIFICATION'
  });
  assert.equal(ledger.getInventoryState(tuple.world_id, tuple.conversation_id).status, 'NON_READY');
  assert.equal(ledger.db.prepare("SELECT COUNT(*) AS n FROM host_version_digest_ledger WHERE message_id='message-a'").get().n, 0);
});

test('verifier failure rejects the request without letting untrusted input mutate prior readiness', async (t) => {
  let reject = false;
  const ledger = setup(t, async () => {
    if (reject) throw new Error('verifier unavailable');
    return true;
  });
  const snapshot = { world_id: tuple.world_id, conversation_id: tuple.conversation_id, complete: true, versions: [entry()] };
  assert.equal((await ledger.reconcileConversation(snapshot)).status, 'ready');
  const before = ledger.getInventoryState(tuple.world_id, tuple.conversation_id);
  reject = true;
  assert.deepEqual(await ledger.reconcileConversation(snapshot), {
    status: 'non_ready', code: 'HOST_INVENTORY_NOT_AUTHORIZED'
  });
  const after = ledger.getInventoryState(tuple.world_id, tuple.conversation_id);
  assert.equal(after.status, 'READY');
  assert.equal(after.updated_at, before.updated_at);
  assert.equal(after.snapshot_digest, before.snapshot_digest);
  // The failed call itself is non-ready. Consumers must use that result and
  // must not infer authorization from a previously published state alone.
});

test('ledger identity and tombstone survive process-style close and reopen', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-host-digest-restart-'));
  const path = join(directory, 'provider.sqlite');
  const coordinatorPath = join(directory, 'coordinator.sqlite');
  let ledger = new HostVersionDigestLedger({ path, coordinatorPath, verifyInventorySnapshot: async () => true });
  ledger.captureVersion(entry());
  ledger.tombstoneVersion(tuple);
  ledger.close();
  ledger = new HostVersionDigestLedger({ path, coordinatorPath, verifyInventorySnapshot: async () => true });
  try {
    const row = ledger.db.prepare('SELECT lifecycle,content_sha256 FROM host_version_digest_ledger WHERE world_id=? AND conversation_id=? AND message_id=? AND version_id=?')
      .get(...[tuple.world_id, tuple.conversation_id, tuple.message_id, tuple.version_id]);
    assert.equal(row.lifecycle, 'tombstoned');
    assert.equal(row.content_sha256, digest('sample raw message not stored'));
    assert.equal(ledger.selectActiveVersion(tuple).code, 'HOST_VERSION_UNAVAILABLE');
  } finally {
    ledger.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rejected caller snapshot cannot mutate a previously verified readiness record', async (t) => {
  const ledger = setup(t, async () => true);
  const snapshot = { world_id: tuple.world_id, conversation_id: tuple.conversation_id, complete: true, versions: [entry()] };
  assert.equal((await ledger.reconcileConversation(snapshot)).status, 'ready');
  const before = ledger.getInventoryState(tuple.world_id, tuple.conversation_id);
  const result = await ledger.reconcileConversation({
    ...snapshot,
    versions: [entry(), entry({ version_id: 'version-b', content_sha256: digest('second'), active: true })]
  });
  assert.deepEqual(result, { status: 'non_ready', code: 'HOST_INVENTORY_MULTIPLE_ACTIVE_VERSIONS' });
  const after = ledger.getInventoryState(tuple.world_id, tuple.conversation_id);
  assert.equal(after.status, 'READY');
  assert.equal(after.updated_at, before.updated_at);
  assert.equal(after.snapshot_digest, before.snapshot_digest);
});

test('unknown tombstone invalidates previously READY inventory', async (t) => {
  const ledger = setup(t, async () => true);
  const snapshot = {
    world_id: tuple.world_id, conversation_id: tuple.conversation_id, complete: true, versions: [entry()]
  };
  assert.equal((await ledger.reconcileConversation(snapshot)).status, 'ready');

  const result = ledger.tombstoneVersion({
    ...tuple, message_id: 'message-not-captured', version_id: 'version-not-captured'
  });
  assert.deepEqual(result, { status: 'non_ready', code: 'HOST_VERSION_UNKNOWN' });
  assert.equal(ledger.getInventoryState(tuple.world_id, tuple.conversation_id).status, 'NON_READY');
  assert.equal(ledger.getInventoryState(tuple.world_id, tuple.conversation_id).failure_code, 'HOST_VERSION_UNKNOWN');
});

test('unavailable swipe selection invalidates previously READY inventory', async (t) => {
  const ledger = setup(t, async () => true);
  const snapshot = {
    world_id: tuple.world_id, conversation_id: tuple.conversation_id, complete: true, versions: [entry()]
  };
  assert.equal((await ledger.reconcileConversation(snapshot)).status, 'ready');

  const result = ledger.selectActiveVersion({
    ...tuple, message_id: 'message-not-captured', version_id: 'version-not-captured'
  });
  assert.deepEqual(result, { status: 'non_ready', code: 'HOST_VERSION_UNAVAILABLE' });
  assert.equal(ledger.getInventoryState(tuple.world_id, tuple.conversation_id).status, 'NON_READY');
  assert.equal(ledger.getInventoryState(tuple.world_id, tuple.conversation_id).failure_code, 'HOST_VERSION_UNAVAILABLE');
});

test('capture updates active pointer when an existing swipe active flag changes', async (t) => {
  const ledger = setup(t, async () => true);
  const active = entry({ active: true });
  const snapshot = {
    world_id: tuple.world_id, conversation_id: tuple.conversation_id, complete: true, versions: [active]
  };
  assert.equal((await ledger.reconcileConversation(snapshot)).status, 'ready');
  assert.equal(ledger.db.prepare('SELECT version_id FROM host_version_active_pointer WHERE world_id=? AND conversation_id=? AND message_id=?')
    .get(tuple.world_id, tuple.conversation_id, tuple.message_id).version_id, tuple.version_id);

  assert.equal(ledger.captureVersion({ ...active, active: false }).status, 'duplicate');
  assert.equal(ledger.getInventoryState(tuple.world_id, tuple.conversation_id).status, 'NON_READY');
  assert.equal(ledger.db.prepare('SELECT version_id FROM host_version_active_pointer WHERE world_id=? AND conversation_id=? AND message_id=?')
    .get(tuple.world_id, tuple.conversation_id, tuple.message_id), undefined);

  const inactive = { ...active, active: false };
  assert.equal((await ledger.reconcileConversation({ ...snapshot, versions: [inactive] })).status, 'ready');
  assert.equal(ledger.captureVersion(active).status, 'duplicate');
  assert.equal(ledger.getInventoryState(tuple.world_id, tuple.conversation_id).status, 'NON_READY');
  assert.equal(ledger.db.prepare('SELECT version_id FROM host_version_active_pointer WHERE world_id=? AND conversation_id=? AND message_id=?')
    .get(tuple.world_id, tuple.conversation_id, tuple.message_id).version_id, tuple.version_id);
});

test('event-only capture cannot introduce a previously unknown tombstone', async (t) => {
  const ledger = setup(t, async () => true);
  const baseline = {
    world_id: tuple.world_id, conversation_id: tuple.conversation_id, complete: true, versions: [entry()]
  };
  assert.equal((await ledger.reconcileConversation(baseline)).status, 'ready');

  const unknownTombstone = entry({
    message_id: 'message-never-captured',
    version_id: 'version-never-captured',
    content_sha256: digest('unknown deleted source'),
    active: false,
    deleted: true,
  });
  assert.deepEqual(ledger.captureVersion(unknownTombstone), {
    status: 'non_ready', code: 'HOST_VERSION_UNKNOWN'
  });
  assert.equal(ledger.db.prepare('SELECT COUNT(*) AS n FROM host_version_digest_ledger').get().n, 1);
  assert.equal(ledger.db.prepare("SELECT COUNT(*) AS n FROM host_version_digest_ledger WHERE message_id='message-never-captured'").get().n, 0);
  assert.equal(ledger.getInventoryState(tuple.world_id, tuple.conversation_id).status, 'NON_READY');
  assert.equal(ledger.getInventoryState(tuple.world_id, tuple.conversation_id).failure_code, 'HOST_VERSION_UNKNOWN');
});

test('inventory mutation while trust verification awaits cannot add unverified rows', async (t) => {
  let entered;
  let release;
  const enteredPromise = new Promise((resolve) => { entered = resolve; });
  const releasePromise = new Promise((resolve) => { release = resolve; });
  const ledger = setup(t, async (verifiedSnapshot) => {
    entered();
    await releasePromise;
    return verifiedSnapshot.versions.length === 1;
  });
  const snapshot = {
    world_id: tuple.world_id,
    conversation_id: tuple.conversation_id,
    complete: true,
    versions: [entry()],
  };

  const pending = ledger.reconcileConversation(snapshot);
  await enteredPromise;
  snapshot.versions.push(entry({
    message_id: 'injected-message',
    version_id: 'injected-version',
    content_sha256: digest('not covered by verifier'),
    active: false,
  }));
  release();

  assert.equal((await pending).status, 'ready');
  assert.equal(ledger.db.prepare('SELECT COUNT(*) AS n FROM host_version_digest_ledger').get().n, 1);
  assert.equal(ledger.db.prepare("SELECT COUNT(*) AS n FROM host_version_digest_ledger WHERE message_id='injected-message'").get().n, 0);
  assert.equal(ledger.getInventoryState(tuple.world_id, tuple.conversation_id).status, 'READY');
});

test('event-only capture rejects a deleted version that is also marked active', async (t) => {
  const ledger = setup(t, async () => true);
  const active = entry();
  const snapshot = {
    world_id: tuple.world_id, conversation_id: tuple.conversation_id, complete: true, versions: [active]
  };
  assert.equal((await ledger.reconcileConversation(snapshot)).status, 'ready');

  assert.deepEqual(ledger.captureVersion({ ...active, deleted: true, active: true }), {
    status: 'non_ready', code: 'HOST_VERSION_DELETED_ACTIVE'
  });
  assert.equal(ledger.db.prepare('SELECT lifecycle FROM host_version_digest_ledger WHERE version_id=?').get(tuple.version_id).lifecycle, 'present');
  assert.equal(ledger.db.prepare('SELECT version_id FROM host_version_active_pointer WHERE message_id=?').get(tuple.message_id).version_id, tuple.version_id);
  assert.equal(ledger.getInventoryState(tuple.world_id, tuple.conversation_id).status, 'NON_READY');
  assert.equal(ledger.getInventoryState(tuple.world_id, tuple.conversation_id).failure_code, 'HOST_VERSION_DELETED_ACTIVE');
});

test('complete inventory cannot silently omit a previously tombstoned version', async (t) => {
  const ledger = setup(t, async () => true);
  assert.equal(ledger.captureVersion(entry()).status, 'captured');
  assert.equal((await ledger.reconcileConversation({
    world_id: tuple.world_id, conversation_id: tuple.conversation_id, complete: true, versions: [entry()]
  })).status, 'ready');
  assert.deepEqual(ledger.tombstoneVersion(tuple), { status: 'tombstoned' });
  assert.equal(ledger.getInventoryState(tuple.world_id, tuple.conversation_id).status, 'NON_READY');

  const result = await ledger.reconcileConversation({
    world_id: tuple.world_id,
    conversation_id: tuple.conversation_id,
    complete: true,
    versions: [],
  });
  assert.deepEqual(result, { status: 'non_ready', code: 'HOST_INVENTORY_DISAPPEARANCE' });
  assert.equal(ledger.db.prepare('SELECT lifecycle FROM host_version_digest_ledger WHERE version_id=?').get(tuple.version_id).lifecycle, 'tombstoned');
  assert.equal(ledger.getInventoryState(tuple.world_id, tuple.conversation_id).status, 'NON_READY');
  assert.equal(ledger.getInventoryState(tuple.world_id, tuple.conversation_id).failure_code, 'HOST_INVENTORY_DISAPPEARANCE');
});

test('review-only Host projection cannot be accepted as a trusted Provider inventory', async (t) => {
  const ledger = setup(t, async () => true);
  const reviewOnlyProjection = {
    status: 'REVIEW_ONLY',
    authority: 'NON_AUTHORITATIVE',
    rows: [],
    completeness: 'UNPROVEN',
    blockers: ['CORE_WORLD_BINDING_MISSING', 'COMPLETE_NATIVE_INVENTORY_UNPROVEN'],
  };
  assert.deepEqual(await ledger.reconcileConversation(reviewOnlyProjection), {
    status: 'non_ready', code: 'HOST_INVENTORY_INCOMPLETE'
  });
  assert.equal(ledger.db.prepare('SELECT COUNT(*) AS n FROM host_version_digest_ledger').get().n, 0);
});

test('malformed inventory cannot poison readiness for a caller-selected conversation', async (t) => {
  const ledger = setup(t, async () => true);
  const victim = { world_id: 'world-victim', conversation_id: 'chat-victim' };
  const victimEntry = entry({ ...victim, message_id: 'victim-message', version_id: 'victim-version' });

  assert.deepEqual(await ledger.reconcileConversation({
    ...victim,
    complete: true,
    versions: [victimEntry],
  }), { status: 'ready', version_count: 1 });
  assert.equal(ledger.getInventoryState(victim.world_id, victim.conversation_id).status, 'READY');

  const malformed = await ledger.reconcileConversation({
    ...victim,
    complete: false,
    versions: [],
  });

  assert.deepEqual(malformed, { status: 'non_ready', code: 'HOST_INVENTORY_INCOMPLETE' });
  assert.equal(ledger.getInventoryState(victim.world_id, victim.conversation_id).status, 'READY');
  assert.equal(ledger.db.prepare('SELECT COUNT(*) AS n FROM host_version_digest_ledger WHERE world_id=? AND conversation_id=?')
    .get(victim.world_id, victim.conversation_id).n, 1);
});

