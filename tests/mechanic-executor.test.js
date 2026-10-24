import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { MechanicExecutor } from '../src/application/mechanic-executor.js';
import { CanonicalEntityAttributeContextProvider } from '../src/application/entity-attribute-context-provider.js';
import { ProposalService } from '../src/application/proposals.js';
import { collectMechanicConditionDependencies } from '../src/core/mechanics.js';
import { hashRequest } from '../src/core/request-hash.js';
import { attestMechanicEvaluation } from '../src/application/mechanic-evaluation-attestation.js';

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
  commit(engine, worldId, 'create-instance', 0, [
    { kind: 'entity.create', entity_id: 'entity.world-context', entity_type: 'world_context', attributes: { weather: 'rain' } },
    { kind: 'entity.create', entity_id: 'entity.actor-context', entity_type: 'character', attributes: { hp: 10 } },
    {
      kind: 'mechanic.instance.create',
      instance_id: 'instance.executor',
      template_id: value.template_id,
      template_version: value.version,
    },
  ]);
  const created = engine.getMechanicInstance(worldId, 'instance.executor');
  commit(engine, worldId, 'enable-instance', 1, [{ kind: 'mechanic.instance.enable', instance_id: 'instance.executor' }], [created.last_event_id]);
}

function contextProvider(context = { world: { weather: 'rain' }, actor: { hp: 10 } }) {
  return ({ snapshot, template, action }) => {
    const paths = [...new Set([
      ...template.applicability,
      ...action.preconditions,
      ...(action.constraints ?? []),
    ].flatMap((rule) => collectMechanicConditionDependencies({
      template_id: template.template_id,
      version: template.version,
      schema_version: template.schema_version,
      display_name: template.display_name,
      required_capabilities: [],
      applicability: [rule],
      actions: [],
      conflict_policy: { mode: 'manual' },
      lifecycle_policy: { on_disable: 'require_author_decision' },
      unknown_policy: 'mark_unknown',
    }).condition_paths))].sort();
    return {
      context,
      knownAbsentPaths: [],
      dependencyEvidence: paths.flatMap((path) => {
        if (path === 'world.weather') return [{ path, kind: 'entity_attribute', entity_id: 'entity.world-context', attribute: 'weather' }];
        if (path === 'actor.hp') return [{ path, kind: 'entity_attribute', entity_id: 'entity.actor-context', attribute: 'hp' }];
        return [];
      }),
      world_revision: snapshot.world_revision,
      commit_sequence: snapshot.commit_sequence,
      authorization_scope: 'test-principal',
      policy_version: 'test-visibility-policy-v1',
    };
  };
}

