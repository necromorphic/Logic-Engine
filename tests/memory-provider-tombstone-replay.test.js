import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteMemoryProvider } from '../src/application/sqlite-memory-provider.js';

test('exact replay of a tombstoned raw version does not resurrect it', async (t) => {
  const provider = new SQLiteMemoryProvider({
    path: ':memory:',
    getSnapshot: async () => ({ world_revision: 1, commit_sequence: 1 }),
    validateSourceVersion: async () => true,
    validateInventory: async () => true,
    authorizeRawRead: async () => true,
  });
  t.after(() => provider.close());

  const input = {
    world_id: 'w',
    conversation_id: 'c',
    message_id: 'm',
    version_id: 'v',
    role: 'assistant',
    content: 'immutable source bytes',
    metadata: { origin: 'test' },
  };
  const key = {
    world_id: input.world_id,
    conversation_id: input.conversation_id,
    message_id: input.message_id,
    version_id: input.version_id,
  };

  assert.equal(provider.captureRawMessage(input).status, 'captured');
  assert.equal(provider.markRawSourceDeleted(key).status, 'deleted');

  // A replay may be idempotent, but must never clear the tombstone.
  assert.equal(provider.captureRawMessage(input).status, 'duplicate');
  const row = provider.db.prepare(`SELECT deleted_at FROM memory_raw_captures
    WHERE world_id=? AND conversation_id=? AND message_id=? AND version_id=?`)
    .get('w', 'c', 'm', 'v');
  assert.ok(row.deleted_at);
  assert.throws(() => provider.selectActiveRawVersion(key), /MEMORY_RAW_VERSION_UNAVAILABLE/);
  await assert.rejects(() => provider.readRawMessageVersion(key), /MEMORY_RAW_VERSION_UNAVAILABLE/);
});
