import test from 'node:test';
import assert from 'node:assert/strict';
import { collectConditionDependencies, evaluateCondition } from '../src/core/rules.js';

test('collects every branch path, including a branch not taken by this context', () => {
  const rule = {
    op: 'any',
    rules: [
      { op: 'eq', path: 'actor.infected', value: true },
      {
        op: 'all',
        conditions: [
          { op: 'gt', path: 'actor.hp', value: 0 },
          { op: 'exists', path: 'world.cure_available', value: true },
        ],
      },
    ],
  };
  assert.equal(evaluateCondition(rule, { actor: { infected: true } }), true);
  assert.deepEqual(collectConditionDependencies(rule), [
    'actor.hp',
    'actor.infected',
    'world.cure_available',
  ]);
});

test('treats missing and negative/absence paths as dependencies too', () => {
  const rule = {
    op: 'all',
    rules: [
      { op: 'exists', path: 'claims.curse', value: false },
      { op: 'neq', path: 'actor.status', value: 'dead' },
    ],
  };
  assert.deepEqual(collectConditionDependencies(rule), ['actor.status', 'claims.curse']);
});

test('deduplicates paths and returns deterministic sorted output', () => {
  const rule = {
    op: 'any',
    rules: [
      { op: 'eq', path: 'z', value: 1 },
      { op: 'not', condition: { op: 'eq', path: 'a', value: 2 } },
      { op: 'eq', path: 'z', value: 3 },
    ],
  };
  assert.deepEqual(collectConditionDependencies(rule), ['a', 'z']);
});

test('rejects unsupported operators rather than claiming a complete read set', () => {
  assert.throws(
    () => collectConditionDependencies({ op: 'custom', path: 'actor.hp' }),
    /Unsupported operator/,
  );
});

test('rejects unsafe path segments', () => {
  assert.throws(
    () => collectConditionDependencies({ op: 'exists', path: 'actor.__proto__' }),
    /Unsafe or empty rule path/,
  );
});

test('rejects malformed nested rules rather than returning a partial dependency set', () => {
  assert.throws(
    () => collectConditionDependencies({ op: 'all', rules: [{ op: 'eq', path: 'ok', value: 1 }, null] }),
    /Condition must be an object/,
  );
});


test('mechanic dependency summary covers all condition-bearing template sections but marks whole-mechanic completeness unknown', async () => {
  const { collectMechanicConditionDependencies } = await import('../src/core/mechanics.js');
  const template = {
    template_id: 'test.dependencies',
    version: '1.0.0',
    schema_version: 'core-1',
    display_name: 'Dependency fixture',
    required_capabilities: [],
    applicability: [{ op: 'eq', path: 'world.weather', value: 'rain' }],
    eligible_participants: [{
      role_id: 'actor',
      constraints: [{ op: 'exists', path: 'actor.id', value: true }],
    }],
    actions: [{
      action_id: 'act',
      input_schema: { type: 'object' },
      preconditions: [{ op: 'gt', path: 'actor.hp', value: 0 }],
      constraints: [{ op: 'neq', path: 'actor.status', value: 'dead' }],
      effects: [{
        effect_id: 'effect-1',
        kind: 'emit_event',
        target_ref: 'world',
        payload: { message: 'rain action' },
      }],
      ambiguity_policy: 'deterministic_only',
    }],
    interactions: [{
      interaction_id: 'interaction-1',
      other_template_id: 'test.other',
      policy: 'compatible',
      conditions: [{ op: 'eq', path: 'world.phase', value: 'night' }],
    }],
    conflict_policy: { mode: 'manual' },
    lifecycle_policy: { on_disable: 'require_author_decision' },
    unknown_policy: 'mark_unknown',
  };
  const result = collectMechanicConditionDependencies(template);
  assert.deepEqual(result.condition_paths, [
    'actor.hp',
    'actor.id',
    'actor.status',
    'world.phase',
    'world.weather',
  ]);
  assert.equal(result.condition_dependencies_complete, true);
  assert.equal(result.mechanic_dependencies_complete, false);
  assert.deepEqual(result.unresolved_sources, [
    'effect-intent payload binding',
    'registered module inputs and reads',
  ]);
});


