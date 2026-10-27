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


test('TimePolicy normalization uses locale-independent code-unit ordering', () => {
  const value = createTimePolicy(policy({
    duration_rules: [
      { event_type: 'é', rule: { kind: 'fixed', duration_ms: 1000 } },
      { event_type: 'a', rule: { kind: 'fixed', duration_ms: 2000 } },
      { event_type: 'Z', rule: { kind: 'fixed', duration_ms: 3000 } },
    ],
  }));
  assert.deepEqual(value.duration_rules.map((entry) => entry.event_type), ['Z', 'a', 'é']);

  const categories = createTimePolicy(policy({
    duration_rules: [{
      event_type: 'categories',
      rule: { kind: 'category_map', categories: [
        { category: 'é', duration_ms: 3000 },
        { category: 'a', duration_ms: 1000 },
        { category: 'Z', duration_ms: 2000 },
      ] },
    }],
  }));
  assert.deepEqual(
    categories.duration_rules[0].rule.categories.map((entry) => entry.category),
    ['Z', 'a', 'é'],
  );
});


test('time policies reject symbol keys and accessors without invoking getters', () => {
  let getterCalled = false;
  const input = policy();
  Object.defineProperty(input, 'version', {
    enumerable: true,
    configurable: true,
    get() { getterCalled = true; return '1.0.0'; },
  });
  assert.throws(() => createTimePolicy(input), (error) => error.code === 'INVALID_TIME_POLICY');
  assert.equal(getterCalled, false);

  const withSymbol = policy();
  withSymbol[Symbol('hidden')] = true;
  assert.throws(() => createTimePolicy(withSymbol), (error) => error.code === 'INVALID_TIME_POLICY');
});

test('time policy arrays reject sparse entries, accessors, and extra properties', () => {
  const sparseRules = [];
  sparseRules.length = 1;
  assert.throws(
    () => createTimePolicy(policy({ duration_rules: sparseRules })),
    (error) => error.code === 'INVALID_TIME_POLICY',
  );

  const accessorRules = [];
  accessorRules.length = 1;
  let getterCalled = false;
  Object.defineProperty(accessorRules, '0', {
    enumerable: true,
    configurable: true,
    get() { getterCalled = true; return { event_type: 'x', rule: { kind: 'fixed', duration_ms: 1 } }; },
  });
  assert.throws(
    () => createTimePolicy(policy({ duration_rules: accessorRules })),
    (error) => error.code === 'INVALID_TIME_POLICY',
  );
  assert.equal(getterCalled, false);

  const extraPropertyRules = [{ event_type: 'x', rule: { kind: 'fixed', duration_ms: 1 } }];
  extraPropertyRules.unexpected = true;
  assert.throws(
    () => createTimePolicy(policy({ duration_rules: extraPropertyRules })),
    (error) => error.code === 'INVALID_TIME_POLICY',
  );
});

test('nested duration rule records reject non-enumerable and custom-prototype fields', () => {
  const rule = { kind: 'fixed', duration_ms: 1000 };
  Object.defineProperty(rule, 'hidden', { value: true, enumerable: false });
  assert.throws(
    () => createTimePolicy(policy({ duration_rules: [{ event_type: 'x', rule }] })),
    (error) => error.code === 'INVALID_TIME_POLICY',
  );

  const customPrototype = Object.create({ inherited: true });
  customPrototype.kind = 'fixed';
  customPrototype.duration_ms = 1000;
  assert.throws(
    () => createTimePolicy(policy({ duration_rules: [{ event_type: 'x', rule: customPrototype }] })),
    (error) => error.code === 'INVALID_TIME_POLICY',
  );
});


