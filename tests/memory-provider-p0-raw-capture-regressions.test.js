import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteMemoryProvider } from '../src/application/sqlite-memory-provider.js';

function makeProvider(path, options = {}) {
  return new SQLiteMemoryProvider({
    path,
    getSnapshot: async () => ({ world_revision: 1, commit_sequence: 1 }),
    validateSourceVersion: async () => true,
    validateInventory: async () => true,
    ...options,
  });
}

function rawInput(overrides = {}) {
  return {
    world_id: 'world-a',
    conversation_id: 'conversation-a',
    message_id: 'message-a',
    version_id: 'version-a',
    role: 'assistant',
    content: 'immutable captured message',
    metadata: { source: 'test', ordinal: 1 },
    ...overrides,
  };
}

function providerRecord() {
  return {
    world_id: 'world-a',
    subject_id: 'npc-a',
    purpose: 'npc_decision',
    record_ref: 'memory:record-a',
    record_version: 'record-v1',
    source_kind: 'canonical_entity',
    source_entity_id: 'entity-a',
    source_version: 'entity-v1',
    content_kind: 'claim',
    epistemic_kind: 'acquired_report',
    producer_kind: 'test',
    content_disposition: 'usable',
    evidence_assessment: 'unassessed',
    lineage: [{ source_kind: 'canonical_entity', entity_id: 'entity-a', source_version: 'entity-v1' }],
  };
}

test('raw capture replay is idempotent for the same ID, version, and complete payload', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'memory-raw-idempotency-'));
  const provider = makeProvider(join(dir, 'provider.sqlite'));
  t.after(() => { try { provider.close(); } catch {} rmSync(dir, { recursive: true, force: true }); });

  const input = rawInput();
  assert.equal(provider.captureRawMessage(input).status, 'captured');
  assert.equal(provider.captureRawMessage(input).status, 'duplicate');
  assert.equal(provider.db.prepare('SELECT COUNT(*) AS count FROM memory_raw_captures').get().count, 1);
});

test('same raw ID/version with different content, role, or metadata is a conflict', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'memory-raw-conflict-'));
  const provider = makeProvider(join(dir, 'provider.sqlite'));
  t.after(() => { try { provider.close(); } catch {} rmSync(dir, { recursive: true, force: true }); });

  const input = rawInput();
  provider.captureRawMessage(input);
  assert.throws(() => provider.captureRawMessage({ ...input, content: 'different bytes' }), /MEMORY_RAW_CAPTURE_CONFLICT/);
  assert.throws(() => provider.captureRawMessage({ ...input, role: 'user' }), /MEMORY_RAW_CAPTURE_CONFLICT/);
  assert.throws(() => provider.captureRawMessage({ ...input, metadata: { source: 'changed', ordinal: 1 } }), /MEMORY_RAW_CAPTURE_CONFLICT/);
  assert.equal(provider.db.prepare('SELECT COUNT(*) AS count FROM memory_raw_captures').get().count, 1);
  assert.equal(provider.db.prepare('SELECT content_text FROM memory_raw_captures').get().content_text, input.content);
});

test('deleting the active raw version retains an alternative and allows explicit selection of it', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'memory-raw-alternative-'));
  const provider = makeProvider(join(dir, 'provider.sqlite'));
  t.after(() => { try { provider.close(); } catch {} rmSync(dir, { recursive: true, force: true }); });

  const active = rawInput({ version_id: 'version-a', content: 'first version' });
  const alternative = rawInput({ version_id: 'version-b', content: 'surviving alternative' });
  provider.captureRawMessage(active);
  provider.captureRawMessage(alternative);
  provider.selectActiveRawVersion({
    world_id: active.world_id, conversation_id: active.conversation_id,
    message_id: active.message_id, version_id: active.version_id,
  });

  assert.equal(provider.markRawSourceDeleted({
    world_id: active.world_id, conversation_id: active.conversation_id,
    message_id: active.message_id, version_id: active.version_id,
  }).status, 'deleted');
  assert.throws(() => provider.selectActiveRawVersion({
    world_id: active.world_id, conversation_id: active.conversation_id,
    message_id: active.message_id, version_id: active.version_id,
  }), /MEMORY_RAW_VERSION_UNAVAILABLE/);

  assert.equal(provider.db.prepare(`SELECT content_text FROM memory_raw_captures
    WHERE world_id=? AND conversation_id=? AND message_id=? AND version_id=?`)
    .get('world-a', 'conversation-a', 'message-a', 'version-b').content_text, 'surviving alternative');
  assert.deepEqual(provider.selectActiveRawVersion({
    world_id: alternative.world_id, conversation_id: alternative.conversation_id,
    message_id: alternative.message_id, version_id: alternative.version_id,
  }), { status: 'active', version_id: 'version-b' });
  assert.equal(provider.db.prepare(`SELECT version_id FROM memory_raw_active_versions
    WHERE world_id=? AND conversation_id=? AND message_id=?`)
    .get('world-a', 'conversation-a', 'message-a').version_id, 'version-b');
});