test('application executor pins one enabled instance and exact template to a consistent snapshot', (t) => {
  const { engine, worldId } = setup(t);
  enableFixture(engine, worldId);
  const executor = new MechanicExecutor(engine, { resolveAuthorizedContext: contextProvider() });
  const result = executor.evaluate({ worldId, instanceId: 'instance.executor', actionId: 'wait' });
  assert.equal(result.status, 'ready');
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.effects), true);
  assert.throws(() => { result.effects[0].entity_id = 'entity.attacker'; }, TypeError);
  assert.equal(result.snapshot_identity.world_revision, 2);
  assert.equal(result.snapshot_identity.commit_sequence, 2);
  assert.equal(result.snapshot_identity.template_id, 'test.executor');
  assert.equal(result.snapshot_identity.template_version, '1.0.0');
  assert.equal(typeof result.context_fingerprint, 'string');
  assert.equal(result.context_policy_version, 'test-visibility-policy-v1');
  assert.equal(typeof result.evaluation_fingerprint, 'string');
  assert.equal(result.commit_authority, 'none');
  assert.deepEqual(result.dependency_manifest.condition_paths, ['actor.hp', 'world.weather']);
  assert.equal(result.dependency_manifest.scope, 'bounded_deterministic_action_v1');
  assert.equal(result.dependency_manifest.global_mechanic_dependencies_complete, false);
  assert.equal(result.dependency_manifest.condition_ast_dependencies_complete, true);
  assert.equal(result.dependency_manifest.context_projection_dependencies_complete, true);
  assert.deepEqual(result.dependency_manifest.effect_target_dependencies, [
    { kind: 'entity_absence', target_id: 'entity.new' },
  ]);
  assert.equal(result.dependency_manifest.effect_target_dependencies_complete, true);
  assert.equal(result.dependency_manifest.causal_read_set_complete_for_supported_slice, true);
  assert.equal(result.dependency_manifest.mechanic_dependencies_complete, true);
  assert.equal(result.guarantees.complete_global_mechanic_dependencies, false);
  assert.deepEqual(result.dependency_manifest.unresolved_sources, []);
  assert.deepEqual(result.dependency_manifest.assumptions, ['trusted_provider_correctly_maps_condition_paths_to_canonical_attributes']);
  assert.deepEqual(result.read_set, ['entity:entity.actor-context', 'entity:entity.world-context']);
  assert.ok(result.causal_links.some((link) => link.relation === 'READS_ENTITY' && link.target_id === 'entity.actor-context'));
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
      authorization_scope: 'test-principal',
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
  const falseTemplate = template({
    applicability: [{ op: 'eq', path: 'world.weather', value: 'sun' }],
  });
  const falseWorld = 'executor-valid-false-world';
  const falseSetup = setup(t, falseWorld);
  enableFixture(falseSetup.engine, falseSetup.worldId, falseTemplate);
  const failed = new MechanicExecutor(falseSetup.engine, { resolveAuthorizedContext: contextProvider() })
    .evaluate({ worldId: falseSetup.worldId, instanceId: 'instance.executor', actionId: 'wait' });
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
  assert.equal(proposal.mechanic_execution.authorization_scope, evaluation.authorization_scope);
  assert.equal(proposal.mechanic_execution.evaluation_fingerprint, evaluation.evaluation_fingerprint);
  assert.deepEqual(proposal.mechanic_execution.effect_provenance, evaluation.effect_provenance);
  assert.deepEqual(proposal.mechanic_execution.dependency_manifest, evaluation.dependency_manifest);
  assert.deepEqual(proposal.event.read_set, evaluation.read_set);
  assert.deepEqual(proposal.event.causal_links, evaluation.causal_links);
  assert.equal(proposal.mechanic_execution.context_policy_version, 'test-visibility-policy-v1');
  assert.deepEqual(proposal.mechanic_execution.dependency_manifest, evaluation.dependency_manifest);
  assert.deepEqual(proposal.mechanic_execution.read_set, evaluation.read_set);
  assert.deepEqual(proposal.mechanic_execution.causal_links, evaluation.causal_links);
  assert.equal(proposal.mechanic_execution.dependency_completeness, 'complete_for_supported_slice');
  assert.equal(proposal.mechanic_execution.global_dependency_completeness, 'not_proven');
  const creationAudit = engine.getAudit(worldId).find((entry) => entry.action === 'proposal.created' && entry.target_id === proposal.proposal_id);
  assert.equal(creationAudit.payload.mechanic_execution.evaluation_fingerprint, evaluation.evaluation_fingerprint);
  assert.deepEqual(creationAudit.payload.mechanic_execution.effect_provenance, evaluation.effect_provenance);
  assert.equal(proposal.validation_result.status, 'needs_review');
  assert.equal(engine.getState(worldId).world_revision, 2);
  assert.equal(engine.getState(worldId).entities.some((entity) => entity.entity_id === 'entity.new'), false);

  const approved = proposals.approve(worldId, proposal.proposal_id);
  assert.equal(approved.status, 'approved');
  const committed = proposals.commit(worldId, proposal.proposal_id);
  assert.equal(committed.status, 'committed');
  assert.equal(engine.getState(worldId).world_revision, 3);
  assert.equal(engine.getState(worldId).entities.some((entity) => entity.entity_id === 'entity.new'), true);
  const committedEvent = engine.getEvents(worldId).find((event) => event.event_id === committed.commit_result.event_id);
  assert.deepEqual(committedEvent.read_set, evaluation.read_set);
  assert.deepEqual(committedEvent.causal_links, evaluation.causal_links);
  assert.deepEqual(committedEvent.mechanic_execution, proposal.mechanic_execution);
  const commitAudit = engine.getAudit(worldId).find((entry) => entry.action === 'proposal.committed' && entry.target_id === proposal.proposal_id);
  assert.equal(commitAudit.payload.event_id, committed.commit_result.event_id);
  assert.equal(commitAudit.payload.mechanic_execution.evaluation_fingerprint, evaluation.evaluation_fingerprint);
  assert.deepEqual(commitAudit.payload.mechanic_execution.effect_provenance, evaluation.effect_provenance);
  assert.deepEqual(commitAudit.payload.mechanic_execution.dependency_manifest, evaluation.dependency_manifest);
  assert.deepEqual(proposals.get(worldId, proposal.proposal_id).mechanic_execution.effect_provenance, evaluation.effect_provenance);
  const replay = proposals.createFromMechanicEvaluation(worldId, evaluation, {
    idempotencyKey: 'mechanic-proposal-1',
    turnId: 'turn-mechanic-1',
    sourceText: 'The deterministic mechanic proposes creating a character.',
    adapterId: 'test-adapter',
  });
  assert.equal(replay.status, 'committed');
  assert.equal(replay.idempotent_replay, true);
  assert.equal(engine.getState(worldId).world_revision, 3);
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
  const tampered = { ...evaluation, effect_provenance: [] };
  tampered.evaluation_fingerprint = hashRequest({
    snapshot_identity: tampered.snapshot_identity,
    action_id: tampered.action_id,
    context_fingerprint: tampered.context_fingerprint,
    context_policy_version: tampered.context_policy_version,
    authorization_scope: tampered.authorization_scope,
    condition_result: tampered.condition_result,
    dependency_manifest: tampered.dependency_manifest,
    effects: tampered.effects,
    effect_provenance: tampered.effect_provenance,
    read_set: tampered.read_set,
    causal_links: tampered.causal_links,
  });
  attestMechanicEvaluation(tampered);
  assert.throws(
    () => proposals.createFromMechanicEvaluation(worldId, tampered, {
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


test('mechanic proposal handoff rejects cloned or tampered evaluation objects', (t) => {
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
    (error) => error.code === 'UNATTESTED_MECHANIC_EVALUATION',
  );
  assert.equal(proposals.db.prepare('SELECT COUNT(*) AS count FROM event_proposals').get().count, 0);
});


test('application executor does not expose trusted context provider exception details', (t) => {
  const { engine, worldId } = setup(t, 'executor-provider-error-world');
  enableFixture(engine, worldId);
  const result = new MechanicExecutor(engine, {
    resolveAuthorizedContext() { throw new Error('SECRET_CONTEXT_TOKEN_SHOULD_NOT_ESCAPE'); },
  }).evaluate({ worldId, instanceId: 'instance.executor', actionId: 'wait' });
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason_code, 'AUTHORIZED_CONTEXT_RESOLUTION_FAILED');
  assert.equal(JSON.stringify(result).includes('SECRET_CONTEXT_TOKEN_SHOULD_NOT_ESCAPE'), false);
  assert.deepEqual(result.effects, []);
});

test('application executor does not expose malformed-condition exception details', (t) => {
  const { engine, worldId } = setup(t, 'executor-condition-error-world');
  const malformed = template({
    applicability: [{ op: 'eq', path: 'actor.__proto__.secret', value: true }],
  });
  enableFixture(engine, worldId, malformed);
  const result = new MechanicExecutor(engine, { resolveAuthorizedContext: contextProvider() })
    .evaluate({ worldId, instanceId: 'instance.executor', actionId: 'wait' });
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason_code, 'MECHANIC_DEPENDENCY_ANALYSIS_FAILED');
  assert.equal(JSON.stringify(result).includes('Unsafe or empty rule path'), false);
  assert.deepEqual(result.effects, []);
});


