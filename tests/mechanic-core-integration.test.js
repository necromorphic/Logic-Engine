import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { MechanicExecutor } from '../src/application/mechanic-executor.js';
import { ProposalService } from '../src/application/proposals.js';

function setup(t, worldId) {
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  engine.createWorld({
    world_id: worldId,
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    game_time: '2005-12-29T10:00:00Z',
  });
  t.after(() => store.close());
  return { engine, worldId };
}

function commitFixture(engine, worldId, eventId, expectedRevision, effects, causedBy = []) {
  return engine.commitEvent(worldId, {
    event_id: eventId,
    idempotency_key: eventId,
    turn_id: eventId + '-turn',
    event_type: 'action.completed',
    expected_revision: expectedRevision,
    effects,
    caused_by: causedBy,
    depends_on: [],
    read_set: [],
    causal_links: [],
  });
}

const mechanicTemplate = {
  template_id: 'integration.canonical-write',
  version: '1.0.0',
  schema_version: 'core-1',
  display_name: 'Canonical-write integration fixture',
  required_capabilities: [],
  applicability: [{ op: 'eq', path: 'world.weather', value: 'rain' }],
  actions: [{
    action_id: 'create-character',
    input_schema: { type: 'object' },
    preconditions: [{ op: 'gt', path: 'actor.hp', value: 0 }],
    effects: [{
      effect_id: 'create-entity',
      kind: 'create_entity',
      target_ref: 'entity.new',
      payload: { entity_type: 'character', attributes: { name: 'New' } },
    }],
    ambiguity_policy: 'deterministic_only',
  }],
  conflict_policy: { mode: 'manual' },
  lifecycle_policy: { on_disable: 'require_author_decision' },
  unknown_policy: 'mark_unknown',
};

function enableFixture(engine, worldId) {
  engine.registerMechanicTemplate(mechanicTemplate);
  commitFixture(engine, worldId, 'integration-create-instance', 0, [
    { kind: 'entity.create', entity_id: 'entity.world-context', entity_type: 'world_context', attributes: { weather: 'rain' } },
    { kind: 'entity.create', entity_id: 'entity.actor-context', entity_type: 'character', attributes: { hp: 10 } },
    {
      kind: 'mechanic.instance.create',
      instance_id: 'instance.integration',
      template_id: mechanicTemplate.template_id,
      template_version: mechanicTemplate.version,
    },
  ]);
  const created = engine.getMechanicInstance(worldId, 'instance.integration');
  commitFixture(engine, worldId, 'integration-enable-instance', 1, [
    { kind: 'mechanic.instance.enable', instance_id: 'instance.integration' },
  ], [created.last_event_id]);
}

function trustedContext({ snapshot }) {
  return {
    context: { world: { weather: 'rain' }, actor: { hp: 10 } },
    knownAbsentPaths: [],
    dependencyEvidence: [
      { path: 'actor.hp', kind: 'entity_attribute', entity_id: 'entity.actor-context', attribute: 'hp' },
      { path: 'world.weather', kind: 'entity_attribute', entity_id: 'entity.world-context', attribute: 'weather' },
    ],
    world_revision: snapshot.world_revision,
    commit_sequence: snapshot.commit_sequence,
    authorization_scope: 'integration-test-actor',
    policy_version: 'integration-test-policy-v1',
  };
}

test('Mechanics uses the canonical Core proposal/commit path and never writes during evaluation, proposal creation, or approval', (t) => {
  const { engine, worldId } = setup(t, 'mechanics-core-canonical-write-world');
  enableFixture(engine, worldId);

  const before = engine.getSnapshot(worldId);
  const beforeEvents = engine.getEvents(worldId).length;
  const executor = new MechanicExecutor(engine, { resolveAuthorizedContext: trustedContext });
  const evaluation = executor.evaluate({
    worldId,
    instanceId: 'instance.integration',
    actionId: 'create-character',
  });

  assert.equal(evaluation.status, 'ready');
  assert.equal(engine.getState(worldId).world_revision, before.world_revision);
  assert.equal(engine.getState(worldId).commit_sequence, before.commit_sequence);
  assert.equal(engine.getEvents(worldId).length, beforeEvents);
  assert.equal(engine.getState(worldId).entities.some((entity) => entity.entity_id === 'entity.new'), false);

  const proposals = new ProposalService(engine, { validateMechanicPolicy: () => true });
  const proposal = proposals.createFromMechanicEvaluation(worldId, evaluation, {
    idempotencyKey: 'integration-canonical-write',
    turnId: 'turn-integration-canonical-write',
    sourceText: 'Create the new character through the ordinary Core proposal lifecycle.',
    adapterId: 'integration-test-adapter',
  });

  assert.equal(proposal.status, 'pending');
  assert.equal(engine.getState(worldId).world_revision, before.world_revision);
  assert.equal(engine.getState(worldId).commit_sequence, before.commit_sequence);
  assert.equal(engine.getEvents(worldId).length, beforeEvents);
  assert.equal(engine.getState(worldId).entities.some((entity) => entity.entity_id === 'entity.new'), false);

  const approved = proposals.approve(worldId, proposal.proposal_id);
  assert.equal(approved.status, 'approved');
  assert.equal(engine.getState(worldId).world_revision, before.world_revision);
  assert.equal(engine.getState(worldId).commit_sequence, before.commit_sequence);
  assert.equal(engine.getEvents(worldId).length, beforeEvents);

  const committed = proposals.commit(worldId, proposal.proposal_id);
  assert.equal(committed.status, 'committed');
  assert.equal(engine.getState(worldId).world_revision, before.world_revision + 1);
  assert.equal(engine.getState(worldId).commit_sequence, before.commit_sequence + 1);
  assert.equal(engine.getEvents(worldId).length, beforeEvents + 1);
  assert.equal(engine.getState(worldId).entities.some((entity) => entity.entity_id === 'entity.new'), true);

  const canonicalEvent = engine.getEvents(worldId).find((event) => event.event_id === committed.commit_result.event_id);
  assert.ok(canonicalEvent, 'the proposal must materialize as a canonical Core event');
  assert.deepEqual(canonicalEvent.mechanic_execution.effect_provenance, evaluation.effect_provenance);
  assert.deepEqual(canonicalEvent.read_set, evaluation.read_set);
  assert.deepEqual(canonicalEvent.causal_links, evaluation.causal_links);

  const replay = proposals.commit(worldId, proposal.proposal_id);
  assert.equal(replay.status, 'committed');
  assert.equal(replay.commit_result.idempotent_replay, true);
  assert.equal(engine.getState(worldId).world_revision, before.world_revision + 1);
  assert.equal(engine.getState(worldId).commit_sequence, before.commit_sequence + 1);
  assert.equal(engine.getEvents(worldId).length, beforeEvents + 1);
});

test('Mechanics cannot inject its provenance through a caller-controlled canonical event payload', (t) => {
  const { engine, worldId } = setup(t, 'mechanics-core-forged-write-world');
  assert.throws(
    () => engine.commitEvent(worldId, {
      idempotency_key: 'integration-forged-mechanic-metadata',
      turn_id: 'integration-forged-mechanic-metadata',
      event_type: 'action.completed',
      expected_revision: 0,
      effects: [],
      mechanic_execution: { action_id: 'forged', effect_provenance: [] },
    }),
    (error) => error.code === 'UNSUPPORTED_EVENT_FIELD',
  );
  assert.equal(engine.getState(worldId).world_revision, 0);
  assert.equal(engine.getState(worldId).commit_sequence, 0);
  assert.deepEqual(engine.getEvents(worldId), []);
});
