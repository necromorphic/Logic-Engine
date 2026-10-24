import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { MechanicExecutor } from '../src/application/mechanic-executor.js';
import { ProposalService } from '../src/application/proposals.js';

function setup(t, worldId = 'executor-world') {
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  engine.createWorld({
    world_id: worldId,
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    game_time: '2005-12-29T10:00:00Z',
  });
  t.after(() => store.close());
  return { store, engine, worldId };
}

function template(overrides = {}) {
  return {
    template_id: 'test.executor',
    version: '1.0.0',
    schema_version: 'core-1',
    display_name: 'Executor fixture',
    required_capabilities: [],
    applicability: [{ op: 'eq', path: 'world.weather', value: 'rain' }],
    actions: [{
      action_id: 'wait',
      input_schema: { type: 'object' },
      preconditions: [{ op: 'gt', path: 'actor.hp', value: 0 }],
      effects: [{ effect_id: 'create-entity', kind: 'create_entity', target_ref: 'entity.new', payload: { entity_type: 'character', attributes: { name: 'New' } } }],
      ambiguity_policy: 'deterministic_only',
    }],
    conflict_policy: { mode: 'manual' },
    lifecycle_policy: { on_disable: 'require_author_decision' },
    unknown_policy: 'mark_unknown',
    ...overrides,
  };
}