test('application executor freezes the complete evaluation snapshot before trusted-provider access', (t) => {
  const { engine, worldId } = setup(t, 'executor-immutable-snapshot-world');
  enableFixture(engine, worldId);
  let observedFrozen = false;
  const result = new MechanicExecutor(engine, {
    resolveAuthorizedContext({ snapshot }) {
      observedFrozen = Object.isFrozen(snapshot)
        && Object.isFrozen(snapshot.entities)
        && Object.isFrozen(snapshot.mechanic_evaluation_snapshot)
        && Object.isFrozen(snapshot.mechanic_evaluation_snapshot.templates[0].template.actions[0]);
      assert.throws(() => { snapshot.mechanic_evaluation_snapshot.templates[0].template.actions[0].effects[0].target_ref = 'entity.tampered'; }, TypeError);
      return {
        context: { world: { weather: 'rain' }, actor: { hp: 10 } },
        knownAbsentPaths: [],
        dependencyEvidence: [
          { path: 'world.weather', kind: 'entity_attribute', entity_id: 'entity.world-context', attribute: 'weather' },
          { path: 'actor.hp', kind: 'entity_attribute', entity_id: 'entity.actor-context', attribute: 'hp' },
        ],
        world_revision: snapshot.world_revision,
        commit_sequence: snapshot.commit_sequence,
        authorization_scope: 'test-principal',
        policy_version: 'test-immutable-snapshot-v1',
      };
    },
  }).evaluate({ worldId, instanceId: 'instance.executor', actionId: 'wait' });
  assert.equal(observedFrozen, true);
  assert.equal(result.status, 'ready');
  assert.equal(result.effects[0].entity_id, 'entity.new');
  assert.equal(engine.getState(worldId).world_revision, 2);
});


test('application executor rejects fact subjects that are absent from the same world', (t) => {
  const { engine, worldId } = setup(t, 'executor-fact-subject-world');
  engine.createWorld({
    world_id: 'executor-fact-subject-other-world',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    game_time: '2005-12-29T10:00:00Z',
  });
  commit(engine, 'executor-fact-subject-other-world', 'foreign-entity-event', 0, [{
    kind: 'entity.create', entity_id: 'entity.from-other-world', entity_type: 'character',
  }]);
  const value = template({
    actions: [{
      action_id: 'wait',
      input_schema: { type: 'object' },
      preconditions: [],
      effects: [{
        effect_id: 'assert-missing-subject',
        kind: 'assert_fact',
        target_ref: 'fact.known',
        payload: { subject_ref: 'entity.from-other-world', predicate: 'known', value: true },
      }],
      ambiguity_policy: 'deterministic_only',
    }],
  });
  enableFixture(engine, worldId, value);
  const result = new MechanicExecutor(engine, { resolveAuthorizedContext: contextProvider() })
    .evaluate({ worldId, instanceId: 'instance.executor', actionId: 'wait' });
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason_code, 'MECHANIC_EFFECT_SUBJECT_NOT_FOUND');
  assert.deepEqual(result.effects, []);
});


