import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteMemoryProvider } from '../src/application/sqlite-memory-provider.js';

test('reconciliation fails closed when the host snapshot changes during inventory validation', async (t) => {
  let revision = 4;
  const provider = new SQLiteMemoryProvider({
    getSnapshot: async () => ({ world_revision: revision, commit_sequence: 2 }),
    validateSourceVersion: async () => true,
    validateInventory: async () => {
      revision = 5;
      return true;
    },
  });
  t.after(() => provider.close());

  await provider.rebuildIndex('race-world');
  assert.equal((await provider.reconcile('race-world')).status, 'stale');
  const scope = { world_id: 'race-world', subject_id: 'race-npc', purpose: 'npc_decision' };
  provider.grantQuery(scope, true);
  await assert.rejects(
    () => provider.retrieveCandidates(scope),
    (error) => error.message === 'MEMORY_INDEX_NOT_READY',
  );
});
