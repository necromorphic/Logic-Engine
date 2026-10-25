import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { ActorBindingService } from '../src/application/actor-bindings.js';
import { AuthorizedReadService } from '../src/application/authorized-read-service.js';
import { MemoryNpcConsumer } from '../src/application/memory-npc-consumer.js';
import { SQLiteMemoryProvider } from '../src/application/sqlite-memory-provider.js';

test('raw archive content is not automatically admitted as NPC memory', async (t) => {
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  const bindings = new ActorBindingService(engine);
  const worldId = 'raw-archive-isolation-world';
  const adapterId = 'raw-archive-isolation-adapter';
  const actorId = 'raw-archive-isolation-npc';

  engine.createWorld({
    world_id: worldId,
    world_pack_id: 'test.raw-archive-isolation',
    world_pack_version: '1',
    game_time: '2026-01-01T00:00:00Z',
  });
  engine.commitEvent(worldId, {
    event_id: 'raw-archive-isolation-seed',
    idempotency_key: 'raw-archive-isolation-seed',
    turn_id: 'raw-archive-isolation-seed',
    event_type: 'action.completed',
    expected_revision: 0,
    effects: [{ kind: 'entity.create', entity_id: actorId, entity_type: 'character' }],
  });
  bindings.bind(worldId, adapterId, actorId);

  const provider = new SQLiteMemoryProvider({
    path: ':memory:',
    getSnapshot: async (id) => {
      const snapshot = engine.getSnapshot(id);
      return { world_revision: snapshot.world_revision, commit_sequence: snapshot.commit_sequence };
    },
    validateSourceVersion: async () => false,
    validateInventory: async () => true,
  });
  const scope = { world_id: worldId, subject_id: actorId, purpose: 'npc_decision' };
  provider.grantQuery(scope, true);
  provider.captureRawMessage({
    world_id: worldId,
    conversation_id: 'conversation-1',
    message_id: 'message-1',
    version_id: 'version-1',
    role: 'user',
    content: 'PRIVATE RAW TEXT: this must not enter NPC context automatically.',
  });
  await provider.rebuildIndex(worldId);
  assert.equal((await provider.reconcile(worldId)).status, 'current');

  const authorizedReadService = new AuthorizedReadService(
    engine,
    bindings,
    (context, entity, field) => field === 'entity_id',
  );
  const consumer = new MemoryNpcConsumer({
    authorizedReadService,
    actorBindingService: bindings,
    memoryProvider: provider,
    contentFields: ['attributes.public_note'],
  });
  t.after(() => {
    provider.close();
    store.close();
  });

  const result = await consumer.retrieveForNpc({
    worldId,
    adapterId,
    actorEntityId: actorId,
  });

  assert.equal(result.status, 'ready');
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.admitted, []);
  assert.equal(JSON.stringify(result).includes('PRIVATE RAW TEXT'), false);
  assert.equal(JSON.stringify(result).includes('message-1'), false);
});