function commit(engine, worldId, eventId, expectedRevision, effects, causedBy = []) {
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

function enableFixture(engine, worldId, value = template()) {
  engine.registerMechanicTemplate(value);
  commit(engine, worldId, 'create-instance', 0, [{
    kind: 'mechanic.instance.create',
    instance_id: 'instance.executor',
    template_id: value.template_id,
    template_version: value.version,
  }]);
  const created = engine.getMechanicInstance(worldId, 'instance.executor');
  commit(engine, worldId, 'enable-instance', 1, [{ kind: 'mechanic.instance.enable', instance_id: 'instance.executor' }], [created.last_event_id]);
}

function contextProvider(context = { world: { weather: 'rain' }, actor: { hp: 10 } }) {
  return ({ snapshot }) => ({
    context,
    knownAbsentPaths: [],
    world_revision: snapshot.world_revision,
    commit_sequence: snapshot.commit_sequence,
    policy_version: 'test-visibility-policy-v1',
  });
}

test('application executor pins one enabled instance and exact template to a consistent snapshot', (t) => {
  const { engine, worldId } = setup(t);
  enableFixture(engine, worldId);
  const executor = new MechanicExecutor(engine, { resolveAuthorizedContext: contextProvider() });
  const result = executor.evaluate({ worldId, instanceId: 'instance.executor', actionId: 'wait' });
  assert.equal(result.status, 'ready');
  assert.equal(result.snapshot_identity.world_revision, 2);
  assert.equal(result.snapshot_identity.commit_sequence, 2);
  assert.equal(result.snapshot_identity.template_id, 'test.executor');
  assert.equal(result.snapshot_identity.template_version, '1.0.0');
  assert.equal(typeof result.context_fingerprint, 'string');
  assert.equal(result.context_policy_version, 'test-visibility-policy-v1');
  assert.equal(typeof result.evaluation_fingerprint, 'string');
  assert.equal(result.commit_authority, 'none');
  assert.equal(typeof result.snapshot_identity.template_hash, 'string');
  assert.deepEqual(result.effects.map((effect) => effect.kind), ['entity.create']);
  assert.equal(result.guarantees.read_only, true);
  assert.equal(result.guarantees.proposal_created, false);
  assert.equal(engine.getState(worldId).world_revision, 2);
  assert.equal(engine.getState(worldId).entities.some((entity) => entity.entity_id === 'entity.new'), false);
});

test('application executor fails closed without trusted context or with a mismatched snapshot attestation', (t) => {
  const { engine, worldId } = setup(t);
  enableFixture(engine, worldId);
  const noProvider = new MechanicExecutor(engine).evaluate({ worldId, instanceId: 'instance.executor', actionId: 'wait' });
  assert.equal(noProvider.status, 'unknown');
  assert.equal(noProvider.reason_code, 'TRUSTED_CONTEXT_PROVIDER_REQUIRED');
  const mismatch = new MechanicExecutor(engine, {
    resolveAuthorizedContext: ({ snapshot }) => ({
      context: { world: { weather: 'rain' }, actor: { hp: 10 } },
      knownAbsentPaths: [],
      world_revision: snapshot.world_revision - 1,
      commit_sequence: snapshot.commit_sequence,
      policy_version: 'test-visibility-policy-v1',
    }),
  }).evaluate({ worldId, instanceId: 'instance.executor', actionId: 'wait' });
  assert.equal(mismatch.status, 'unknown');
  assert.equal(mismatch.reason_code, 'AUTHORIZED_CONTEXT_SNAPSHOT_MISMATCH');
  assert.deepEqual(mismatch.effects, []);
});

test('application executor preserves unknown conditions and emits no effects on false conditions', (t) => {
  const { engine, worldId } = setup(t);
  enableFixture(engine, worldId);
  const unknown = new MechanicExecutor(engine, { resolveAuthorizedContext: contextProvider({ world: {}, actor: { hp: 10 } }) })
    .evaluate({ worldId, instanceId: 'instance.executor', actionId: 'wait' });
  assert.equal(unknown.status, 'unknown');
  assert.deepEqual(unknown.effects, []);
  const failed = new MechanicExecutor(engine, { resolveAuthorizedContext: contextProvider({ world: { weather: 'sun' }, actor: { hp: 10 } }) })
    .evaluate({ worldId, instanceId: 'instance.executor', actionId: 'wait' });
  assert.equal(failed.status, 'no_match');
  assert.deepEqual(failed.effects, []);
});

test('application executor rejects unsupported modules, non-empty inputs and missing update targets', (t) => {
  const { engine, worldId } = setup(t);
  const moduleTemplate = template({ rule_modules: [{ module_id: 'test.reader', version: '1.0.0', required_capabilities: [] }] });
  engine.registerRuleModuleManifest({
    module_id: 'test.reader',
    version: '1.0.0',
    contract_version: 'core-1',
    capabilities: [],
    operations: ['evaluate_predicate'],
    input_schema: { type: 'object' },
    output_schema: { type: 'object' },
    failure_policy: 'fail_closed',
    compatibility: { core_contract_versions: ['core-1'] },
  });
  enableFixture(engine, worldId, moduleTemplate);
  const executor = new MechanicExecutor(engine, { resolveAuthorizedContext: contextProvider() });
  assert.equal(executor.evaluate({ worldId, instanceId: 'instance.executor', actionId: 'wait' }).reason_code, 'UNSUPPORTED_MECHANIC_MODULE_OR_CONFLICT_POLICY');
  assert.equal(executor.evaluate({ worldId, instanceId: 'instance.executor', actionId: 'wait', input: { arbitrary: true } }).reason_code, 'UNSUPPORTED_MECHANIC_MODULE_OR_CONFLICT_POLICY');
});

test('application executor rejects a target update when the target is absent from this world snapshot', (t) => {
  const { engine, worldId } = setup(t);
  const value = template({
    actions: [{
      action_id: 'wait',
      input_schema: { type: 'object' },
      preconditions: [],
      effects: [{ effect_id: 'update-missing', kind: 'update_attribute', target_ref: 'entity.missing', payload: { attributes: { mood: 'calm' } } }],
      ambiguity_policy: 'deterministic_only',
    }],
  });
  enableFixture(engine, worldId, value);
  const result = new MechanicExecutor(engine, { resolveAuthorizedContext: contextProvider({ world: { weather: 'rain' }, actor: { hp: 10 } }) })
    .evaluate({ worldId, instanceId: 'instance.executor', actionId: 'wait' });
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason_code, 'MECHANIC_EFFECT_TARGET_NOT_FOUND');
  assert.deepEqual(result.effects, []);
});


