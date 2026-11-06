import test from 'node:test';
import assert from 'node:assert/strict';
import { collectConditionDependencies } from '../src/core/rules.js';

test('collects every branch path, including a branch not taken by the current context', () => {
  const rule = {
    op: 'any',
    rules: [
      { op: 'eq', path: 'actor.infected', value: true },
      { op: 'all', conditions: [
        { op: 'gt', path: 'actor.hp', value: 0 },
        { op: 'exists', path: 'world.cure_available', value: true },
      ] },
    ],
  };
  assert.deepEqual(collectConditionDependencies(rule), ['actor.hp', 'actor.infected', 'world.cure_available']);
});

test('deduplicates dependencies and sorts deterministically', () => {
  assert.deepEqual(collectConditionDependencies({
    op: 'all',
    rules: [
      { op: 'eq', path: 'z', value: 1 },
      { op: 'not', condition: { op: 'eq', path: 'a', value: 2 } },
      { op: 'eq', path: 'z', value: 3 },
    ],
  }), ['a', 'z']);
});

test('rejects unsupported operators, unsafe paths and malformed nested rules', () => {
  assert.throws(() => collectConditionDependencies({ op: 'custom', path: 'actor.hp' }), /Unsupported operator/);
  assert.throws(() => collectConditionDependencies({ op: 'exists', path: 'actor.__proto__' }), /Unsafe or empty rule path/);
  assert.throws(() => collectConditionDependencies({ op: 'all', rules: [{ op: 'eq', path: 'ok', value: 1 }, null] }), /Condition must be an object/);
});