test('application executor treats an empty effect set as no match and never creates a proposal', (t) => {
  const { engine, worldId } = setup(t, 'executor-empty-effect-world');
  const value = template({
    actions: [{
      action_id: 'wait',
      input_schema: { type: 'object' },
      preconditions: [],
      effects: [],
      ambiguity_policy: 'deterministic_only',
    }],
  });
  enableFixture(engine, worldId, value);
  const result = new MechanicExecutor(engine, { resolveAuthorizedContext: contextProvider() })
    .evaluate({ worldId, instanceId: 'instance.executor', actionId: 'wait' });
  assert.equal(result.status, 'no_match');
  assert.equal(result.reason_code, 'MECHANIC_ACTION_HAS_NO_EFFECTS');
  assert.deepEqual(result.effects, []);
  const proposals = new ProposalService(engine);
  assert.throws(
    () => proposals.createFromMechanicEvaluation(worldId, result, {
      idempotencyKey: 'empty-effect-proposal',
      turnId: 'turn-empty-effect',
      sourceText: 'An empty effect set cannot become a proposal.',
      adapterId: 'test-adapter',
    }),
    (error) => error.code === 'INVALID_MECHANIC_EVALUATION',
  );
  assert.equal(proposals.db.prepare('SELECT COUNT(*) AS count FROM event_proposals').get().count, 0);
});


test('application executor rejects a snapshot when the world changes during target resolution', (t) => {
  const { engine, worldId } = setup(t, 'executor-target-race-world');
  enableFixture(engine, worldId);
  const originalGetState = engine.getState.bind(engine);
  let injected = false;
  engine.getState = (id) => {
    if (!injected) {
      injected = true;
      commit(engine, id, 'intervening-target-race', 2, [{
        kind: 'entity.create', entity_id: 'entity.race', entity_type: 'object',
      }]);
    }
    return originalGetState(id);
  };
  const result = new MechanicExecutor(engine, { resolveAuthorizedContext: contextProvider() })
    .evaluate({ worldId, instanceId: 'instance.executor', actionId: 'wait' });
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason_code, 'SNAPSHOT_CHANGED_DURING_PREPARATION');
  assert.deepEqual(result.effects, []);
  assert.equal(engine.getState(worldId).world_revision, 3);
});


test('application executor rejects required capabilities without a grant contract', (t) => {
  const { engine, worldId } = setup(t, 'executor-capability-world');
  enableFixture(engine, worldId, template({ required_capabilities: ['world.write'] }));
  const result = new MechanicExecutor(engine, { resolveAuthorizedContext: contextProvider() })
    .evaluate({ worldId, instanceId: 'instance.executor', actionId: 'wait' });
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason_code, 'UNSUPPORTED_MECHANIC_CAPABILITIES');
  assert.deepEqual(result.effects, []);
});


test('application executor refuses context whose canonical dependency evidence is missing or mismatched', (t) => {
  const missingSetup = setup(t, 'executor-missing-evidence-world');
  enableFixture(missingSetup.engine, missingSetup.worldId);
  const missing = new MechanicExecutor(missingSetup.engine, {
    resolveAuthorizedContext: ({ snapshot }) => ({
      context: { world: { weather: 'rain' }, actor: { hp: 10 } },
      knownAbsentPaths: [],
      dependencyEvidence: [],
      world_revision: snapshot.world_revision,
      commit_sequence: snapshot.commit_sequence,
      authorization_scope: 'test-principal',
      policy_version: 'test-policy-v1',
    }),
  }).evaluate({ worldId: missingSetup.worldId, instanceId: 'instance.executor', actionId: 'wait' });
  assert.equal(missing.status, 'unknown');
  assert.equal(missing.reason_code, 'DEPENDENCY_EVIDENCE_INCOMPLETE');
  assert.deepEqual(missing.effects, []);

  const mismatchSetup = setup(t, 'executor-mismatched-evidence-world');
  enableFixture(mismatchSetup.engine, mismatchSetup.worldId);
  const mismatch = new MechanicExecutor(mismatchSetup.engine, {
    resolveAuthorizedContext: ({ snapshot }) => ({
      context: { world: { weather: 'rain' }, actor: { hp: 10 } },
      knownAbsentPaths: [],
      dependencyEvidence: [
        { path: 'world.weather', kind: 'entity_attribute', entity_id: 'entity.actor-context', attribute: 'hp' },
        { path: 'actor.hp', kind: 'entity_attribute', entity_id: 'entity.actor-context', attribute: 'hp' },
      ],
      world_revision: snapshot.world_revision,
      commit_sequence: snapshot.commit_sequence,
      authorization_scope: 'test-principal',
      policy_version: 'test-policy-v1',
    }),
  }).evaluate({ worldId: mismatchSetup.worldId, instanceId: 'instance.executor', actionId: 'wait' });
  assert.equal(mismatch.status, 'unknown');
  assert.equal(mismatch.reason_code, 'DEPENDENCY_EVIDENCE_VALUE_MISMATCH');
  assert.deepEqual(mismatch.effects, []);
});


