import test from 'node:test';
import assert from 'node:assert/strict';
import { translateMechanicEffectIntents } from '../src/core/mechanic-effect-translator.js';
import { validateEffects } from '../src/core/rules.js';

const intent = (overrides = {}) => ({
  effect_id: 'effect-001',
  kind: 'create_entity',
  target_ref: 'entity.example',
  payload: { entity_type: 'person' },
  ...overrides,
});

function code(expected) {
  return (error) => error?.code === expected;
}

test('create_entity maps to entity.create using only supported fields', () => {
  const result = translateMechanicEffectIntents([intent({
    payload: { entity_type: 'person', status: 'active', attributes: { rank: 2 } },
  })]);
  assert.deepEqual(result, [{
    kind: 'entity.create',
    entity_id: 'entity.example',
    entity_type: 'person',
    status: 'active',
    attributes: { rank: 2 },
  }]);
  assert.doesNotThrow(() => validateEffects(result));
});

test('update_attribute maps patches, removals, and status without inventing fields', () => {
  const result = translateMechanicEffectIntents([intent({
    kind: 'update_attribute',
    payload: { attributes: { rank: 3 }, remove_attributes: ['old_rank'], status: 'inactive' },
  })]);
  assert.deepEqual(result, [{
    kind: 'entity.update',
    entity_id: 'entity.example',
    attributes: { rank: 3 },
    remove_attributes: ['old_rank'],
    status: 'inactive',
  }]);
  assert.doesNotThrow(() => validateEffects(result));
});

test('assert_fact maps fact identity, predicate, JSON value, and optional subject', () => {
  const result = translateMechanicEffectIntents([intent({
    kind: 'assert_fact',
    target_ref: 'fact.example',
    payload: { predicate: 'is_known', value: null, subject_ref: 'entity.example' },
  })]);
  assert.deepEqual(result, [{
    kind: 'fact.set',
    fact_id: 'fact.example',
    predicate: 'is_known',
    value: null,
    subject_ref: 'entity.example',
  }]);
  assert.doesNotThrow(() => validateEffects(result));
});


test('fact identity strings are validated but preserved exactly by translation', () => {
  const input = intent({
    kind: 'assert_fact',
    target_ref: ' fact.example ',
    payload: { predicate: ' is_known ', value: true, subject_ref: ' entity.example ' },
  });
  const result = translateMechanicEffectIntents([input]);
  assert.deepEqual(result, [{
    kind: 'fact.set',
    fact_id: ' fact.example ',
    predicate: ' is_known ',
    value: true,
    subject_ref: ' entity.example ',
  }]);
});

test('all other declared mechanic intent kinds are rejected explicitly', () => {
  const unsupported = [
    'create_relation', 'retract_relation', 'retract_fact', 'propose_knowledge',
    'reconcile_knowledge', 'start_process', 'advance_process', 'cancel_process',
    'create_task', 'update_task', 'create_goal', 'update_goal', 'emit_event',
    'request_adjudication', 'needs_review',
  ];
  for (const kind of unsupported) {
    assert.throws(
      () => translateMechanicEffectIntents([intent({ kind })]),
      code('UNSUPPORTED_MECHANIC_EFFECT_INTENT'),
      kind,
    );
  }
});

test('unknown intent kinds are malformed rather than silently ignored', () => {
  assert.throws(
    () => translateMechanicEffectIntents([intent({ kind: 'do_anything' })]),
    code('INVALID_MECHANIC_EFFECT_INTENT'),
  );
});

test('duplicate effect_id values fail the entire batch', () => {
  assert.throws(
    () => translateMechanicEffectIntents([
      intent(),
      intent({ target_ref: 'entity.other' }),
    ]),
    code('DUPLICATE_MECHANIC_EFFECT_ID'),
  );
});

test('non-empty provenance fails closed rather than being dropped', () => {
  assert.throws(
    () => translateMechanicEffectIntents([intent({ source_refs: ['event-1'] })]),
    code('TRANSLATION_REQUIRES_PROVENANCE_MAPPING'),
  );
  assert.throws(
    () => translateMechanicEffectIntents([intent({ caused_by: ['event-1'] })]),
    code('TRANSLATION_REQUIRES_PROVENANCE_MAPPING'),
  );
});

