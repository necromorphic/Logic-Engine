import test from 'node:test';
import assert from 'node:assert/strict';
import { createTimePolicy, resolveDurationDecision } from '../src/time/policy.js';

const policy = (overrides = {}) => ({
  policy_id: 'test.time',
  version: '1.0.0',
  max_action_duration_ms: 43200000,
  max_skip_duration_ms: 604800000,
  duration_rules: [
    { event_type: 'travel.completed', rule: { kind: 'fixed', duration_ms: 60000 } },
    { event_type: 'combat.completed', rule: { kind: 'range', min_duration_ms: 10000, max_duration_ms: 30000, resolution: 'midpoint' } },
    { event_type: 'craft.completed', rule: { kind: 'category_map', categories: [{ category: 'simple', duration_ms: 30000 }, { category: 'complex', duration_ms: 120000 }] } },
    { event_type: 'rest.completed', rule: { kind: 'range', min_duration_ms: 3600000, max_duration_ms: 28800000, resolution: 'author' } },
  ],
  ...overrides,
});

test('duration policy resolves fixed and deterministic range rules without caller duration authority', () => {
  const value = createTimePolicy(policy());
  assert.equal(resolveDurationDecision(value, 'travel.completed').duration_ms, 60000);
  assert.equal(resolveDurationDecision(value, 'combat.completed').duration_ms, 20000);
  assert.equal(resolveDurationDecision(value, 'rest.completed').status, 'needs_author');
});

test('author-range duration proposals require explicit author approval and remain bounded by policy', () => {
  const value = createTimePolicy(policy());
  const candidate = { duration_ms: 3600000 };
  assert.equal(resolveDurationDecision(value, 'rest.completed', candidate).status, 'needs_author');
  const approved = resolveDurationDecision(value, 'rest.completed', candidate, 0, { authorApproved: true });
  assert.equal(approved.status, 'resolved');
  assert.equal(approved.duration_ms, 3600000);
  assert.equal(approved.source, 'author_approved_range');
  assert.equal(resolveDurationDecision(value, 'rest.completed', { duration_ms: 1 }, 0, { authorApproved: true }).reason, 'AUTHOR_DURATION_OUT_OF_RANGE');
  assert.equal(resolveDurationDecision(value, 'rest.completed', { duration_ms: 3600000, category: 'simple' }, 0, { authorApproved: true }).reason, 'INVALID_AUTHOR_DURATION_PROPOSAL');
});

test('category proposal selects only a declared duration and cannot invent a value', () => {
  const value = createTimePolicy(policy());
  assert.equal(resolveDurationDecision(value, 'craft.completed', { category: 'complex' }).duration_ms, 120000);
  assert.equal(resolveDurationDecision(value, 'craft.completed', { category: 'instant' }).status, 'rejected');
  assert.equal(resolveDurationDecision(value, 'craft.completed').status, 'needs_author');
});

test('unknown duration rules permit only zero-duration events and reject arbitrary duration claims', () => {
  const value = createTimePolicy(policy({ duration_rules: [] }));
  assert.equal(resolveDurationDecision(value, 'relationship.transition', null, 0).duration_ms, 0);
  assert.equal(resolveDurationDecision(value, 'relationship.transition', null, 5000).status, 'rejected');
});

test('world policy may set a skip ceiling above seven days while malformed limits still fail closed', () => {
  assert.equal(createTimePolicy(policy({ max_skip_duration_ms: 900000000 })).max_skip_duration_ms, 900000000);
  assert.throws(() => createTimePolicy(policy({ max_skip_duration_ms: Number.MAX_SAFE_INTEGER + 1 })), (error) => error.code === 'INVALID_TIME_POLICY');
  assert.throws(() => createTimePolicy(policy({ max_skip_duration_ms: 900000001 })), (error) => error.code === 'INVALID_TIME_POLICY');
  assert.throws(() => createTimePolicy(policy({ duration_rules: [
    { event_type: 'same', rule: { kind: 'fixed', duration_ms: 1000 } },
    { event_type: 'same', rule: { kind: 'fixed', duration_ms: 2000 } },
  ] })), (error) => error.code === 'INVALID_TIME_POLICY');
  assert.throws(() => createTimePolicy(policy({ duration_rules: [
    { event_type: 'travel.completed', rule: { kind: 'fixed', duration_ms: 50000000 } },
  ] })), (error) => error.code === 'INVALID_TIME_POLICY');
});


test('TimePolicy rejects unknown fields instead of silently accepting a different declaration', () => {
  assert.throws(() => createTimePolicy(policy({
    duration_rules: [{ event_type: 'travel.completed', extra: true, rule: { kind: 'fixed', duration_ms: 1000 } }],
  })), (error) => error.code === 'INVALID_TIME_POLICY');

  assert.throws(() => createTimePolicy(policy({
    duration_rules: [{ event_type: 'travel.completed', rule: { kind: 'fixed', duration_ms: 1000, extra: true } }],
  })), (error) => error.code === 'INVALID_TIME_POLICY');

  assert.throws(() => createTimePolicy(policy({
    duration_rules: [{ event_type: 'craft.completed', rule: {
      kind: 'category_map',
      categories: [{ category: 'simple', duration_ms: 1000, extra: true }],
    } }],
  })), (error) => error.code === 'INVALID_TIME_POLICY');
});


test('duration resolver rejects malformed requested durations regardless of rule resolution', () => {
  const value = createTimePolicy(policy());
  const noRule = createTimePolicy(policy({ duration_rules: [] }));
  for (const requestedDurationMs of [-1, 1.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => resolveDurationDecision(value, 'travel.completed', null, requestedDurationMs),
      (error) => error.code === 'INVALID_TIME_POLICY',
    );
    assert.throws(
      () => resolveDurationDecision(noRule, 'unknown.event', null, requestedDurationMs),
      (error) => error.code === 'INVALID_TIME_POLICY',
    );
  }
  assert.equal(resolveDurationDecision(noRule, 'unknown.event', null, 0).duration_ms, 0);
  assert.equal(resolveDurationDecision(noRule, 'unknown.event', null, null).status, 'rejected');
  assert.equal(resolveDurationDecision(value, 'travel.completed', null, 0).duration_ms, 60000);
  // Explicit null retains the legacy sentinel behavior; omitted/undefined uses the default zero.
  assert.equal(resolveDurationDecision(value, 'travel.completed', null, null).duration_ms, 60000);
});
