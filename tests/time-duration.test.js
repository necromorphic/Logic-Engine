import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDurationDecision } from '../src/time/duration.js';

test('fixed duration is authoritative and cannot be overridden by a model proposal', () => {
  assert.deepEqual(resolveDurationDecision({ kind: 'fixed', units: 12_345 }, { category: 'long', units: 1 }), {
    status: 'resolved', certainty: 'fixed', units: 12_345, source: 'world_rule',
  });
});

test('range duration resolves deterministically or asks the author', () => {
  assert.deepEqual(resolveDurationDecision({
    kind: 'range', min_units: 10, max_units: 21, resolution: 'midpoint',
  }), {
    status: 'resolved', certainty: 'range', units: 15, min_units: 10, max_units: 21, source: 'world_rule_midpoint',
  });
  assert.deepEqual(resolveDurationDecision({
    kind: 'range', min_units: 10, max_units: 21, resolution: 'author',
  }), {
    status: 'needs_author', certainty: 'range', min_units: 10, max_units: 21, source: 'world_rule',
  });
});

test('a model may select only a category whose duration is declared by the world', () => {
  const rule = {
    kind: 'category_map',
    categories: [{ category: 'brief', units: 30 }, { category: 'extended', units: 300 }],
  };
  assert.deepEqual(resolveDurationDecision(rule, { category: 'extended' }), {
    status: 'resolved', certainty: 'fixed', units: 300, category: 'extended', source: 'world_rule_category',
  });
  assert.deepEqual(resolveDurationDecision(rule), {
    status: 'needs_author', certainty: 'unknown', reason: 'CATEGORY_PROPOSAL_REQUIRED',
  });
  assert.deepEqual(resolveDurationDecision(rule, { category: 'unbounded' }), {
    status: 'rejected', certainty: 'unknown', reason: 'CATEGORY_NOT_ALLOWED',
  });
  assert.deepEqual(resolveDurationDecision(rule, { category: 'brief', units: 999999 }), {
    status: 'rejected', certainty: 'unknown', reason: 'INVALID_CATEGORY_PROPOSAL',
  });
});

test('invalid duration rules and unsafe values are rejected', () => {
  assert.throws(() => resolveDurationDecision({ kind: 'fixed', units: -1 }), TypeError);
  assert.throws(() => resolveDurationDecision({ kind: 'fixed', units: Number.MAX_SAFE_INTEGER + 1 }), TypeError);
  assert.throws(() => resolveDurationDecision({ kind: 'range', min_units: 10, max_units: 1, resolution: 'midpoint' }), TypeError);
  assert.throws(() => resolveDurationDecision({ kind: 'range', min_units: 1, max_units: 2, resolution: 'random' }), TypeError);
  assert.throws(() => resolveDurationDecision({ kind: 'category_map', categories: [] }), TypeError);
  assert.throws(() => resolveDurationDecision({
    kind: 'category_map',
    categories: [{ category: 'same', units: 1 }, { category: 'same', units: 2 }],
  }), TypeError);
});