test('mechanic proposal cannot commit after an intervening world change', (t) => {
  const { engine, worldId } = setup(t, 'executor-stale-commit-world');
  enableFixture(engine, worldId);
  const evaluation = new MechanicExecutor(engine, { resolveAuthorizedContext: contextProvider() })
    .evaluate({ worldId, instanceId: 'instance.executor', actionId: 'wait' });
  const proposals = new ProposalService(engine);
  const proposal = proposals.createFromMechanicEvaluation(worldId, evaluation, {
    idempotencyKey: 'mechanic-stale-commit',
    turnId: 'turn-mechanic-stale-commit',
    sourceText: 'This proposal must be rejected after the world changes.',
    adapterId: 'test-adapter',
  });
  proposals.approve(worldId, proposal.proposal_id);
  commit(engine, worldId, 'competing-world-change', 2, [{
    kind: 'entity.create', entity_id: 'entity.competing', entity_type: 'object',
  }]);
  assert.throws(
    () => proposals.commit(worldId, proposal.proposal_id),
    (error) => error.code === 'STALE_PROPOSAL' && error.status === 409,
  );
  assert.equal(engine.getState(worldId).entities.some((entity) => entity.entity_id === 'entity.new'), false);
  assert.equal(engine.getState(worldId).entities.some((entity) => entity.entity_id === 'entity.competing'), true);
  assert.equal(proposals.get(worldId, proposal.proposal_id).status, 'approved');
});


test('application executor accepts only same-snapshot canonical absence evidence for negative conditions', (t) => {
  const { engine, worldId } = setup(t, 'executor-known-absence-world');
  const value = template({
    applicability: [{ op: 'exists', path: 'actor.injury', value: false }],
  });
  enableFixture(engine, worldId, value);
  const provider = (knownAbsentPaths) => ({ snapshot }) => ({
    context: { world: { weather: 'rain' }, actor: { hp: 10 } },
    knownAbsentPaths,
    dependencyEvidence: [
      { path: 'actor.hp', kind: 'entity_attribute', entity_id: 'entity.actor-context', attribute: 'hp' },
      { path: 'actor.injury', kind: 'entity_attribute', entity_id: 'entity.actor-context', attribute: 'injury' },
    ],
    world_revision: snapshot.world_revision,
    commit_sequence: snapshot.commit_sequence,
    authorization_scope: 'test-principal',
      policy_version: 'test-visibility-policy-v1',
  });
  const provenAbsent = new MechanicExecutor(engine, { resolveAuthorizedContext: provider(['actor.injury']) })
    .evaluate({ worldId, instanceId: 'instance.executor', actionId: 'wait' });
  assert.equal(provenAbsent.status, 'ready');
  assert.deepEqual(provenAbsent.dependency_manifest.condition_paths, ['actor.hp', 'actor.injury']);

  const unprovenAbsent = new MechanicExecutor(engine, { resolveAuthorizedContext: provider([]) })
    .evaluate({ worldId, instanceId: 'instance.executor', actionId: 'wait' });
  assert.equal(unprovenAbsent.status, 'unknown');
  assert.equal(unprovenAbsent.reason_code, 'DEPENDENCY_EVIDENCE_ABSENCE_UNPROVEN');
  assert.deepEqual(unprovenAbsent.effects, []);
});

test('application executor rejects known-absence claims outside the declared condition paths', (t) => {
  const { engine, worldId } = setup(t, 'executor-absence-scope-world');
  enableFixture(engine, worldId);
  const result = new MechanicExecutor(engine, {
    resolveAuthorizedContext: ({ snapshot }) => ({
      context: { world: { weather: 'rain' }, actor: { hp: 10 } },
      knownAbsentPaths: ['actor.secret'],
      dependencyEvidence: [
        { path: 'world.weather', kind: 'entity_attribute', entity_id: 'entity.world-context', attribute: 'weather' },
        { path: 'actor.hp', kind: 'entity_attribute', entity_id: 'entity.actor-context', attribute: 'hp' },
      ],
      world_revision: snapshot.world_revision,
      commit_sequence: snapshot.commit_sequence,
      authorization_scope: 'test-principal',
      policy_version: 'test-visibility-policy-v1',
    }),
  }).evaluate({ worldId, instanceId: 'instance.executor', actionId: 'wait' });
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason_code, 'INVALID_KNOWN_ABSENCE_SCOPE');
  assert.deepEqual(result.effects, []);
});