test('mechanic action condition preflight returns true only when all supported conditions pass', async () => {
  const { evaluateMechanicActionConditions } = await import('../src/core/mechanics.js');
  const template = {
    template_id: 'test.preflight',
    version: '1.0.0',
    schema_version: 'core-1',
    display_name: 'Preflight fixture',
    required_capabilities: [],
    applicability: [{ op: 'eq', path: 'world.weather', value: 'rain' }],
    actions: [{
      action_id: 'wait',
      input_schema: { type: 'object' },
      preconditions: [{ op: 'gt', path: 'actor.hp', value: 0 }],
      constraints: [{ op: 'neq', path: 'actor.status', value: 'dead' }],
      effects: [{
        effect_id: 'effect-1',
        kind: 'emit_event',
        target_ref: 'world',
        payload: { message: 'wait' },
      }],
      ambiguity_policy: 'deterministic_only',
    }],
    conflict_policy: { mode: 'manual' },
    lifecycle_policy: { on_disable: 'require_author_decision' },
    unknown_policy: 'mark_unknown',
  };
  const result = evaluateMechanicActionConditions(template, 'wait', {
    world: { weather: 'rain' },
    actor: { hp: 10, status: 'alive' },
  });
  assert.equal(result.status, 'true');
  assert.equal(result.reason_code, null);
  assert.deepEqual(result.unknown_paths, []);
  assert.deepEqual(result.condition_results.map((item) => item.status), ['true', 'true', 'true']);
});

test('mechanic action condition preflight preserves unknown instead of treating missing context as false', async () => {
  const { evaluateMechanicActionConditions } = await import('../src/core/mechanics.js');
  const template = {
    template_id: 'test.preflight.unknown',
    version: '1.0.0',
    schema_version: 'core-1',
    display_name: 'Unknown preflight fixture',
    required_capabilities: [],
    applicability: [{ op: 'eq', path: 'world.weather', value: 'rain' }],
    actions: [{
      action_id: 'act',
      input_schema: { type: 'object' },
      preconditions: [{ op: 'exists', path: 'actor.injury', value: false }],
      effects: [],
      ambiguity_policy: 'deterministic_only',
    }],
    conflict_policy: { mode: 'manual' },
    lifecycle_policy: { on_disable: 'require_author_decision' },
    unknown_policy: 'mark_unknown',
  };
  const result = evaluateMechanicActionConditions(template, 'act', { world: {} });
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason_code, 'MECHANIC_CONDITION_CONTEXT_UNKNOWN');
  assert.deepEqual(result.unknown_paths, ['actor.injury', 'world.weather']);
});

test('mechanic action condition preflight lets a decisive false dominate unknown and never emits effects', async () => {
  const { evaluateMechanicActionConditions } = await import('../src/core/mechanics.js');
  const template = {
    template_id: 'test.preflight.false',
    version: '1.0.0',
    schema_version: 'core-1',
    display_name: 'False preflight fixture',
    required_capabilities: [],
    applicability: [{ op: 'eq', path: 'world.weather', value: 'sun' }],
    actions: [{
      action_id: 'act',
      input_schema: { type: 'object' },
      preconditions: [{ op: 'exists', path: 'actor.injury', value: false }],
      effects: [{
        effect_id: 'effect-1',
        kind: 'emit_event',
        target_ref: 'world',
        payload: { message: 'must not escape preflight' },
      }],
      ambiguity_policy: 'deterministic_only',
    }],
    conflict_policy: { mode: 'manual' },
    lifecycle_policy: { on_disable: 'require_author_decision' },
    unknown_policy: 'mark_unknown',
  };
  const result = evaluateMechanicActionConditions(template, 'act', { world: { weather: 'rain' } });
  assert.equal(result.status, 'false');
  assert.equal(result.reason_code, 'MECHANIC_CONDITION_NOT_SATISFIED');
  assert.equal(Object.hasOwn(result, 'effects'), false);
  assert.equal(Object.hasOwn(result, 'proposal'), false);
});

