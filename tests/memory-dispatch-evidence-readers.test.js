import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrustedMemoryDispatchEvidenceReaders } from '../src/security/memory-dispatch-evidence-readers.js';

const source = Object.freeze({
  source_kind: 'canonical_entity',
  source_entity_id: 'entity-42',
  source_version: 'core-entity-v1:1',
});
const context = Object.freeze({
  adapterId: 'adapter-1',
  conversationId: 'conversation-1',
  actorEntityId: 'npc-1',
});

function fixture({ inventoryStatus = 'READY', currentSourceVersion = source.source_version } = {}) {
  let bindingCalls = 0;
  const engine = {
    store: {
      db: {
        prepare(sql) {
          assert.match(sql, /accepted_head_state/);
          return { get: () => ({ head: 7, enrolled: 1 }) };
        },
      },
    },
    getSnapshot(worldId, options) {
      assert.equal(worldId, 'world-1');
      assert.deepEqual(options.entityIds, [source.source_entity_id]);
      assert.equal(options.includeSourceVersions, true);
      return {
        world_id: worldId,
        world_revision: 3,
        commit_sequence: 8,
        entities: [{
          entity_id: source.source_entity_id,
          status: 'active',
          source_version: currentSourceVersion,
        }],
      };
    },
  };
  const actorBindingService = {
    resolve(worldId, adapterId, actorEntityId) {
      assert.equal(worldId, 'world-1');
      assert.equal(adapterId, context.adapterId);
      assert.equal(actorEntityId, context.actorEntityId);
      return {
        world_id: worldId,
        adapter_id: adapterId,
        actor: { entity_id: actorEntityId, status: 'active' },
      };
    },
  };
  const hostConversationWorldBindingService = {
    resolve(input) {
      bindingCalls += 1;
      assert.deepEqual(input, {
        adapterId: context.adapterId,
        conversationId: context.conversationId,
      });
      return { adapter_id: context.adapterId, conversation_id: context.conversationId, world_id: 'world-1', active: true };
    },
  };
  const hostVersionDigestLedger = {
    getInventoryState(worldId, conversationId) {
      assert.equal(worldId, 'world-1');
      assert.equal(conversationId, context.conversationId);
      return { status: inventoryStatus, failure_code: null };
    },
  };
  const memoryProvider = {
    readDispatchEvidence(input) {
      return {
        head: 9,
        world_id: input.world_id,
        actor_id: input.subject_id,
        purpose: input.purpose,
        granted: true,
        readiness: 'READY',
        sources: [source],
        candidates: input.candidates,
      };
    },
  };
  const readers = createTrustedMemoryDispatchEvidenceReaders({
    engine, actorBindingService, hostConversationWorldBindingService,
    hostVersionDigestLedger, memoryProvider, trustedContext: context,
  });
  return { readers, getBindingCalls: () => bindingCalls };
}

const request = (overrides = {}) => ({
  worldId: 'world-1',
  actorId: 'npc-1',
  purpose: 'npc_decision',
  sources: [source],
  candidates: [{
    record_ref: 'record-1',
    record_version: 'version-1',
    ...source,
  }],
  ...overrides,
});

test('Core evidence reader uses server-bound conversation and active actor, and returns only current source metadata', () => {
  const { readers, getBindingCalls } = fixture();
  const result = readers.readCoreEvidence(request());
  assert.deepEqual(result, {
    head: 7,
    world_id: 'world-1',
    actor_id: 'npc-1',
    readiness: 'READY',
    inventory_status: 'READY',
    sources: [source],
  });
  assert.equal(getBindingCalls(), 2);
  assert.equal(Object.hasOwn(result, 'content'), false);
});

test('Core evidence reader rejects caller world/actor spoofing and stale source versions', () => {
  const { readers } = fixture();
  assert.throws(() => readers.readCoreEvidence(request({ worldId: 'world-2' })), /MEMORY_DISPATCH_NOT_READY/);
  assert.throws(() => readers.readCoreEvidence(request({ actorId: 'npc-other' })), /MEMORY_DISPATCH_NOT_READY/);
  const { readers: staleReaders } = fixture({ currentSourceVersion: 'core-entity-v1:2' });
  assert.throws(() => staleReaders.readCoreEvidence(request()), /MEMORY_DISPATCH_NOT_READY/);
});

test('Core evidence reader rejects incomplete Host inventory', () => {
  const { readers } = fixture({ inventoryStatus: 'NON_READY' });
  assert.throws(() => readers.readCoreEvidence(request()), /MEMORY_DISPATCH_NOT_READY/);
});

test('Provider evidence reader uses trusted bound scope and returns no content', () => {
  const { readers } = fixture();
  const result = readers.readProviderEvidence(request());
  assert.equal(result.readiness, 'READY');
  assert.equal(result.world_id, 'world-1');
  assert.equal(result.actor_id, 'npc-1');
  assert.equal(result.granted, true);
  assert.equal(Object.hasOwn(result, 'content'), false);
});

test('reader factory rejects untrusted context with unknown fields', () => {
  const f = fixture();
  assert.throws(() => createTrustedMemoryDispatchEvidenceReaders({
    engine: { store: { db: {} }, getSnapshot() {} },
    actorBindingService: { resolve() {} },
    hostConversationWorldBindingService: { resolve() {} },
    hostVersionDigestLedger: { getInventoryState() {} },
    memoryProvider: { readDispatchEvidence() {} },
    trustedContext: { ...context, worldId: 'world-1' },
  }), /Trusted Memory dispatch readers/);
});
