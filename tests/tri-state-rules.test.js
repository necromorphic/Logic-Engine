import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCondition, evaluateConditionResult, validateEffects } from '../src/core/rules.js';

test('result API preserves legacy Boolean behavior while exposing missing context as unknown', () => {
  const rule = { op: 'eq', path: 'actor.location', value: 'office' };
  assert.equal(evaluateCondition(rule, {}), false);
  assert.deepEqual(evaluateConditionResult(rule, {}), {
    status: 'unknown',
    unknown_paths: ['actor.location'],
  });
  assert.deepEqual(evaluateConditionResult(rule, { actor: { location: 'office' } }), {
    status: 'true',
    unknown_paths: [],
  });
  assert.deepEqual(evaluateConditionResult(rule, { actor: { location: 'street' } }), {
    status: 'false',
    unknown_paths: [],
  });
});

test('unknown propagates through not and nested all/any without becoming false', () => {
  const missing = { op: 'eq', path: 'actor.secret', value: 'known' };
  assert.deepEqual(evaluateConditionResult({ op: 'not', rules: [missing] }, {}), {
    status: 'unknown',
    unknown_paths: ['actor.secret'],
  });
  assert.deepEqual(evaluateConditionResult({ op: 'all', rules: [
    { op: 'eq', path: 'actor.alive', value: true },
    missing,
  ] }, { actor: { alive: false } }), {
    status: 'false',
    unknown_paths: ['actor.secret'],
  });
  assert.deepEqual(evaluateConditionResult({ op: 'any', rules: [
    { op: 'eq', path: 'actor.alive', value: true },
    missing,
  ] }, { actor: { alive: true } }), {
    status: 'true',
    unknown_paths: ['actor.secret'],
  });
  assert.deepEqual(evaluateConditionResult({ op: 'any', rules: [
    { op: 'eq', path: 'actor.alive', value: true },
    missing,
  ] }, { actor: { alive: false } }), {
    status: 'unknown',
    unknown_paths: ['actor.secret'],
  });
});

test('explicitly proven absence is distinct from unavailable context', () => {
  const rule = { op: 'exists', path: 'actor.cover_identity' };
  assert.deepEqual(evaluateConditionResult(rule, {}), {
    status: 'unknown',
    unknown_paths: ['actor.cover_identity'],
  });
  assert.deepEqual(evaluateConditionResult(rule, {}, { knownAbsentPaths: ['actor.cover_identity'] }), {
    status: 'false',
    unknown_paths: [],
  });
  assert.deepEqual(evaluateConditionResult({ op: 'not', rules: [rule] }, {}, {
    knownAbsentPaths: ['actor.cover_identity'],
  }), {
    status: 'true',
    unknown_paths: [],
  });
  assert.deepEqual(evaluateConditionResult({
    op: 'neq', path: 'actor.cover_identity', value: 'public',
  }, {}, { knownAbsentPaths: ['actor.cover_identity'] }), {
    status: 'true',
    unknown_paths: [],
  });
  assert.throws(
    () => evaluateConditionResult(rule, { actor: { cover_identity: 'public' } }, {
      knownAbsentPaths: ['actor.cover_identity'],
    }),
    (error) => error.code === 'CONTRADICTORY_KNOWN_ABSENCE',
  );
});

test('result API rejects malformed options and unsafe absence paths', () => {
  const rule = { op: 'exists', path: 'flag' };
  assert.throws(
    () => evaluateConditionResult(rule, {}, { unknownMeansFalse: true }),
    (error) => error.code === 'INVALID_RULE_RESULT_OPTIONS',
  );
  assert.throws(
    () => evaluateConditionResult(rule, {}, { knownAbsentPaths: ['actor.__proto__.secret'] }),
    (error) => error.code === 'INVALID_RULE_PATH',
  );
  assert.throws(
    () => evaluateConditionResult(rule, {}, { knownAbsentPaths: 'flag' }),
    (error) => error.code === 'INVALID_RULE_RESULT_OPTIONS',
  );
});