test('mechanic action condition preflight rejects an unknown action id without side effects', async () => {
  const { evaluateMechanicActionConditions } = await import('../src/core/mechanics.js');
  const template = {
    template_id: 'test.preflight.missing',
    version: '1.0.0',
    schema_version: 'core-1',
    display_name: 'Missing action fixture',
    required_capabilities: [],
    applicability: [],
    actions: [],
    conflict_policy: { mode: 'manual' },
    lifecycle_policy: { on_disable: 'require_author_decision' },
    unknown_policy: 'mark_unknown',
  };
  const result = evaluateMechanicActionConditions(template, 'not-present', {});
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason_code, 'MECHANIC_ACTION_NOT_FOUND');
  assert.deepEqual(result.condition_results, []);
});


test('mechanic action condition preflight accepts only caller-attested absence and does not mutate frozen inputs', async () => {
  const { evaluateMechanicActionConditions } = await import('../src/core/mechanics.js');
  const template = Object.freeze({
    template_id: 'test.preflight.absence',
    version: '1.0.0',
    schema_version: 'core-1',
    display_name: 'Absence preflight fixture',
    required_capabilities: [],
    applicability: Object.freeze([]),
    actions: Object.freeze([Object.freeze({
      action_id: 'act',
      input_schema: Object.freeze({ type: 'object' }),
      preconditions: Object.freeze([{ op: 'exists', path: 'claims.curse', value: false }].map(Object.freeze)),
      effects: Object.freeze([]),
      ambiguity_policy: 'deterministic_only',
    })]),
    conflict_policy: Object.freeze({ mode: 'manual' }),
    lifecycle_policy: Object.freeze({ on_disable: 'require_author_decision' }),
    unknown_policy: 'mark_unknown',
  });
  const context = Object.freeze({ world: Object.freeze({ phase: 'night' }) });
  const unknown = evaluateMechanicActionConditions(template, 'act', context);
  assert.equal(unknown.status, 'unknown');
  assert.deepEqual(unknown.unknown_paths, ['claims.curse']);

  const knownAbsent = evaluateMechanicActionConditions(template, 'act', context, {
    knownAbsentPaths: ['claims.curse'],
  });
  assert.equal(knownAbsent.status, 'true');
  assert.deepEqual(knownAbsent.unknown_paths, []);
  assert.deepEqual(context, { world: { phase: 'night' } });
  assert.equal(template.actions[0].effects.length, 0);
});

test('mechanic action condition preflight rejects contradictory trusted absence claims', async () => {
  const { evaluateMechanicActionConditions } = await import('../src/core/mechanics.js');
  const template = {
    template_id: 'test.preflight.contradiction',
    version: '1.0.0',
    schema_version: 'core-1',
    display_name: 'Contradiction fixture',
    required_capabilities: [],
    applicability: [],
    actions: [{
      action_id: 'act',
      input_schema: { type: 'object' },
      preconditions: [{ op: 'exists', path: 'actor.id', value: true }],
      effects: [],
      ambiguity_policy: 'deterministic_only',
    }],
    conflict_policy: { mode: 'manual' },
    lifecycle_policy: { on_disable: 'require_author_decision' },
    unknown_policy: 'mark_unknown',
  };
  assert.throws(
    () => evaluateMechanicActionConditions(template, 'act', { actor: { id: 'actor.1' } }, {
      knownAbsentPaths: ['actor.id'],
    }),
    (error) => error.code === 'CONTRADICTORY_KNOWN_ABSENCE',
  );
});



