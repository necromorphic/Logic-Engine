import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteMemoryProvider } from '../src/application/sqlite-memory-provider.js';

test('tombstoned raw version cannot be selected again', (t) => {
  const provider = new SQLiteMemoryProvider({
    path: ':memory:', getSnapshot: async () => ({ world_revision: 1, commit_sequence: 1 }),
    validateSourceVersion: async () => true, validateInventory: async () => true,
  });
  t.after(() => provider.close());
  const source = { world_id: 'w', conversation_id: 'c', message_id: 'm', version_id: 'v' };
  provider.captureRawMessage({ ...source, role: 'assistant', content: 'x', metadata: {} });
  provider.markRawSourceDeleted(source);
  assert.throws(() => provider.selectActiveRawVersion(source), /MEMORY_RAW_VERSION_UNAVAILABLE/);
});
