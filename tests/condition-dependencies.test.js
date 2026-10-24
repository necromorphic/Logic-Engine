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
