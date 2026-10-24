import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { ActorBindingService } from '../src/application/actor-bindings.js';
import { AuthorizedReadService } from '../src/application/authorized-read-service.js';
import { MemoryNpcContextBridge } from '../src/application/memory-npc-context-bridge.js';

function setup(t) {
  let sourceVisible = true;
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  const bindings = new ActorBindingService(engine);
  engine.createWorld({
    world_id: 'memory-bridge-world',
    world_pack_id: 'test.world',
    world_pack_version: '1',
    game_time: '2026-01-01T00:00:00Z',
  });
  engine.commitEvent('memory-bridge-world', {
    idempotency_key: 'seed-memory-bridge',
    turn_id: 'seed-memory-bridge',
    event_type: 'action.completed',
    expected_revision: 0,
    effects: [
      { kind: 'entity.create', entity_id: 'actor-a', entity_type: 'character', attributes: { name: 'Actor' } },
      { kind: 'entity.create', entity_id: 'source-a', entity_type: 'character', attributes: { name: 'Visible source', secret: 'must-not-leak' } },
    ],
  });
  bindings.bind('memory-bridge-world', 'adapter-a', 'actor-a');
  engine.commitEvent('memory-bridge-world', {
    event_id: 'unrelated-memory-bridge',
    idempotency_key: 'unrelated-memory-bridge',
    turn_id: 'unrelated-memory-bridge',
    event_type: 'action.completed',
    expected_revision: 1,
    effects: [{ kind: 'entity.create', entity_id: 'unrelated-a', entity_type: 'object' }],
  });
  const authorizedReads = new AuthorizedReadService(engine, bindings, (context, entity, field) =>
    context.worldId === 'memory-bridge-world'
      && context.actor.entity_id === 'actor-a'
      && context.recipient === 'model'
      && context.purpose === 'npc_decision'
      && sourceVisible
      && (field === 'entity_id' || field === 'status' || field === 'attributes.name'));
  const sourceRead = () => authorizedReads.readEntityFields({
    worldId: 'memory-bridge-world',
    adapterId: 'adapter-a',
    actorEntityId: 'actor-a',
    recipient: 'model',
    purpose: 'npc_decision',
    entityIds: ['source-a'],
    fields: ['entity_id', 'status', 'attributes.name', 'attributes.secret'],
  });
  const snapshot = sourceRead();
  t.after(() => store.close());
  return { engine, store, authorizedReads, sourceRead, snapshot, revokeSource: () => { sourceVisible = false; } };
}

function memoryResult(snapshot, overrides = {}) {
  return {
    completeness: 'complete',
    access: { outcome: 'allow', subject_id: 'actor-a', purpose: 'npc_decision' },
    scope: { world_id: 'memory-bridge-world', subject_id: 'actor-a', purpose: 'npc_decision' },
    candidates: [{
      record: { ref: 'memory:summary-1', version: 'mem-v3' },
      world_id: 'memory-bridge-world',
      subject_id: 'actor-a',
      purpose: 'npc_decision',
      access: { outcome: 'allow', subject_id: 'actor-a', purpose: 'npc_decision' },
      content_kind: 'summary',
      epistemic_kind: 'acquired_report',
      producer: { kind: 'fixture-memory-adapter' },
      lifecycle: {
        content_disposition: 'usable',
        source_reconciliation: 'current',
        evidence_assessment: 'unassessed',
        access_outcome: 'allow',
        index_health: 'ready',
      },
      freshness: { status: 'current' },
      snapshot: { world_revision: snapshot.world_revision, commit_sequence: snapshot.commit_sequence },
      lineage: {
        status: 'complete',
        sources: [{
          ref: 'entity:source-a',
          version: 'core-fixture-v1',
          world_id: 'memory-bridge-world',
          access: { outcome: 'allow', subject_id: 'actor-a', purpose: 'npc_decision' },
          freshness: { status: 'current' },
        }],
      },
      content: 'private memory payload',
    }],
    ...overrides,
  };
}