test('translateMechanicEffectIntents maps only the selected deterministic action and preserves provenance', async () => {
  const { translateMechanicEffectIntents } = await import('../src/core/mechanics.js');
  const fixture = {
    template_id: 'test.effect.mapping',
    version: '1.0.0',
    schema_version: 'core-1',
    display_name: 'Effect mapping fixture',
    required_capabilities: [],
    applicability: [],
    actions: [
      {
        action_id: 'act',
        input_schema: { type: 'object' },
        preconditions: [],
        effects: [
          { effect_id: 'create-1', kind: 'create_entity', target_ref: 'entity.new', payload: { entity_type: 'character', attributes: { name: 'A' } } },
          { effect_id: 'update-1', kind: 'update_attribute', target_ref: 'entity.new', payload: { attributes: { mood: 'calm' } } },
          { effect_id: 'fact-1', kind: 'assert_fact', target_ref: 'fact.known', payload: { subject_ref: 'entity.new', predicate: 'known', value: true } },
        ],
        ambiguity_policy: 'deterministic_only',
      },
      {
        action_id: 'alternative',
        input_schema: { type: 'object' },
        preconditions: [],
        effects: [{ effect_id: 'alternative-effect', kind: 'emit_event', target_ref: 'world', payload: { message: 'not selected' } }],
        ambiguity_policy: 'deterministic_only',
      },
    ],
    conflict_policy: { mode: 'manual' },
    lifecycle_policy: { on_disable: 'require_author_decision' },
    unknown_policy: 'mark_unknown',
  };
  const result = translateMechanicEffectIntents(fixture, 'act');
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.effects.map((effect) => effect.kind), ['entity.create', 'entity.update', 'fact.set']);
  assert.deepEqual(result.effect_provenance.map((item) => item.effect_id), ['create-1', 'update-1', 'fact-1']);
  assert.deepEqual(result.effects[0], {
    kind: 'entity.create', entity_id: 'entity.new', entity_type: 'character', attributes: { name: 'A' },
  });
  assert.equal(translateMechanicEffectIntents(fixture, 'alternative').reason_code, 'UNSUPPORTED_EFFECT_INTENT');
  assert.equal(translateMechanicEffectIntents(fixture, 'missing').reason_code, 'MECHANIC_ACTION_NOT_FOUND');
});

test('translateMechanicEffectIntents rejects unsupported intents atomically without partial effects', async () => {
  const { translateMechanicEffectIntents } = await import('../src/core/mechanics.js');
  const fixture = {
    template_id: 'test.effect.unsupported',
    version: '1.0.0',
    schema_version: 'core-1',
    display_name: 'Unsupported effect fixture',
    required_capabilities: [],
    applicability: [],
    actions: [{
      action_id: 'act',
      input_schema: { type: 'object' },
      preconditions: [],
      effects: [
        { effect_id: 'ok', kind: 'create_entity', target_ref: 'entity.new', payload: { entity_type: 'character' } },
        { effect_id: 'bad', kind: 'emit_event', target_ref: 'world', payload: { message: 'no mapping' } },
      ],
      ambiguity_policy: 'deterministic_only',
    }],
    conflict_policy: { mode: 'manual' },
    lifecycle_policy: { on_disable: 'require_author_decision' },
    unknown_policy: 'mark_unknown',
  };
  const result = translateMechanicEffectIntents(fixture, 'act');
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason_code, 'UNSUPPORTED_EFFECT_INTENT');
  assert.deepEqual(result.effects, []);
  assert.deepEqual(result.effect_provenance, []);
});