test('mechanic evaluation hands off through the ordinary durable proposal lifecycle with provenance', (t) => {
  const { engine, worldId } = setup(t);
  enableFixture(engine, worldId);
  const executor = new MechanicExecutor(engine, { resolveAuthorizedContext: contextProvider() });
  const evaluation = executor.evaluate({ worldId, instanceId: 'instance.executor', actionId: 'wait' });
  const proposals = new ProposalService(engine);
  const proposal = proposals.createFromMechanicEvaluation(worldId, evaluation, {
    idempotencyKey: 'mechanic-proposal-1',
    turnId: 'turn-mechanic-1',
    sourceText: 'The deterministic mechanic proposes creating a character.',
    adapterId: 'test-adapter',
  });
  assert.equal(proposal.status, 'pending');
  assert.equal(proposal.base_world_revision, evaluation.snapshot_identity.world_revision);
  assert.equal(proposal.base_commit_sequence, evaluation.snapshot_identity.commit_sequence);
  assert.equal(proposal.mechanic_execution.snapshot_identity.template_hash, evaluation.snapshot_identity.template_hash);
  assert.equal(proposal.mechanic_execution.context_policy_version, evaluation.context_policy_version);
  assert.equal(proposal.mechanic_execution.evaluation_fingerprint, evaluation.evaluation_fingerprint);
  assert.deepEqual(proposal.mechanic_execution.effect_provenance, evaluation.effect_provenance);
  assert.equal(proposal.validation_result.status, 'needs_review');
  assert.equal(engine.getState(worldId).world_revision, 2);
  assert.equal(engine.getState(worldId).entities.some((entity) => entity.entity_id === 'entity.new'), false);

  const approved = proposals.approve(worldId, proposal.proposal_id);
  assert.equal(approved.status, 'approved');
  const committed = proposals.commit(worldId, proposal.proposal_id);
  assert.equal(committed.status, 'committed');
  assert.equal(engine.getState(worldId).world_revision, 3);
  assert.equal(engine.getState(worldId).entities.some((entity) => entity.entity_id === 'entity.new'), true);
  assert.deepEqual(proposals.get(worldId, proposal.proposal_id).mechanic_execution.effect_provenance, evaluation.effect_provenance);
});

test('mechanic proposal handoff rejects a stale evaluation before creating a proposal', (t) => {
  const { engine, worldId } = setup(t);
  enableFixture(engine, worldId);
  const evaluation = new MechanicExecutor(engine, { resolveAuthorizedContext: contextProvider() })
    .evaluate({ worldId, instanceId: 'instance.executor', actionId: 'wait' });
  commit(engine, worldId, 'intervening-change', 2, [{ kind: 'entity.create', entity_id: 'entity.other', entity_type: 'object' }]);
  const proposals = new ProposalService(engine);
  assert.throws(
    () => proposals.createFromMechanicEvaluation(worldId, evaluation, {
      idempotencyKey: 'stale-mechanic-proposal',
      turnId: 'turn-stale-mechanic',
      sourceText: 'Stale mechanic output must not be proposed.',
      adapterId: 'test-adapter',
    }),
    (error) => error.code === 'STALE_MECHANIC_EVALUATION' && error.status === 409,
  );
  assert.equal(engine.getState(worldId).world_revision, 3);
  assert.equal(proposals.db.prepare('SELECT COUNT(*) AS count FROM event_proposals').get().count, 0);
});

test('mechanic proposal handoff rejects incomplete or mismatched effect provenance', (t) => {
  const { engine, worldId } = setup(t);
  enableFixture(engine, worldId);
  const evaluation = new MechanicExecutor(engine, { resolveAuthorizedContext: contextProvider() })
    .evaluate({ worldId, instanceId: 'instance.executor', actionId: 'wait' });
  const proposals = new ProposalService(engine);
  assert.throws(
    () => proposals.createFromMechanicEvaluation(worldId, {
      ...evaluation,
      effect_provenance: [],
    }, {
      idempotencyKey: 'bad-provenance',
      turnId: 'turn-bad-provenance',
      sourceText: 'Invalid provenance must not create a proposal.',
      adapterId: 'test-adapter',
    }),
    (error) => error.code === 'INVALID_MECHANIC_EFFECT_PROVENANCE',
  );
  assert.equal(proposals.db.prepare('SELECT COUNT(*) AS count FROM event_proposals').get().count, 0);
});


test('application executor rejects non-empty action input instead of ignoring it', (t) => {
  const { engine, worldId } = setup(t, 'executor-input-world');
  enableFixture(engine, worldId);
  const executor = new MechanicExecutor(engine, { resolveAuthorizedContext: contextProvider() });
  const result = executor.evaluate({ worldId, instanceId: 'instance.executor', actionId: 'wait', input: { target: 'entity.someone' } });
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason_code, 'UNSUPPORTED_ACTION_INPUT_SCHEMA');
  assert.deepEqual(result.effects, []);
});

