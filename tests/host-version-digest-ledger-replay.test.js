import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HostVersionDigestLedger } from '../src/application/host-version-digest-ledger.js';

const digest = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

test('replaying the identical trusted complete Host snapshot is idempotent', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-host-snapshot-replay-'));
  const worldId = 'snapshot-replay-world';
  const conversationId = 'snapshot-replay-conversation';
  const ledger = new HostVersionDigestLedger({
    path: join(directory, 'host-ledger.sqlite'),
    coordinatorPath: join(directory, 'coordinator.sqlite'),
    verifyInventorySnapshot: async (snapshot) => snapshot.complete === true,
  });
  t.after(() => {
    try { ledger.close(); } catch {}
    rmSync(directory, { recursive: true, force: true });
  });

  const snapshot = {
    world_id: worldId,
    conversation_id: conversationId,
    complete: true,
    versions: [{
      world_id: worldId,
      conversation_id: conversationId,
      message_id: 'message-a',
      version_id: 'version-a',
      parent_version_id: null,
      content_sha256: digest('digest-only host version'),
      active: true,
      deleted: false,
    }],
  };

  const first = await ledger.reconcileConversation(snapshot);
  const firstAnchor = ledger.monotonicAnchor.current(worldId, conversationId);
  assert.equal(first.status, 'ready');
  assert.equal(first.version_count, 1);
  assert.equal(firstAnchor.generation, 1);

  const replay = await ledger.reconcileConversation(snapshot);
  const replayAnchor = ledger.monotonicAnchor.current(worldId, conversationId);

  assert.deepEqual(replay, first);
  assert.deepEqual(replayAnchor, firstAnchor,
    'an identical snapshot replay must not advance the monotonic generation');
  assert.equal(ledger.db.prepare(
    'SELECT COUNT(*) AS count FROM host_version_digest_ledger WHERE world_id=? AND conversation_id=?',
  ).get(worldId, conversationId).count, 1);
  assert.equal(ledger.db.prepare(
    'SELECT version_id FROM host_version_active_pointer WHERE world_id=? AND conversation_id=? AND message_id=?',
  ).get(worldId, conversationId, 'message-a').version_id, 'version-a');
  assert.equal(ledger.getInventoryState(worldId, conversationId).status, 'READY');
});


test('a complete snapshot tombstones only the deleted version and preserves its sibling', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-host-snapshot-tombstone-'));
  const worldId = 'snapshot-tombstone-world';
  const conversationId = 'snapshot-tombstone-conversation';
  const ledger = new HostVersionDigestLedger({
    path: join(directory, 'host-ledger.sqlite'),
    coordinatorPath: join(directory, 'coordinator.sqlite'),
    verifyInventorySnapshot: async (snapshot) => snapshot.complete === true,
  });
  t.after(() => {
    try { ledger.close(); } catch {}
    rmSync(directory, { recursive: true, force: true });
  });

  const root = {
    world_id: worldId,
    conversation_id: conversationId,
    message_id: 'message-a',
    version_id: 'version-a',
    parent_version_id: null,
    content_sha256: digest('root version'),
    active: false,
    deleted: false,
  };
  const selected = {
    ...root,
    version_id: 'version-b',
    parent_version_id: 'version-a',
    content_sha256: digest('selected version'),
    active: true,
  };

  const initial = await ledger.reconcileConversation({
    world_id: worldId, conversation_id: conversationId, complete: true,
    versions: [root, selected],
  });
  assert.equal(initial.status, 'ready');

  const deletedSnapshot = await ledger.reconcileConversation({
    world_id: worldId, conversation_id: conversationId, complete: true,
    versions: [
      { ...root, active: true },
      { ...selected, active: false, deleted: true },
    ],
  });

  assert.equal(deletedSnapshot.status, 'ready');
  assert.equal(ledger.db.prepare(
    'SELECT lifecycle FROM host_version_digest_ledger WHERE world_id=? AND conversation_id=? AND message_id=? AND version_id=?',
  ).get(worldId, conversationId, 'message-a', 'version-a').lifecycle, 'present');
  assert.equal(ledger.db.prepare(
    'SELECT lifecycle FROM host_version_digest_ledger WHERE world_id=? AND conversation_id=? AND message_id=? AND version_id=?',
  ).get(worldId, conversationId, 'message-a', 'version-b').lifecycle, 'tombstoned');
  assert.equal(ledger.db.prepare(
    'SELECT version_id FROM host_version_active_pointer WHERE world_id=? AND conversation_id=? AND message_id=?',
  ).get(worldId, conversationId, 'message-a').version_id, 'version-a');
  assert.equal(ledger.db.prepare(
    'SELECT COUNT(*) AS count FROM host_version_digest_ledger WHERE world_id=? AND conversation_id=?',
  ).get(worldId, conversationId).count, 2);
});
