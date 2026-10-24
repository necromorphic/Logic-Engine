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