test('mechanic proposal rollback restores the prior projection and a fresh evaluation can recover', (t) => {
  const { engine, worldId } = setup(t, 'executor-rollback-recovery-world');
  enableFixture(engine, worldId);
  const proposals = new ProposalService(engine);
  const firstEvaluation = new MechanicExecutor(engine, { resolveAuthorizedContext: contextProvider() })
    .evaluate({ worldId, instanceId: 'instance.executor', actionId: 'wait' });
  const firstProposal = proposals.createFromMechanicEvaluation(worldId, firstEvaluation, {
    idempotencyKey: 'mechanic-before-rollback',
    turnId: 'turn-mechanic-before-rollback',
    sourceText: 'First supported-slice mechanic proposal.',
    adapterId: 'test-adapter',
  });
  proposals.approve(worldId, firstProposal.proposal_id);
  const firstCommit = proposals.commit(worldId, firstProposal.proposal_id);
  const firstEventId = firstCommit.commit_result.event_id;
  assert.equal(engine.getState(worldId).entities.some((entity) => entity.entity_id === 'entity.new'), true);

  const rollback = engine.rollbackEvent(worldId, {
    root_event_id: firstEventId,
    idempotency_key: 'rollback-mechanic-first-commit',
  });
  assert.equal(rollback.rollback_outcome, 'resolved');
  assert.ok(rollback.invalidated_event_ids.includes(firstEventId));
  assert.equal(engine.getState(worldId).entities.some((entity) => entity.entity_id === 'entity.new'), false);

  const recoveryEvaluation = new MechanicExecutor(engine, { resolveAuthorizedContext: contextProvider() })
    .evaluate({ worldId, instanceId: 'instance.executor', actionId: 'wait' });
  assert.equal(recoveryEvaluation.status, 'ready');
  assert.notEqual(recoveryEvaluation.snapshot_identity.world_revision, firstEvaluation.snapshot_identity.world_revision);
  const recoveryProposal = proposals.createFromMechanicEvaluation(worldId, recoveryEvaluation, {
    idempotencyKey: 'mechanic-after-rollback',
    turnId: 'turn-mechanic-after-rollback',
    sourceText: 'Fresh supported-slice mechanic proposal after rollback.',
    adapterId: 'test-adapter',
  });
  proposals.approve(worldId, recoveryProposal.proposal_id);
  proposals.commit(worldId, recoveryProposal.proposal_id);
  assert.equal(engine.getState(worldId).entities.some((entity) => entity.entity_id === 'entity.new'), true);
});


test('mechanic context and evaluation fingerprints change when the visibility policy version changes', (t) => {
  const { engine, worldId } = setup(t, 'executor-policy-fingerprint-world');
  enableFixture(engine, worldId);
  const first = new MechanicExecutor(engine, { resolveAuthorizedContext: contextProvider() })
    .evaluate({ worldId, instanceId: 'instance.executor', actionId: 'wait' });
  const second = new MechanicExecutor(engine, {
    resolveAuthorizedContext: (args) => ({
      ...contextProvider()(args),
      authorization_scope: 'test-principal',
      policy_version: 'test-visibility-policy-v2',
    }),
  }).evaluate({ worldId, instanceId: 'instance.executor', actionId: 'wait' });
  assert.equal(first.status, 'ready');
  assert.equal(second.status, 'ready');
  assert.notEqual(first.context_fingerprint, second.context_fingerprint);
  assert.notEqual(first.evaluation_fingerprint, second.evaluation_fingerprint);
  assert.equal(first.snapshot_identity.world_revision, second.snapshot_identity.world_revision);
  assert.equal(engine.getState(worldId).world_revision, 2);
});


test('application executor rejects non-canonical context values before hashing or evaluation', (t) => {
  const { engine, worldId } = setup(t, 'executor-non-json-context-world');
  enableFixture(engine, worldId);
  const result = new MechanicExecutor(engine, {
    resolveAuthorizedContext: ({ snapshot }) => ({
      context: { world: { weather: 'rain' }, actor: { hp: 10, secret: () => 'not-json' } },
      knownAbsentPaths: [],
      dependencyEvidence: [
        { path: 'actor.hp', kind: 'entity_attribute', entity_id: 'entity.actor-context', attribute: 'hp' },
        { path: 'world.weather', kind: 'entity_attribute', entity_id: 'entity.world-context', attribute: 'weather' },
      ],
      world_revision: snapshot.world_revision,
      commit_sequence: snapshot.commit_sequence,
      authorization_scope: 'test-principal',
      policy_version: 'test-visibility-policy-v1',
    }),
  }).evaluate({ worldId, instanceId: 'instance.executor', actionId: 'wait' });
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason_code, 'INVALID_AUTHORIZED_CONTEXT');
  assert.deepEqual(result.effects, []);
});