test('raw archive survives a failed derived-index rebuild without becoming a search candidate', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'memory-raw-index-failure-'));
  const path = join(dir, 'provider.sqlite');
  const provider = makeProvider(path);
  t.after(() => { try { provider.close(); } catch {} rmSync(dir, { recursive: true, force: true }); });

  provider.captureRawMessage(rawInput());
  assert.equal(provider.putRecord(providerRecord()).status, 'stored');
  await provider.rebuildIndex('world-a');
  assert.equal(provider.db.prepare('SELECT COUNT(*) AS count FROM memory_raw_captures').get().count, 1);

  provider.db.prepare('DELETE FROM memory_index_entries WHERE world_id=?').run('world-a');
  provider.db.exec(`CREATE TRIGGER fail_rebuild_insert BEFORE INSERT ON memory_index_entries
    BEGIN SELECT RAISE(ABORT, 'injected derived-index failure'); END;`);
  await assert.rejects(() => provider.rebuildIndex('world-a'), /injected derived-index failure/);

  assert.equal(provider.db.prepare('SELECT COUNT(*) AS count FROM memory_raw_captures').get().count, 1);
  assert.equal(provider.db.prepare('SELECT content_text FROM memory_raw_captures').get().content_text, rawInput().content);
  assert.equal(provider.db.prepare('SELECT COUNT(*) AS count FROM memory_index_entries WHERE world_id=?').get('world-a').count, 0);
  provider.grantQuery({ world_id: 'world-a', subject_id: 'npc-a', purpose: 'npc_decision' }, true);
  await assert.rejects(() => provider.retrieveCandidates({
    world_id: 'world-a', subject_id: 'npc-a', purpose: 'npc_decision',
  }), /MEMORY_INDEX_NOT_READY/);
  // The raw archive remains an archive; this test does not create a conversion path
  // from raw messages to indexed candidates.
});

test('replay after process restart creates no duplicate and does not clear a deletion marker', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'memory-raw-restart-replay-'));
  const path = join(dir, 'provider.sqlite');
  let provider = makeProvider(path);
  t.after(() => { try { provider.close(); } catch {} rmSync(dir, { recursive: true, force: true }); });

  const input = rawInput();
  const key = {
    world_id: input.world_id, conversation_id: input.conversation_id,
    message_id: input.message_id, version_id: input.version_id,
  };
  assert.equal(provider.captureRawMessage(input).status, 'captured');
  assert.equal(provider.markRawSourceDeleted(key).status, 'deleted');
  const deletedAtBeforeRestart = provider.db.prepare(`SELECT deleted_at FROM memory_raw_captures
    WHERE world_id=? AND conversation_id=? AND message_id=? AND version_id=?`)
    .get('world-a', 'conversation-a', 'message-a', 'version-a').deleted_at;
  provider.close();

  provider = makeProvider(path);
  assert.equal(provider.captureRawMessage(input).status, 'duplicate');
  const row = provider.db.prepare(`SELECT deleted_at FROM memory_raw_captures
    WHERE world_id=? AND conversation_id=? AND message_id=? AND version_id=?`)
    .get('world-a', 'conversation-a', 'message-a', 'version-a');
  assert.equal(row.deleted_at, deletedAtBeforeRestart);
  assert.equal(provider.db.prepare('SELECT COUNT(*) AS count FROM memory_raw_captures').get().count, 1);
  assert.throws(() => provider.selectActiveRawVersion(key), /MEMORY_RAW_VERSION_UNAVAILABLE/);
});