test('application executor refuses to create an entity that already exists in the same-world state', (t) => {
  const { engine, worldId } = setup(t, 'executor-existing-target-world');
  enableFixture(engine, worldId);
  commit(engine, worldId, 'seed-existing-target', 2, [{ kind: 'entity.create', entity_id: 'entity.new', entity_type: 'character' }]);
  const result = new MechanicExecutor(engine, { resolveAuthorizedContext: contextProvider() })
    .evaluate({ worldId, instanceId: 'instance.executor', actionId: 'wait' });
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason_code, 'MECHANIC_EFFECT_TARGET_ALREADY_EXISTS');
  assert.deepEqual(result.effects, []);
});


test('application executor rejects conflicting writes to the same entity or fact before proposal creation', (t) => {
  const { engine, worldId } = setup(t, 'executor-write-conflict-world');
  const entityConflict = template({
    actions: [{
      action_id: 'wait',
      input_schema: { type: 'object' },
      preconditions: [],
      effects: [
        { effect_id: 'create-a', kind: 'create_entity', target_ref: 'entity.duplicate', payload: { entity_type: 'character' } },
        { effect_id: 'create-b', kind: 'create_entity', target_ref: 'entity.duplicate', payload: { entity_type: 'character' } },
      ],
      ambiguity_policy: 'deterministic_only',
    }],
  });
  enableFixture(engine, worldId, entityConflict);
  const executor = new MechanicExecutor(engine, { resolveAuthorizedContext: contextProvider() });
  const entityResult = executor.evaluate({ worldId, instanceId: 'instance.executor', actionId: 'wait' });
  assert.equal(entityResult.status, 'unknown');
  assert.equal(entityResult.reason_code, 'MECHANIC_EFFECT_WRITE_CONFLICT');
  assert.deepEqual(entityResult.effects, []);

  const factWorld = 'executor-fact-write-conflict-world';
  const factSetup = setup(t, factWorld);
  const factConflict = template({
    template_id: 'test.executor.fact-conflict',
    actions: [{
      action_id: 'wait',
      input_schema: { type: 'object' },
      preconditions: [],
      effects: [
        { effect_id: 'fact-a', kind: 'assert_fact', target_ref: 'fact.duplicate', payload: { predicate: 'known', value: true } },
        { effect_id: 'fact-b', kind: 'assert_fact', target_ref: 'fact.duplicate', payload: { predicate: 'known', value: false } },
      ],
      ambiguity_policy: 'deterministic_only',
    }],
  });
  enableFixture(factSetup.engine, factSetup.worldId, factConflict);
  const factResult = new MechanicExecutor(factSetup.engine, { resolveAuthorizedContext: contextProvider() })
    .evaluate({ worldId: factSetup.worldId, instanceId: 'instance.executor', actionId: 'wait' });
  assert.equal(factResult.status, 'unknown');
  assert.equal(factResult.reason_code, 'MECHANIC_EFFECT_WRITE_CONFLICT');
  assert.deepEqual(factResult.effects, []);
});


test('mechanic proposal handoff detects evaluation payload tampering via fingerprint', (t) => {
  const { engine, worldId } = setup(t, 'executor-fingerprint-world');
  enableFixture(engine, worldId);
  const evaluation = new MechanicExecutor(engine, { resolveAuthorizedContext: contextProvider() })
    .evaluate({ worldId, instanceId: 'instance.executor', actionId: 'wait' });
  const proposals = new ProposalService(engine);
  assert.throws(
    () => proposals.createFromMechanicEvaluation(worldId, {
      ...evaluation,
      context_policy_version: 'different-policy-version',
    }, {
      idempotencyKey: 'tampered-evaluation',
      turnId: 'turn-tampered-evaluation',
      sourceText: 'Tampered evaluation must not be proposed.',
      adapterId: 'test-adapter',
    }),
    (error) => error.code === 'INVALID_MECHANIC_EVALUATION_FINGERPRINT',
  );
  assert.equal(proposals.db.prepare('SELECT COUNT(*) AS count FROM event_proposals').get().count, 0);
});