test('canonical entity-attribute provider constructs versioned context and evidence for the bounded executor', (t) => {
  const { engine, worldId } = setup(t, 'executor-canonical-provider-world');
  enableFixture(engine, worldId);
  const value = template();
  const snapshot = engine.getSnapshot(worldId, { includeMechanicEvaluationState: true });
  const provider = new CanonicalEntityAttributeContextProvider(engine, {
    policyVersion: 'visibility-policy-v1',
    authorizationScope: 'test-principal',
    bindings: [
      { path: 'world.weather', entity_id: 'entity.world-context', attribute: 'weather' },
      { path: 'actor.hp', entity_id: 'entity.actor-context', attribute: 'hp' },
    ],
    canRead: () => true,
  });
  const resolved = provider.resolve({ worldId, snapshot, template: value, action: value.actions[0] });
  assert.deepEqual(resolved.context, { actor: { hp: 10 }, world: { weather: 'rain' } });
  assert.deepEqual(resolved.dependencyEvidence.map((item) => item.path), ['actor.hp', 'world.weather']);
  assert.equal(resolved.world_revision, snapshot.world_revision);
  assert.equal(resolved.commit_sequence, snapshot.commit_sequence);
  assert.equal(typeof resolved.policy_version, 'string');
  assert.equal(resolved.policy_version.length > 0, true);

  const result = new MechanicExecutor(engine, {
    resolveAuthorizedContext: (args) => provider.resolve(args),
  }).evaluate({ worldId, instanceId: 'instance.executor', actionId: 'wait' });
  assert.equal(result.status, 'ready');
  assert.equal(result.guarantees.context_provider_attested_snapshot, true);
});

test('canonical entity-attribute provider fails closed for denied or unbound condition paths', (t) => {
  const { engine, worldId } = setup(t, 'executor-canonical-provider-denied-world');
  enableFixture(engine, worldId);
  const value = template();
  const denied = new CanonicalEntityAttributeContextProvider(engine, {
    policyVersion: 'visibility-policy-v1',
    authorizationScope: 'test-principal',
    bindings: [
      { path: 'world.weather', entity_id: 'entity.world-context', attribute: 'weather' },
      { path: 'actor.hp', entity_id: 'entity.actor-context', attribute: 'hp' },
    ],
    canRead: ({ condition_path }) => condition_path !== 'actor.hp',
  });
  const deniedResult = new MechanicExecutor(engine, {
    resolveAuthorizedContext: (args) => denied.resolve(args),
  }).evaluate({ worldId, instanceId: 'instance.executor', actionId: 'wait' });
  assert.equal(deniedResult.status, 'unknown');
  assert.equal(deniedResult.reason_code, 'AUTHORIZED_CONTEXT_RESOLUTION_FAILED');
  assert.deepEqual(deniedResult.effects, []);

  const unboundTemplate = template({ applicability: [{ op: 'eq', path: 'world.time', value: 'night' }] });
  const unboundSetup = setup(t, 'executor-canonical-provider-unbound-world');
  enableFixture(unboundSetup.engine, unboundSetup.worldId, unboundTemplate);
  const unbound = new CanonicalEntityAttributeContextProvider(unboundSetup.engine, {
    policyVersion: 'visibility-policy-v1',
    authorizationScope: 'test-principal',
    bindings: [
      { path: 'world.weather', entity_id: 'entity.world-context', attribute: 'weather' },
      { path: 'actor.hp', entity_id: 'entity.actor-context', attribute: 'hp' },
    ],
    canRead: () => true,
  });
  const unboundResult = new MechanicExecutor(unboundSetup.engine, {
    resolveAuthorizedContext: (args) => unbound.resolve(args),
  }).evaluate({ worldId: unboundSetup.worldId, instanceId: 'instance.executor', actionId: 'wait' });
  assert.equal(unboundResult.status, 'unknown');
  assert.equal(unboundResult.reason_code, 'AUTHORIZED_CONTEXT_RESOLUTION_FAILED');
  assert.deepEqual(unboundResult.effects, []);
});


test('application executor rejects accessor-bearing trusted context without invoking getters', (t) => {
  const { engine, worldId } = setup(t, 'executor-context-accessor-world');
  enableFixture(engine, worldId);
  let getterRead = false;
  const context = { world: { weather: 'rain' }, actor: { hp: 10 } };
  Object.defineProperty(context.actor, 'secret', {
    enumerable: true,
    get() {
      getterRead = true;
      throw new Error('accessor must not execute');
    },
  });
  const result = new MechanicExecutor(engine, {
    resolveAuthorizedContext: ({ snapshot }) => ({
      context,
      knownAbsentPaths: [],
      dependencyEvidence: [
        { path: 'actor.hp', kind: 'entity_attribute', entity_id: 'entity.actor-context', attribute: 'hp' },
        { path: 'world.weather', kind: 'entity_attribute', entity_id: 'entity.world-context', attribute: 'weather' },
      ],
      world_revision: snapshot.world_revision,
      commit_sequence: snapshot.commit_sequence,
      authorization_scope: 'test-principal',
      policy_version: 'test-visibility-policy-v1',
    }),
  }).evaluate({ worldId, instanceId: 'instance.executor', actionId: 'wait' });
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason_code, 'INVALID_AUTHORIZED_CONTEXT');
  assert.equal(getterRead, false);
  assert.deepEqual(result.effects, []);
});