test('result API preserves the existing validation errors for malformed rules', () => {
  assert.throws(
    () => evaluateConditionResult({ op: 'gt', path: 'score', value: 'high' }, { score: 5 }),
    (error) => error.code === 'RULE_TYPE_MISMATCH',
  );
  assert.throws(
    () => evaluateConditionResult({ op: 'unsupported', path: 'flag', value: true }, {}),
    (error) => error.code === 'UNSUPPORTED_RULE_OPERATOR',
  );
});


test('rejects accessor-backed rule fields without executing getters', () => {
  let reads = 0;
  const rule = { path: 'flag', value: true };
  Object.defineProperty(rule, 'op', { enumerable: true, get() { reads += 1; return 'eq'; } });
  assert.throws(() => evaluateCondition(rule, { flag: true }), (error) => error.code === 'INVALID_RULE');
  assert.equal(reads, 0);
  assert.throws(() => evaluateConditionResult({ op: 'exists', path: 'flag' }, {}, Object.defineProperty({}, 'knownAbsentPaths', {
    enumerable: true, get() { reads += 1; return []; },
  })), (error) => error.code === 'INVALID_RULE_RESULT_OPTIONS');
  assert.equal(reads, 0);
});

test('rejects accessor-backed context path properties without executing getters', () => {
  let reads = 0;
  const actor = {};
  Object.defineProperty(actor, 'secret', { enumerable: true, get() { reads += 1; return 'hidden'; } });
  assert.throws(
    () => evaluateCondition({ op: 'eq', path: 'actor.secret', value: 'hidden' }, { actor }),
    (error) => error.code === 'INVALID_RULE_CONTEXT',
  );
  assert.equal(reads, 0);
});

test('rejects sparse and accessor-backed arrays in nested rules and membership checks', () => {
  const sparse = new Array(1);
  assert.throws(
    () => evaluateCondition({ op: 'all', rules: sparse }, {}),
    (error) => error.code === 'INVALID_RULE',
  );
  let reads = 0;
  const values = [];
  Object.defineProperty(values, '0', { enumerable: true, configurable: true, get() { reads += 1; return 'x'; } });
  values.length = 1;
  assert.throws(
    () => evaluateCondition({ op: 'in', path: 'value', values }, { value: 'x' }),
    (error) => error.code === 'INVALID_RULE',
  );
  assert.equal(reads, 0);
});


test('rejects accessor-backed and cyclic nested comparison values without executing getters', () => {
  let reads = 0;
  const nested = {};
  Object.defineProperty(nested, 'secret', { enumerable: true, get() { reads += 1; return 'x'; } });
  assert.throws(
    () => evaluateCondition({ op: 'eq', path: 'actor', value: { secret: 'x' } }, { actor: nested }),
    (error) => error.code === 'INVALID_RULE_VALUE',
  );
  assert.equal(reads, 0);

  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(
    () => evaluateCondition({ op: 'eq', path: 'actor', value: {} }, { actor: cyclic }),
    (error) => error.code === 'INVALID_RULE_VALUE',
  );
});


test('canonical effect validation rejects accessor-backed effects without executing getters', () => {
  let reads = 0;
  const effect = { kind: 'entity.delete', entity_id: 'entity-1' };
  Object.defineProperty(effect, 'entity_id', {
    enumerable: true,
    get() { reads += 1; return 'entity-1'; },
  });
  assert.throws(() => validateEffects([effect]), (error) => error.code === 'INVALID_EFFECT');
  assert.equal(reads, 0);
});

test('canonical effect validation rejects unsafe nested JSON values and malformed arrays', () => {
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(
    () => validateEffects([{ kind: 'entity.create', entity_id: 'entity-1', entity_type: 'actor', attributes: cyclic }]),
    (error) => error.code === 'INVALID_EFFECT',
  );

  const sparse = new Array(1);
  assert.throws(
    () => validateEffects(sparse),
    (error) => error.code === 'INVALID_EFFECTS',
  );
});