test('unknown payload fields and malformed required fields fail closed', () => {
  assert.throws(
    () => translateMechanicEffectIntents([intent({ payload: { entity_type: 'person', secret: true } })]),
    code('INVALID_MECHANIC_EFFECT_INTENT'),
  );
  assert.throws(
    () => translateMechanicEffectIntents([intent({ payload: {} })]),
    code('INVALID_MECHANIC_EFFECT_INTENT'),
  );
  assert.throws(
    () => translateMechanicEffectIntents([intent({ payload: { entity_type: 'person', status: 'maybe' } })]),
    code('INVALID_MECHANIC_EFFECT_INTENT'),
  );
});

test('empty update patches and overlapping patch/removal keys are rejected', () => {
  for (const payload of [{ attributes: {} }, { remove_attributes: [] }, { attributes: { name: 'x' }, remove_attributes: ['name'] }]) {
    assert.throws(
      () => translateMechanicEffectIntents([intent({ kind: 'update_attribute', payload })]),
      code('INVALID_MECHANIC_EFFECT_INTENT'),
    );
  }
});

test('duplicate removal keys and invalid JSON values are rejected', () => {
  assert.throws(
    () => translateMechanicEffectIntents([intent({ kind: 'update_attribute', payload: { remove_attributes: ['x', 'x'] } })]),
    code('INVALID_MECHANIC_EFFECT_INTENT'),
  );
  assert.throws(
    () => translateMechanicEffectIntents([intent({ kind: 'assert_fact', target_ref: 'fact.example', payload: { predicate: 'p', value: Number.NaN } })]),
    code('INVALID_MECHANIC_EFFECT_INTENT'),
  );
});

test('a batch with one valid and one invalid intent never returns partial output', () => {
  assert.throws(
    () => translateMechanicEffectIntents([
      intent(),
      intent({ effect_id: 'effect-002', kind: 'create_relation' }),
    ]),
    code('UNSUPPORTED_MECHANIC_EFFECT_INTENT'),
  );
});

test('translation is deterministic, does not mutate inputs, and returns detached nested values', () => {
  const input = [intent({ payload: { entity_type: 'person', attributes: { nested: { rank: 2 } } } })];
  const before = structuredClone(input);
  const first = translateMechanicEffectIntents(input);
  const second = translateMechanicEffectIntents(input);
  assert.deepEqual(first, second);
  assert.deepEqual(input, before);
  first[0].attributes.nested.rank = 99;
  assert.deepEqual(input, before);
});

test('target identifiers and batch size are bounded', () => {
  assert.throws(
    () => translateMechanicEffectIntents([intent({ target_ref: 'x'.repeat(201) })]),
    code('INVALID_MECHANIC_EFFECT_INTENT'),
  );
  assert.throws(
    () => translateMechanicEffectIntents(Array.from({ length: 129 }, (_, i) => intent({
      effect_id: 'effect-' + i,
      target_ref: 'entity-' + i,
    }))),
    code('INVALID_MECHANIC_EFFECT_INTENT'),
  );
});

test('fact identity strings reject surrounding whitespace and preserve valid values exactly', () => {
  const invalidCases = [
    intent({ kind: 'assert_fact', target_ref: ' fact.example ', payload: { predicate: 'is_known', value: true, subject_ref: 'entity.example' } }),
    intent({ kind: 'assert_fact', target_ref: 'fact.example', payload: { predicate: ' is_known ', value: true, subject_ref: 'entity.example' } }),
    intent({ kind: 'assert_fact', target_ref: 'fact.example', payload: { predicate: 'is_known', value: true, subject_ref: ' entity.example ' } }),
  ];
  for (const invalid of invalidCases) {
    assert.throws(
      () => translateMechanicEffectIntents([invalid]),
      code('INVALID_MECHANIC_EFFECT_INTENT'),
    );
  }

  const result = translateMechanicEffectIntents([intent({
    kind: 'assert_fact',
    target_ref: 'fact.example',
    payload: { predicate: 'is_known', value: true, subject_ref: 'entity.example' },
  })]);
  assert.deepEqual(result, [{
    kind: 'fact.set',
    fact_id: 'fact.example',
    predicate: 'is_known',
    value: true,
    subject_ref: 'entity.example',
  }]);
  assert.doesNotThrow(() => validateEffects(result));
});


test('empty mechanic intent batches are rejected explicitly', () => {
  assert.throws(
    () => translateMechanicEffectIntents([]),
    code('INVALID_MECHANIC_EFFECT_INTENT'),
  );
});