test('canonical context provider rejects unsafe and duplicate condition-path bindings', (t) => {
  const { engine } = setup(t, 'executor-canonical-provider-binding-validation-world');
  assert.throws(() => new CanonicalEntityAttributeContextProvider(engine, {
    policyVersion: 'visibility-policy-v1',
    authorizationScope: 'test-principal',
    bindings: [{ path: 'actor.hp', entity_id: 'entity.actor-context', attribute: '__proto__' }],
    canRead: () => true,
  }), /uniquely map a safe condition path/);
  assert.throws(() => new CanonicalEntityAttributeContextProvider(engine, {
    policyVersion: 'visibility-policy-v1',
    authorizationScope: 'test-principal',
    bindings: [
      { path: 'actor.hp', entity_id: 'entity.actor-context', attribute: 'hp' },
      { path: 'actor.hp', entity_id: 'entity.actor-context', attribute: 'health' },
    ],
    canRead: () => true,
  }), /uniquely map a safe condition path/);
});


test('application executor rejects accessor-backed context without invoking getters', (t) => {
  const { engine, worldId } = setup(t, 'executor-accessor-context-world');
  enableFixture(engine, worldId);
  let getterCalled = false;
  const world = {};
  Object.defineProperty(world, 'weather', {
    enumerable: true,
    get() {
      getterCalled = true;
      return 'rain';
    },
  });
  const result = new MechanicExecutor(engine, {
    resolveAuthorizedContext: ({ snapshot }) => ({
      context: { world, actor: { hp: 10 } },
      knownAbsentPaths: [],
      dependencyEvidence: [
        { path: 'actor.hp', kind: 'entity_attribute', entity_id: 'entity.actor-context', attribute: 'hp' },
        { path: 'world.weather', kind: 'entity_attribute', entity_id: 'entity.world-context', attribute: 'weather' },
      ],
      world_revision: snapshot.world_revision,
      commit_sequence: snapshot.commit_sequence,
      authorization_scope: 'test-principal',
      policy_version: 'test-visibility-policy-v1',
    }),
  }).evaluate({ worldId, instanceId: 'instance.executor', actionId: 'wait' });
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason_code, 'INVALID_AUTHORIZED_CONTEXT');
  assert.equal(getterCalled, false);
  assert.deepEqual(result.effects, []);
});


test('canonical context provider rejects a snapshot belonging to another world', (t) => {
  const { engine, worldId } = setup(t, 'executor-provider-world-a');
  enableFixture(engine, worldId);
  engine.createWorld({
    world_id: 'executor-provider-world-b',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    game_time: '2005-12-29T10:00:00Z',
  });
  const value = template();
  const foreignSnapshot = engine.getSnapshot('executor-provider-world-b', { includeMechanicEvaluationState: true });
  const provider = new CanonicalEntityAttributeContextProvider(engine, {
    policyVersion: 'visibility-policy-v1',
    authorizationScope: 'test-principal',
    bindings: [
      { path: 'world.weather', entity_id: 'entity.world-context', attribute: 'weather' },
      { path: 'actor.hp', entity_id: 'entity.actor-context', attribute: 'hp' },
    ],
    canRead: () => true,
  });
  assert.throws(
    () => provider.resolve({ worldId, snapshot: foreignSnapshot, template: value, action: value.actions[0] }),
    /Provider resolution requires world, snapshot, template, and action/,
  );
});


test('authorization scope changes the mechanic context fingerprint', (t) => {
  const { engine, worldId } = setup(t, 'executor-authorization-scope-fingerprint-world');
  enableFixture(engine, worldId);
  const evaluateFor = (authorization_scope) => new MechanicExecutor(engine, {
    resolveAuthorizedContext: (args) => ({
      ...contextProvider()(args),
      authorization_scope,
    }),
  }).evaluate({ worldId, instanceId: 'instance.executor', actionId: 'wait' });
  const first = evaluateFor('principal.actor-a');
  const second = evaluateFor('principal.actor-b');
  assert.equal(first.status, 'ready');
  assert.equal(second.status, 'ready');
  assert.equal(first.context_policy_version, second.context_policy_version);
  assert.notEqual(first.authorization_scope, second.authorization_scope);
  assert.notEqual(first.context_fingerprint, second.context_fingerprint);
  assert.notEqual(first.evaluation_fingerprint, second.evaluation_fingerprint);
});
