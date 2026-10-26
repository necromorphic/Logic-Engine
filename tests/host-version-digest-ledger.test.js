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

test('same identity with different digest records conflict and forces NON_READY', (t) => {
  const ledger = setup(t);
  ledger.captureVersion(entry());
  assert.deepEqual(ledger.captureVersion(entry({ content_sha256: digest('different bytes') })),
    { status: 'conflict', code: 'HOST_VERSION_DIGEST_CONFLICT' });
  assert.equal(ledger.getInventoryState(tuple.world_id, tuple.conversation_id).status, 'NON_READY');
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

test('duplicate identities in a snapshot are rejected', async (t) => {
  const ledger = setup(t);
  assert.deepEqual(await ledger.reconcileConversation({
    world_id: tuple.world_id, conversation_id: tuple.conversation_id, complete: true, versions: [entry(), entry()]
  }), { status: 'non_ready', code: 'HOST_INVENTORY_DUPLICATE_IDENTITY' });
});
