import test from 'node:test';
import assert from 'node:assert/strict';
import { MechanicEvaluationService } from '../src/application/mechanic-evaluation.js';

function fixtureSnapshot() {
  return {
    world_id: 'world.service',
    world_revision: 8,
    commit_sequence: 13,
    mechanic_evaluation_snapshot: {
      instances: [{
        instance_id: 'instance.service',
        status: 'enabled',
        template_id: 'test.service',
        template_version: '1.0.0',
        updated_revision: 7,
      }],
      templates: [{
        template_hash: 'a'.repeat(64),
        template: {
          template_id: 'test.service',
          version: '1.0.0',
          schema_version: 'core-1',
          display_name: 'Service fixture',
          required_capabilities: [],
          applicability: [{ op: 'eq', path: 'world.phase', value: 'night' }],
          actions: [{
            action_id: 'act',
            input_schema: { type: 'object' },
            preconditions: [],
            effects: [{
              effect_id: 'e1',
              kind: 'create_entity',
              target_ref: 'entity.service-created',
              payload: { entity_type: 'test' },
            }],
            ambiguity_policy: 'deterministic_only',
          }],
          conflict_policy: { mode: 'manual' },
          lifecycle_policy: { on_disable: 'require_author_decision' },
          unknown_policy: 'mark_unknown',
        },
      }],
      modules: [],
    },
  };
}

test('application evaluation service captures its own snapshot and requires a trusted context provider', async () => {
  assert.throws(() => new MechanicEvaluationService({ getSnapshot() {} }), /trusted contextProvider/);
  const snapshot = fixtureSnapshot();
  let request;
  const service = new MechanicEvaluationService({
    getSnapshot(worldId, options) {
      assert.equal(worldId, 'world.service');
      assert.deepEqual(options, { includeMechanicEvaluationState: true });
      return snapshot;
    },
  }, {
    contextProvider(input) {
      request = input;
      assert.equal(Object.isFrozen(input.snapshot), true);
      assert.equal(Object.isFrozen(input.snapshot.mechanic_evaluation_snapshot), true);
      return {
        context: { world: { phase: 'night' } },
        knownAbsentPaths: [],
        policyVersion: 'visibility-policy-v3',
        manifestId: 'manifest.service',
      };
    },
  });

  const result = await service.evaluate({
    worldId: 'world.service',
    instanceId: 'instance.service',
    actionId: 'act',
    actorContext: { adapterId: 'adapter.test', actorEntityId: 'actor.test' },
  });
  assert.equal(request.snapshot, snapshot);
  assert.equal(result.status, 'ready');
  assert.equal(result.world_revision, 8);
  assert.equal(result.commit_sequence, 13);
  assert.equal(result.commit_authority, 'none');
  assert.equal(result.context_fingerprint.length, 64);
  assert.equal(result.evaluation_fingerprint.length, 64);
});

test('application evaluation service fails closed when trusted context is unavailable or malformed', async () => {
  const makeEngine = () => ({ getSnapshot: () => fixtureSnapshot() });
  const unavailable = new MechanicEvaluationService(makeEngine(), {
    contextProvider() { throw new Error('policy backend unavailable'); },
  });
  const unavailableResult = await unavailable.evaluate({
    worldId: 'world.service', instanceId: 'instance.service', actionId: 'act',
  });
  assert.equal(unavailableResult.status, 'unknown');
  assert.equal(unavailableResult.reason_code, 'TRUSTED_CONTEXT_UNAVAILABLE');
  assert.deepEqual(unavailableResult.effects, []);

  const malformed = new MechanicEvaluationService(makeEngine(), {
    contextProvider() { return { context: {}, knownAbsentPaths: [], policyVersion: '' }; },
  });
  const malformedResult = await malformed.evaluate({
    worldId: 'world.service', instanceId: 'instance.service', actionId: 'act',
  });
  assert.equal(malformedResult.status, 'unknown');
  assert.equal(malformedResult.reason_code, 'TRUSTED_CONTEXT_CONTRACT_INVALID');
  assert.deepEqual(malformedResult.effects, []);
});

test('application evaluation service includes trusted policy version in the fingerprint', async () => {
  const engine = { getSnapshot: () => fixtureSnapshot() };
  const evaluate = (policyVersion) => new MechanicEvaluationService(engine, {
    contextProvider() {
      return { context: { world: { phase: 'night' } }, knownAbsentPaths: [], policyVersion };
    },
  }).evaluate({ worldId: 'world.service', instanceId: 'instance.service', actionId: 'act' });
  const first = await evaluate('policy-v1');
  const second = await evaluate('policy-v2');
  assert.notEqual(first.evaluation_fingerprint, second.evaluation_fingerprint);
});


test('evaluateAndPropose uses the existing guarded proposal handoff only for ready results', async () => {
  const snapshot = fixtureSnapshot();
  const calls = [];
  const proposalService = {
    createFromMechanicEvaluation(worldId, evaluation, options) {
      calls.push({ worldId, evaluation, options });
      return { proposal_id: 'proposal.test', status: 'pending', base_world_revision: evaluation.world_revision };
    },
  };
  const service = new MechanicEvaluationService({
    getSnapshot: () => snapshot,
  }, {
    proposalService,
    contextProvider: () => ({
      context: { world: { phase: 'night' } },
      knownAbsentPaths: [],
      policyVersion: 'policy-v1',
    }),
  });
  const result = await service.evaluateAndPropose({
    worldId: 'world.service',
    instanceId: 'instance.service',
    actionId: 'act',
    idempotencyKey: 'idem.service',
    turnId: 'turn.service',
    sourceText: 'deterministic mechanic action',
    adapterId: 'adapter.service',
  });
  assert.equal(result.evaluation.status, 'ready');
  assert.equal(result.proposal.status, 'pending');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].evaluation.snapshot_identity.world_revision, 8);
  assert.equal(calls[0].evaluation.snapshot_identity.commit_sequence, 13);
  assert.equal(calls[0].options.adapterId, 'adapter.service');

  const unknownService = new MechanicEvaluationService({
    getSnapshot: () => fixtureSnapshot(),
  }, {
    proposalService,
    contextProvider: () => { throw new Error('not authorized'); },
  });
  const unknown = await unknownService.evaluateAndPropose({
    worldId: 'world.service', instanceId: 'instance.service', actionId: 'act',
    idempotencyKey: 'idem.unknown', turnId: 'turn.unknown',
    sourceText: 'should not be proposed', adapterId: 'adapter.service',
  });
  assert.equal(unknown.evaluation.status, 'unknown');
  assert.equal(unknown.proposal, null);
  assert.equal(calls.length, 1);
});