test('duration proposals and approval options reject accessors without invoking them', () => {
  let getterCalled = false;
  const rangePolicy = policy({
    duration_rules: [{
      event_type: 'rest.completed',
      rule: { kind: 'range', min_duration_ms: 1000, max_duration_ms: 3000, resolution: 'author' },
    }],
  });
  const proposal = {};
  Object.defineProperty(proposal, 'duration_ms', {
    enumerable: true,
    get() { getterCalled = true; return 2000; },
  });
  const rejectedProposal = resolveDurationDecision(rangePolicy, 'rest.completed', proposal, 0);
  assert.equal(rejectedProposal.status, 'rejected');
  assert.equal(rejectedProposal.reason, 'INVALID_AUTHOR_DURATION_PROPOSAL');
  assert.equal(getterCalled, false);

  const safeProposal = { duration_ms: 2000 };
  const options = {};
  Object.defineProperty(options, 'authorApproved', {
    enumerable: true,
    get() { getterCalled = true; return true; },
  });
  const pendingApproval = resolveDurationDecision(rangePolicy, 'rest.completed', safeProposal, 0, options);
  assert.equal(pendingApproval.status, 'needs_author');
  assert.equal(getterCalled, false);
});

test('duration proposals reject symbol and non-enumerable fields', () => {
  const categoryPolicy = policy();
  const symbolProposal = { category: 'simple' };
  symbolProposal[Symbol('hidden')] = true;
  assert.equal(
    resolveDurationDecision(categoryPolicy, 'craft.completed', symbolProposal).reason,
    'INVALID_CATEGORY_PROPOSAL',
  );

  const hiddenProposal = {};
  Object.defineProperty(hiddenProposal, 'category', { value: 'simple', enumerable: false });
  assert.equal(
    resolveDurationDecision(categoryPolicy, 'craft.completed', hiddenProposal).reason,
    'INVALID_CATEGORY_PROPOSAL',
  );
});


test('time policy required fields must be own properties even if Object.prototype is polluted', () => {
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, 'policy_id');
  Object.defineProperty(Object.prototype, 'policy_id', {
    configurable: true, enumerable: true, writable: true, value: 'inherited-policy',
  });
  try {
    const input = policy();
    delete input.policy_id;
    assert.throws(
      () => createTimePolicy(input),
      (error) => error.code === 'INVALID_TIME_POLICY',
    );
  } finally {
    if (previous) Object.defineProperty(Object.prototype, 'policy_id', previous);
    else delete Object.prototype.policy_id;
  }
});


test('duration rule kinds reject prototype keys and non-string values without coercion', () => {
  for (const kind of ['toString', 'constructor', '__proto__']) {
    assert.throws(
      () => createTimePolicy(policy({
        duration_rules: [{ event_type: 'unsafe.kind', rule: { kind } }],
      })),
      (error) => error.code === 'INVALID_TIME_POLICY',
    );
  }

  let coercionCalled = false;
  const kind = {
    toString() { coercionCalled = true; return 'fixed'; },
  };
  assert.throws(
    () => createTimePolicy(policy({
      duration_rules: [{ event_type: 'unsafe.kind', rule: { kind } }],
    })),
    (error) => error.code === 'INVALID_TIME_POLICY',
  );
  assert.equal(coercionCalled, false);
});


test('inherited author approval cannot resolve an author-required duration', () => {
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, 'authorApproved');
  Object.defineProperty(Object.prototype, 'authorApproved', {
    configurable: true, enumerable: true, writable: true, value: true,
  });
  try {
    const result = resolveDurationDecision(
      policy(),
      'rest.completed',
      { duration_ms: 3600000 },
    );
    assert.equal(result.status, 'needs_author');
  } finally {
    if (previous) Object.defineProperty(Object.prototype, 'authorApproved', previous);
    else delete Object.prototype.authorApproved;
  }
});


test('TimePolicy enforces the seven-day action ceiling but permits longer skip ceilings', () => {
  assert.throws(
    () => createTimePolicy(policy({ max_action_duration_ms: 900000000 })),
    (error) => error.code === 'INVALID_TIME_POLICY',
  );
  assert.equal(createTimePolicy(policy({ max_skip_duration_ms: 900000000 })).max_skip_duration_ms, 900000000);
});


test('inherited category proposal fields cannot select a TimePolicy category', () => {
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, 'category');
  Object.defineProperty(Object.prototype, 'category', {
    configurable: true, enumerable: true, writable: true, value: 'simple',
  });
  try {
    const result = resolveDurationDecision(policy(), 'craft.completed', {});
    assert.equal(result.status, 'rejected');
    assert.equal(result.reason, 'INVALID_CATEGORY_PROPOSAL');
  } finally {
    if (previous) Object.defineProperty(Object.prototype, 'category', previous);
    else delete Object.prototype.category;
  }
});