test('translateMechanicEffectIntents rejects unknown fields, empty patches, duplicate IDs, unresolved provenance, and invalid Core effects', async () => {
  const { translateMechanicEffectIntents } = await import('../src/core/mechanics.js');
  const make = (effects, ambiguity_policy = 'deterministic_only') => ({
    template_id: 'test.effect.invalid',
    version: '1.0.0',
    schema_version: 'core-1',
    display_name: 'Invalid effect fixture',
    required_capabilities: [],
    applicability: [],
    actions: [{ action_id: 'act', input_schema: { type: 'object' }, preconditions: [], effects, ambiguity_policy }],
    conflict_policy: { mode: 'manual' },
    lifecycle_policy: { on_disable: 'require_author_decision' },
    unknown_policy: 'mark_unknown',
  });
  const base = { effect_id: 'e1', kind: 'create_entity', target_ref: 'entity.new', payload: { entity_type: 'character' } };
  assert.equal(translateMechanicEffectIntents(make([{ ...base, payload: { ...base.payload, expression: 'x' } }]), 'act').reason_code, 'UNSUPPORTED_EFFECT_PAYLOAD_FIELD');
  assert.equal(translateMechanicEffectIntents(make([{ effect_id: 'e1', kind: 'update_attribute', target_ref: 'entity.a', payload: {} }]), 'act').reason_code, 'EMPTY_EFFECT_PATCH');
  assert.equal(translateMechanicEffectIntents(make([base, { ...base }]), 'act').reason_code, 'DUPLICATE_EFFECT_ID');
  assert.equal(translateMechanicEffectIntents(make([{ ...base, source_refs: ['event.x'] }]), 'act').reason_code, 'UNSUPPORTED_EFFECT_PROVENANCE');
  const invalidEffect = translateMechanicEffectIntents(make([{ ...base, payload: { entity_type: 'character', status: 'not-a-status' } }]), 'act');
  assert.equal(invalidEffect.status, 'unknown');
  assert.equal(invalidEffect.reason_code, 'INVALID_TRANSLATED_EFFECT');
  assert.deepEqual(invalidEffect.effects, []);
  assert.equal(translateMechanicEffectIntents(make([base], 'model_proposal_then_validate'), 'act').reason_code, 'UNSUPPORTED_ACTION_AMBIGUITY_POLICY');
});


