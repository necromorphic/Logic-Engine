import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteMemoryProvider } from '../src/application/sqlite-memory-provider.js';

function setup(t) {
  const directory = mkdtempSync(join(tmpdir(), 'logic-memory-raw-archive-'));
  const path = join(directory, 'memory-provider.sqlite');
  const provider = new SQLiteMemoryProvider({
    path,
    getSnapshot: async () => ({ world_revision: 1, commit_sequence: 1 }),
    validateSourceVersion: async () => true,
    validateInventory: async () => true,
    authorizeRawRead: async () => true,
  });
  t.after(() => {
    try { provider.close(); } catch {}
    rmSync(directory, { recursive: true, force: true });
  });
  return provider;
}

const capture = {
  world_id: 'world-a',
  conversation_id: 'chat-a',
  message_id: 'message-1',
  version_id: 'generation-1',
  role: 'assistant',
  content: 'Raw Host text must not be persisted without Core approval.',
};

test('raw Host capture is denied and persists no content', (t) => {
  const provider = setup(t);
  assert.throws(
    () => provider.captureRawMessage(capture),
    (error) => error.message === 'MEMORY_RAW_CAPTURE_NOT_APPROVED',
  );
  assert.equal(provider.db.prepare('SELECT COUNT(*) AS count FROM memory_raw_captures').get().count, 0);
});

test('raw Host-derived copies are denied and persist no content', (t) => {
  const provider = setup(t);
  assert.throws(
    () => provider.registerRawDerivedCopy({
      ...capture,
      source_version_id: capture.version_id,
      copy_ref: 'summary:1',
      copy_version: 'summary-v1',
      copy_kind: 'summary',
    }),
    (error) => error.message === 'MEMORY_RAW_DERIVED_COPY_NOT_APPROVED',
  );
  assert.equal(provider.db.prepare('SELECT COUNT(*) AS count FROM memory_raw_derived_copies').get().count, 0);
});

test('raw Host disclosure remains denied even when a read callback grants access', async (t) => {
  const provider = setup(t);
  await assert.rejects(
    () => provider.readRawMessageVersion({
      world_id: capture.world_id,
      conversation_id: capture.conversation_id,
      message_id: capture.message_id,
      version_id: capture.version_id,
    }),
    (error) => error.message === 'MEMORY_RAW_DISCLOSURE_NOT_APPROVED',
  );
  await assert.rejects(
    () => provider.readActiveRawMessages({
      world_id: capture.world_id,
      conversation_id: capture.conversation_id,
    }),
    (error) => error.message === 'MEMORY_RAW_DISCLOSURE_NOT_APPROVED',
  );
});

test('unapproved raw versions cannot be selected as active', (t) => {
  const provider = setup(t);
  assert.throws(
    () => provider.selectActiveRawVersion({
      world_id: capture.world_id,
      conversation_id: capture.conversation_id,
      message_id: capture.message_id,
      version_id: capture.version_id,
    }),
    (error) => error.message === 'MEMORY_RAW_SOURCE_NOT_APPROVED',
  );
  assert.equal(provider.db.prepare('SELECT COUNT(*) AS count FROM memory_raw_active_versions').get().count, 0);
});
