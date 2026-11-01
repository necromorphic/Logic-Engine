import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { ActorBindingService } from '../src/application/actor-bindings.js';
import { HostConversationWorldBindingService } from '../src/application/host-conversation-world-bindings.js';
import { createMemoryNpcProviderAdapter } from '../src/application/memory-npc-provider-adapter.js';
import { runWithAuthenticatedHostSession } from '../src/application/host-session-context.js';

test('real adapter composes file-backed SQLite Provider with Core query and canonical-source authorization', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-memory-real-adapter-'));
  const corePath = join(directory, 'core.sqlite');
  const providerPath = join(directory, 'provider.sqlite');
  const coordinatorPath = resolve(join(directory, 'coordinator.sqlite'));
  const previousCoordinator = process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH;
  process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH = coordinatorPath;

  let store;
  let adapter;
  try {
    store = new SQLiteStore(corePath);
    const engine = new LogicEngine(store);
    const worldId = 'real-adapter-world';
    const actorId = 'real-adapter-npc';
    const sourceId = 'real-adapter-source';
    const adapterId = 'real-adapter-host';
    const hostSessionId = '11111111-1111-4111-8111-111111111111';
    const conversationId = hostSessionId + ':22222222-2222-4222-8222-222222222222:33333333-3333-4333-8333-333333333333';
    const hostRequest = {
      user: { profile: { handle: 'adapter-test-user' } },
      session: { handle: 'adapter-test-user', logicEngineSessionId: hostSessionId, logicEngineSessionHandle: 'adapter-test-user' },
    };

    engine.createWorld({
      world_id: worldId,
      world_pack_id: 'test.memory-real-adapter',
      world_pack_version: '1',
      game_time: '2026-01-01T00:00:00Z',
    });
    engine.commitEvent(worldId, {
      event_id: 'real-adapter-seed',
      idempotency_key: 'real-adapter-seed',
      turn_id: 'real-adapter-seed',
      event_type: 'action.completed',
      expected_revision: 0,
      effects: [
        { kind: 'entity.create', entity_id: actorId, entity_type: 'character', attributes: { name: 'NPC' } },
        { kind: 'entity.create', entity_id: sourceId, entity_type: 'character', attributes: { public_note: 'real Core source value' } },
      ],
    });
    new ActorBindingService(engine).bind(worldId, adapterId, actorId);
    new HostConversationWorldBindingService(engine).bind({
      adapterId, conversationId, worldId,
    });

    assert.throws(() => createMemoryNpcProviderAdapter({
      engine,
      providerPath: corePath,
      coordinatorPath,
      adapterId,
      trustedInitialKnowledgeSources: [],
      fieldPolicy: () => true,
      contentFields: ['attributes.public_note'],
    }), /separate file from Core/);

    adapter = createMemoryNpcProviderAdapter({
      engine,
      providerPath,
      coordinatorPath,
      adapterId,
      trustedInitialKnowledgeSources: [],
      fieldPolicy: (_context, _entity, field) => field === 'entity_id' || field === 'attributes.public_note',
      contentFields: ['attributes.public_note'],
    });

    const scope = { world_id: worldId, subject_id: actorId, purpose: 'npc_decision' };
    const source = engine.getSnapshot(worldId, { entityIds: [sourceId], includeSourceVersions: true }).entities[0];
    const record = {
      ...scope,
      record_ref: 'memory:real-adapter-record',
      record_version: 'v1',
      source_kind: 'canonical_entity',
      source_entity_id: sourceId,
      source_version: source.source_version,
      content_kind: 'claim',
      epistemic_kind: 'acquired_report',
      producer_kind: 'real-provider-adapter-test',
      content_disposition: 'usable',
      evidence_assessment: 'unassessed',
      lineage: [{
        source_kind: 'canonical_entity',
        entity_id: sourceId,
        source_version: source.source_version,
      }],
    };
    adapter.provider.putRecord(record);
    adapter.provider.grantQuery(scope, true);
    adapter.provider.grantRecord(scope, record.record_ref, record.record_version, true);

    assert.equal((await adapter.prepareWorld(worldId)).status, 'current');
    assert.equal(adapter.provider.retrieveCandidates, undefined);
    assert.equal(adapter.provider.authorizeCandidate, undefined);
    assert.equal(adapter.provider.authorizeQuery, undefined);
    assert.equal(adapter.consumer.memoryProvider, undefined);
    const withoutHostContext = await adapter.consumer.retrieveForNpc({ worldId, actorEntityId: actorId, conversationId });
    assert.equal(withoutHostContext.status, 'non_ready');
    assert.equal(withoutHostContext.reason, 'query_access_unconfirmed');
    assert.deepEqual(withoutHostContext.candidates, []);

    const result = await runWithAuthenticatedHostSession(hostRequest, conversationId, () => adapter.consumer.retrieveForNpc({
      worldId, actorEntityId: actorId, conversationId,
      adapterId: 'caller-selected-spoofed-adapter',
    }));
    assert.equal(result.status, 'ready');
    assert.equal(result.candidates.length, 1);
    assert.deepEqual(result.candidates[0].content, {
      'attributes.public_note': 'real Core source value',
    });

    const unboundConversation = await runWithAuthenticatedHostSession(hostRequest, conversationId, () => adapter.consumer.retrieveForNpc({
      worldId, actorEntityId: actorId, conversationId: 'not-bound',
    }));
    assert.equal(unboundConversation.status, 'non_ready');
    assert.equal(unboundConversation.reason, 'query_access_unconfirmed');
    assert.deepEqual(unboundConversation.candidates, []);
  } finally {
    try { adapter?.close(); } catch {}
    try { store?.close(); } catch {}
    if (previousCoordinator === undefined) delete process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH;
    else process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH = previousCoordinator;
    rmSync(directory, { recursive: true, force: true });
  }
});