test('snapshot-bound mechanic evaluation produces a fingerprint but no commit authority', async () => {
  const { evaluateMechanicActionAgainstSnapshot } = await import('../src/core/mechanics.js');
  const snapshot = {
    world_id: 'world.test',
    world_revision: 4,
    commit_sequence: 9,
    mechanic_evaluation_snapshot: {
      instances: [{ instance_id: 'instance.test', status: 'enabled', template_id: 'test.snapshot.eval', template_version: '1.0.0', updated_revision: 3 }],
      templates: [{
        template_hash: 'a'.repeat(64),
        template: {
          template_id: 'test.snapshot.eval', version: '1.0.0', schema_version: 'core-1',
          display_name: 'Snapshot evaluation fixture', required_capabilities: [],
          applicability: [{ op: 'eq', path: 'world.phase', value: 'night' }],
          actions: [{ action_id: 'act', input_schema: { type: 'object' }, preconditions: [], effects: [
            { effect_id: 'e1', kind: 'create_entity', target_ref: 'entity.created', payload: { entity_type: 'test' } },
          ], ambiguity_policy: 'deterministic_only' }],
          conflict_policy: { mode: 'manual' }, lifecycle_policy: { on_disable: 'require_author_decision' }, unknown_policy: 'mark_unknown',
        },
      }],
      modules: [],
    },
  };
  const args = { snapshot, instanceId: 'instance.test', actionId: 'act', authorizedContext: { world: { phase: 'night' } } };
  const result = await evaluateMechanicActionAgainstSnapshot(args);
  assert.equal(result.status, 'ready');
  assert.equal(result.world_revision, 4);
  assert.equal(result.commit_sequence, 9);
  assert.match(result.evaluation_fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(result.commit_authority, 'none');
  assert.equal(result.effects.length, 1);
  assert.equal(Object.hasOwn(result, 'proposal_id'), false);
});

test('snapshot-bound mechanic evaluation fails closed for disabled instances and unresolved condition context', async () => {
  const { evaluateMechanicActionAgainstSnapshot } = await import('../src/core/mechanics.js');
  const snapshot = {
    world_id: 'world.test', world_revision: 0, commit_sequence: 0,
    mechanic_evaluation_snapshot: {
      instances: [{ instance_id: 'instance.test', status: 'disabled', template_id: 'test.snapshot.eval', template_version: '1.0.0' }],
      templates: [{ template_hash: 'a'.repeat(64), template: {
        template_id: 'test.snapshot.eval', version: '1.0.0', schema_version: 'core-1', display_name: 'Fixture',
        required_capabilities: [], applicability: [], actions: [{ action_id: 'act', input_schema: { type: 'object' }, preconditions: [
          { op: 'eq', path: 'actor.status', value: 'alive' },
        ], effects: [{ effect_id: 'e1', kind: 'create_entity', target_ref: 'entity.new', payload: { entity_type: 'test' } }], ambiguity_policy: 'deterministic_only' }],
        conflict_policy: { mode: 'manual' }, lifecycle_policy: { on_disable: 'require_author_decision' }, unknown_policy: 'mark_unknown',
      } }],
      modules: [],
    },
  };
  const disabled = await evaluateMechanicActionAgainstSnapshot({ snapshot, instanceId: 'instance.test', actionId: 'act', authorizedContext: {} });
  assert.equal(disabled.status, 'rejected');
  assert.deepEqual(disabled.effects, []);

  snapshot.mechanic_evaluation_snapshot.instances[0].status = 'enabled';
  const unknown = await evaluateMechanicActionAgainstSnapshot({ snapshot, instanceId: 'instance.test', actionId: 'act', authorizedContext: {} });
  assert.equal(unknown.status, 'unknown');
  assert.deepEqual(unknown.effects, []);
});

test('snapshot-bound mechanic evaluation refuses unsupported modules and input binding', async () => {
  const { evaluateMechanicActionAgainstSnapshot } = await import('../src/core/mechanics.js');
  const baseTemplate = {
    template_id: 'test.snapshot.unsupported', version: '1.0.0', schema_version: 'core-1', display_name: 'Fixture',
    required_capabilities: [], applicability: [], actions: [{ action_id: 'act', input_schema: { type: 'object', required: ['value'] }, preconditions: [], effects: [], ambiguity_policy: 'deterministic_only' }],
    conflict_policy: { mode: 'manual' }, lifecycle_policy: { on_disable: 'require_author_decision' }, unknown_policy: 'mark_unknown',
  };
  const makeSnapshot = (template) => ({
    world_id: 'world.test', world_revision: 0, commit_sequence: 0,
    mechanic_evaluation_snapshot: {
      instances: [{ instance_id: 'instance.test', status: 'enabled', template_id: template.template_id, template_version: template.version }],
      templates: [{ template, template_hash: 'b'.repeat(64) }], modules: [],
    },
  });
  const inputUnsupported = await evaluateMechanicActionAgainstSnapshot({
    snapshot: makeSnapshot(baseTemplate), instanceId: 'instance.test', actionId: 'act', authorizedContext: {},
  });
  assert.equal(inputUnsupported.status, 'unknown');
  assert.equal(inputUnsupported.reason_code, 'ACTION_INPUT_BINDING_UNSUPPORTED');

  const moduleTemplate = {
    ...baseTemplate, template_id: 'test.snapshot.module',
    rule_modules: [{ module_id: 'module.test', version: '1.0.0', required_capabilities: [] }],
  };
  const moduleUnsupported = await evaluateMechanicActionAgainstSnapshot({
    snapshot: makeSnapshot(moduleTemplate), instanceId: 'instance.test', actionId: 'act', authorizedContext: {},
  });
  assert.equal(moduleUnsupported.status, 'unknown');
  assert.equal(moduleUnsupported.reason_code, 'MODULE_EXECUTION_NOT_IMPLEMENTED');
  assert.deepEqual(moduleUnsupported.effects, []);
});