test('host seam composes real Core authorized-read with fixture Memory retrieval and NPC admission', async (t) => {
  const { sourceRead, snapshot } = setup(t);
  const request = {
    world_id: 'memory-bridge-world',
    subject_id: 'actor-a',
    purpose: 'npc_decision',
    snapshot: { world_revision: snapshot.world_revision, commit_sequence: snapshot.commit_sequence },
  };
  const result = memoryResult(snapshot);
  const bridge = new MemoryNpcContextBridge({
    retrieve: () => result,
    verifyResult: (scope, retrieved) => scope.world_id === 'memory-bridge-world'
      && scope.subject_id === 'actor-a'
      && retrieved.completeness === 'complete'
      && retrieved.scope.world_id === scope.world_id
      && retrieved.scope.subject_id === scope.subject_id
      && retrieved.access.outcome === 'allow'
      && sourceRead().world_revision === scope.snapshot.world_revision
      && sourceRead().commit_sequence === scope.snapshot.commit_sequence,
    verifyCandidate: (scope, item) => {
      if (item.record.ref !== 'memory:summary-1' || item.record.version !== 'mem-v3') return false;
      if (item.lineage?.status !== 'complete' || item.lineage.sources?.length !== 1) return false;
      const source = item.lineage.sources[0];
      if (source.ref !== 'entity:source-a' || source.version !== 'core-fixture-v1') return false;
      if (source.world_id !== scope.world_id || source.access?.subject_id !== scope.subject_id
        || source.access?.purpose !== scope.purpose || source.access?.outcome !== 'allow') return false;
      const authorized = sourceRead();
      return authorized.entities[0].entity_id === 'source-a'
        && authorized.world_revision === scope.snapshot.world_revision
        && authorized.commit_sequence === scope.snapshot.commit_sequence;
    },
  });
  const output = await bridge.read(request);
  assert.equal(output.status, 'ready');
  assert.deepEqual(output.admitted, [{
    record_ref: 'memory:summary-1',
    record_version: 'mem-v3',
    epistemic_kind: 'acquired_report',
    evidence_assessment: 'unassessed',
  }]);
  assert.equal(JSON.stringify(output).includes('private memory payload'), false);
  assert.equal(JSON.stringify(sourceRead()).includes('must-not-leak'), false);
});


test('host seam rechecks Core visibility for a derived summary and fails closed after revocation', async (t) => {
  const { sourceRead, snapshot, revokeSource } = setup(t);
  const request = {
    world_id: 'memory-bridge-world',
    subject_id: 'actor-a',
    purpose: 'npc_decision',
    snapshot: { world_revision: snapshot.world_revision, commit_sequence: snapshot.commit_sequence },
  };
  const bridge = new MemoryNpcContextBridge({
    retrieve: () => memoryResult(snapshot),
    verifyResult: (scope, retrieved) => retrieved?.completeness === 'complete'
      && retrieved.scope?.world_id === scope.world_id
      && retrieved.scope?.subject_id === scope.subject_id
      && sourceRead().world_revision === scope.snapshot.world_revision
      && sourceRead().commit_sequence === scope.snapshot.commit_sequence,
    verifyCandidate: (scope, item) => {
      if (item.record?.ref !== 'memory:summary-1' || item.record.version !== 'mem-v3') return false;
      if (item.lineage?.status !== 'complete' || item.lineage.sources?.length !== 1) return false;
      const source = item.lineage.sources[0];
      if (source.ref !== 'entity:source-a' || source.version !== 'core-fixture-v1'
        || source.world_id !== scope.world_id) return false;
      const authorized = sourceRead();
      return authorized.entities[0].entity_id === 'source-a'
        && authorized.world_revision === scope.snapshot.world_revision
        && authorized.commit_sequence === scope.snapshot.commit_sequence;
    },
  });

  assert.equal((await bridge.read(request)).status, 'ready');
  revokeSource();
  const output = await bridge.read(request);
  assert.equal(output.status, 'non_ready');
  assert.equal(output.reason, 'authoritative_verification_unavailable');
  assert.deepEqual(output.admitted, []);
  assert.equal(JSON.stringify(output).includes('private memory payload'), false);
  assert.equal(JSON.stringify(output).includes('source-a'), false);
  assert.equal(JSON.stringify(output).includes('must-not-leak'), false);
});

test('host seam rejects a rollback-only revision change before NPC admission', async (t) => {
  const { engine, store, sourceRead, snapshot } = setup(t);
  const request = {
    world_id: 'memory-bridge-world',
    subject_id: 'actor-a',
    purpose: 'npc_decision',
    snapshot: { world_revision: snapshot.world_revision, commit_sequence: snapshot.commit_sequence },
  };
  const bridge = new MemoryNpcContextBridge({
    retrieve: () => memoryResult(snapshot),
    verifyResult: (scope, retrieved) => retrieved.completeness === 'complete'
      && sourceRead().world_revision === scope.snapshot.world_revision
      && sourceRead().commit_sequence === scope.snapshot.commit_sequence,
    verifyCandidate: () => true,
  });
  // Exercise the real Core rollback path: revision changes while event cursor stays put.
  const beforeSequence = store.currentCommitSequence('memory-bridge-world');
  const revision = engine.getState('memory-bridge-world').world_revision;
  assert.equal(revision, snapshot.world_revision);
  const rollback = engine.rollbackEvent('memory-bridge-world', {
    root_event_id: 'unrelated-memory-bridge',
    idempotency_key: 'rollback-unrelated-memory-bridge',
  });
  assert.equal(rollback.accepted, true);
  assert.equal(store.currentCommitSequence('memory-bridge-world'), beforeSequence);
  assert.notEqual(engine.getState('memory-bridge-world').world_revision, snapshot.world_revision);
  const output = await bridge.read(request);
  assert.equal(output.status, 'non_ready');
  assert.equal(output.reason, 'authoritative_result_unconfirmed');
  assert.deepEqual(output.admitted, []);
});
