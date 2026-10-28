import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCondition, evaluateConditionResult } from '../src/core/rules.js';

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

test('JSON equality is order-independent for objects and order-sensitive for arrays', () => {
  const equal = (contextValue, ruleValue) => evaluateCondition(
    { op: 'eq', path: 'value', value: ruleValue },
    { value: contextValue },
  );

  assert.equal(equal({ b: 2, a: 1 }, { a: 1, b: 2 }), true);
  assert.equal(equal([1, 2], [2, 1]), false);
});

test('rule equality rejects non-JSON context and operands instead of coercing them', () => {
  const eq = (contextValue, ruleValue) => evaluateCondition(
    { op: 'eq', path: 'value', value: ruleValue },
    { value: contextValue },
  );
  const neq = (contextValue, ruleValue) => evaluateCondition(
    { op: 'neq', path: 'value', value: ruleValue },
    { value: contextValue },
  );

  for (const [contextValue, ruleValue] of [
    [Number.NaN, null],
    [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
    [undefined, undefined],
    [{ nested: undefined }, {}],
    [new Date('2026-01-01T00:00:00.000Z'), {}],
  ]) {
    assert.throws(() => eq(contextValue, ruleValue), (error) => error.code === 'RULE_TYPE_MISMATCH');
    assert.throws(() => neq(contextValue, ruleValue), (error) => error.code === 'RULE_TYPE_MISMATCH');
  }

  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => eq(cyclic, cyclic), (error) => error.code === 'RULE_TYPE_MISMATCH');

  let getterCalled = false;
  const accessorValue = {};
  Object.defineProperty(accessorValue, 'secret', {
    enumerable: true,
    get() {
      getterCalled = true;
      return 'value';
    },
  });
  assert.throws(() => eq(accessorValue, { secret: 'value' }), (error) => error.code === 'RULE_TYPE_MISMATCH');
  assert.equal(getterCalled, false);

  const sparse = [];
  sparse.length = 1;
  assert.throws(() => eq(sparse, [null]), (error) => error.code === 'RULE_TYPE_MISMATCH');
});

test('rule equality rejects non-enumerable properties in objects and arrays', () => {
  const eq = (contextValue, ruleValue) => evaluateCondition(
    { op: 'eq', path: 'value', value: ruleValue },
    { value: contextValue },
  );

  const hiddenObjectProperty = { visible: 1 };
  Object.defineProperty(hiddenObjectProperty, 'hidden', {
    value: 2,
    enumerable: false,
  });
  assert.throws(() => eq(hiddenObjectProperty, { visible: 1 }), (error) => error.code === 'RULE_TYPE_MISMATCH');
  assert.throws(() => eq({ visible: 1 }, hiddenObjectProperty), (error) => error.code === 'RULE_TYPE_MISMATCH');

  const hiddenArrayProperty = [1];
  Object.defineProperty(hiddenArrayProperty, 'hidden', {
    value: 2,
    enumerable: false,
  });
  assert.throws(() => eq(hiddenArrayProperty, [1]), (error) => error.code === 'RULE_TYPE_MISMATCH');
  assert.throws(() => eq([1], hiddenArrayProperty), (error) => error.code === 'RULE_TYPE_MISMATCH');
});

test('rule equality rejects deeply nested and oversized JSON values without recursion failure', () => {
  const eq = (value) => evaluateCondition(
    { op: 'eq', path: 'value', value },
    { value: null },
  );

  let deeplyNested = null;
  for (let index = 0; index < 66; index += 1) deeplyNested = { child: deeplyNested };
  assert.throws(() => eq(deeplyNested), (error) => error.code === 'RULE_TYPE_MISMATCH');

  const oversized = Array.from({ length: 10001 }, (_, index) => index);
  assert.throws(() => eq(oversized), (error) => error.code === 'RULE_TYPE_MISMATCH');
});
