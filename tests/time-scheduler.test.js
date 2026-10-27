import test from 'node:test';
import assert from 'node:assert/strict';
import { planDueWork } from '../src/time/scheduler.js';

const trigger = (id, due, overrides = {}) => ({
  trigger_id: id,
  world_id: 'world-a',
  due_coordinate: due,
  status: 'pending',
  dependencies: [],
  read_set: [],
  write_set: [],
  processing_mode: 'exact',
  interrupt_after_coordinate: false,
  ...overrides,
});

test('due-work planning uses (from, to], stable ordering, and allows empty intervals', () => {
  const plan = planDueWork({
    world_id: 'world-a',
    from_coordinate: 0,
    to_coordinate: 10,
    triggers: [
      trigger('at-start', 0),
      trigger('b', 5),
      trigger('a', 5),
      trigger('at-end', 10),
      trigger('already-done', 7, { status: 'completed' }),
    ],
  });
  assert.equal(plan.status, 'planned');
  assert.deepEqual(plan.segments.map((segment) => ({ at: segment.due_coordinate, ids: segment.trigger_ids })), [
    { at: 5, ids: ['a', 'b'] },
    { at: 10, ids: ['at-end'] },
  ]);
  assert.equal(plan.planned_until_coordinate, 10);

  const empty = planDueWork({
    world_id: 'world-a',
    from_coordinate: 10,
    to_coordinate: 10,
    triggers: [trigger('at-start', 10)],
  });
  assert.equal(empty.status, 'planned');
  assert.deepEqual(empty.segments, []);
  assert.equal(empty.planned_until_coordinate, 10);
});

test('same-coordinate dependency creates a segment boundary and overrides lexical order', () => {
  const plan = planDueWork({
    world_id: 'world-a',
    from_coordinate: 0,
    to_coordinate: 5,
    triggers: [
      trigger('z-prerequisite', 5),
      trigger('a-dependent', 5, { dependencies: ['z-prerequisite'] }),
    ],
  });
  assert.deepEqual(plan.segments.map((segment) => segment.trigger_ids), [['z-prerequisite'], ['a-dependent']]);
});

test('missing, cancelled, or not-yet-due dependencies block the plan without a partial prefix', () => {
  const missing = planDueWork({
    world_id: 'world-a',
    from_coordinate: 0,
    to_coordinate: 10,
    triggers: [trigger('dependent', 5, { dependencies: ['missing'] })],
  });
  assert.equal(missing.status, 'blocked');
  assert.deepEqual(missing.segments, []);
  assert.equal(missing.blocked[0].reason, 'missing_dependency');

  const notDue = planDueWork({
    world_id: 'world-a',
    from_coordinate: 7,
    to_coordinate: 10,
    triggers: [
      trigger('past-uncompleted-prerequisite', 6),
      trigger('dependent', 8, { dependencies: ['past-uncompleted-prerequisite'] }),
    ],
  });
  assert.equal(notDue.status, 'blocked');
  assert.equal(notDue.blocked[0].reason, 'dependency_not_due_in_interval');
});

test('same-coordinate read/write conflicts without causal order require review', () => {
  assert.throws(
    () => planDueWork({
      world_id: 'world-a',
      from_coordinate: 0,
      to_coordinate: 5,
      triggers: [
        trigger('writer', 5, { write_set: ['entity:shared'] }),
        trigger('reader', 5, { read_set: ['entity:shared'] }),
      ],
    }),
    (error) => error.code === 'TRIGGER_CONFLICT_NEEDS_REVIEW',
  );
});

test('interrupt stops planning after all work at its coordinate and leaves later work unplanned', () => {
  const plan = planDueWork({
    world_id: 'world-a',
    from_coordinate: 0,
    to_coordinate: 20,
    triggers: [
      trigger('interrupt', 5, { interrupt_after_coordinate: true }),
      trigger('same-time', 5),
      trigger('later', 10, { dependencies: ['missing-later'] }),
      trigger('later-two', 20),
    ],
  });
  assert.equal(plan.status, 'interrupted');
  assert.equal(plan.stop_coordinate, 5);
  assert.equal(plan.planned_until_coordinate, 5);
  assert.deepEqual(plan.segments.map((segment) => segment.trigger_ids), [['interrupt', 'same-time']]);
  assert.deepEqual(plan.remaining_trigger_ids, ['later', 'later-two']);
});

test('dependency cycles and impossible causal time order are rejected', () => {
  assert.throws(
    () => planDueWork({
      world_id: 'world-a',
      from_coordinate: 0,
      to_coordinate: 10,
      triggers: [
        trigger('one', 5, { dependencies: ['two'] }),
        trigger('two', 5, { dependencies: ['one'] }),
      ],
    }),
    (error) => error.code === 'TRIGGER_DEPENDENCY_CYCLE',
  );
  assert.throws(
    () => planDueWork({
      world_id: 'world-a',
      from_coordinate: 0,
      to_coordinate: 10,
      triggers: [
        trigger('later', 8),
        trigger('earlier', 5, { dependencies: ['later'] }),
      ],
    }),
    (error) => error.code === 'CAUSAL_TIME_ORDER_CONFLICT',
  );
});

test('world isolation and malformed intervals fail closed', () => {
  assert.throws(
    () => planDueWork({
      world_id: 'world-a',
      from_coordinate: 0,
      to_coordinate: 10,
      triggers: [trigger('foreign', 5, { world_id: 'world-b' })],
    }),
    (error) => error.code === 'CROSS_WORLD_TRIGGER',
  );
  assert.throws(
    () => planDueWork({ world_id: 'world-a', from_coordinate: 10, to_coordinate: 0, triggers: [] }),
    (error) => error.code === 'REVERSED_INTERVAL',
  );
});


test('conflicts across segment boundaries still require a direct dependency order', () => {
  assert.throws(
    () => planDueWork({
      world_id: 'world-a',
      from_coordinate: 0,
      to_coordinate: 5,
      triggers: [
        trigger('writer-a', 5, { write_set: ['entity:shared'] }),
        trigger('bridge', 5, { dependencies: ['writer-a'] }),
        trigger('writer-c', 5, { dependencies: ['bridge'], write_set: ['entity:shared'] }),
      ],
    }),
    (error) => error.code === 'TRIGGER_CONFLICT_NEEDS_REVIEW',
  );
});


test('completed trigger IDs cannot contradict pending trigger records', () => {
  assert.throws(
    () => planDueWork({
      world_id: 'world-a',
      from_coordinate: 0,
      to_coordinate: 5,
      completed_trigger_ids: ['same-id'],
      triggers: [trigger('same-id', 5, { status: 'pending' })],
    }),
    (error) => error.code === 'CONFLICTING_TRIGGER_STATUS',
  );
});


test('large same-coordinate trigger sets remain deterministically ordered', () => {
  const triggers = Array.from({ length: 2500 }, (_, index) => trigger('trigger-' + String(index).padStart(4, '0'), 5));
  const plan = planDueWork({
    world_id: 'world-a',
    from_coordinate: 0,
    to_coordinate: 5,
    triggers,
  });
  assert.equal(plan.segments.length, 1);
  assert.equal(plan.segments[0].trigger_ids.length, 2500);
  assert.equal(plan.segments[0].trigger_ids[0], 'trigger-0000');
  assert.equal(plan.segments[0].trigger_ids[2499], 'trigger-2499');
});


test('trigger payloads reject lossy or executable non-JSON values without invoking accessors', () => {
  const plan = (payload) => planDueWork({
    world_id: 'world-a',
    from_coordinate: 0,
    to_coordinate: 5,
    triggers: [trigger('payload', 5, { payload })],
  });
  const invalidPayloads = [
    { value: Number.NaN },
    { value: Number.POSITIVE_INFINITY },
    { value: undefined },
    { value: () => 'not-json' },
    new Date(0),
  ];
  for (const payload of invalidPayloads) {
    assert.throws(() => plan(payload), (error) => error.code === 'INVALID_TRIGGER_PAYLOAD');
  }

  const sparse = [];
  sparse.length = 1;
  assert.throws(() => plan(sparse), (error) => error.code === 'INVALID_TRIGGER_PAYLOAD');

  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => plan(cyclic), (error) => error.code === 'INVALID_TRIGGER_PAYLOAD');

  let getterCalled = false;
  const accessorPayload = {};
  Object.defineProperty(accessorPayload, 'value', {
    enumerable: true,
    get() { getterCalled = true; return 'side effect'; },
  });
  assert.throws(() => plan(accessorPayload), (error) => error.code === 'INVALID_TRIGGER_PAYLOAD');
  assert.equal(getterCalled, false);
});

test('trigger payload normalization copies plain JSON data and canonicalizes negative zero', () => {
  const payload = { nested: [{ value: -0 }, null, true] };
  const plan = planDueWork({
    world_id: 'world-a',
    from_coordinate: 0,
    to_coordinate: 5,
    triggers: [trigger('payload', 5, { payload })],
  });
  const normalized = plan.segments[0].triggers[0].payload;
  assert.deepEqual(normalized, { nested: [{ value: 0 }, null, true] });
  normalized.nested[0].value = 99;
  assert.equal(Object.is(payload.nested[0].value, -0), true);
});


function allPermutations(items) {
  if (items.length <= 1) return [items];
  const result = [];
  items.forEach((item, index) => {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    for (const suffix of allPermutations(rest)) result.push([item, ...suffix]);
  });
  return result;
}

test('due-work plan is invariant to all trigger input permutations and follows the expected order', () => {
  const triggers = [
    trigger('z-prerequisite', 5),
    trigger('a-dependent', 5, { dependencies: ['z-prerequisite'] }),
    trigger('m-independent', 5),
    trigger('later', 10),
  ];
  const request = (items) => planDueWork({
    world_id: 'world-a',
    from_coordinate: 0,
    to_coordinate: 10,
    triggers: items,
  });
  const expected = request(triggers);
  assert.deepEqual(expected.segments.map((segment) => segment.trigger_ids), [
    ['m-independent', 'z-prerequisite'],
    ['a-dependent'],
    ['later'],
  ]);
  const permutations = allPermutations(triggers);
  assert.equal(permutations.length, 24);
  for (const permutation of permutations) assert.deepEqual(request(permutation), expected);
});

test('same-coordinate read/write conflict rejection is invariant to trigger input order', () => {
  const triggers = [
    trigger('writer', 5, { write_set: ['entity:shared'] }),
    trigger('reader', 5, { read_set: ['entity:shared'] }),
  ];
  const request = (items) => assert.throws(
    () => planDueWork({
      world_id: 'world-a',
      from_coordinate: 0,
      to_coordinate: 5,
      triggers: items,
    }),
    (error) => {
      assert.equal(error.code, 'TRIGGER_CONFLICT_NEEDS_REVIEW');
      assert.deepEqual(error.details, {
        trigger_ids: ['reader', 'writer'],
        reference: 'entity:shared',
      });
      return true;
    },
  );
  for (const permutation of allPermutations(triggers)) request(permutation);
});

test('interrupt and completed dependencies preserve the plan across trigger permutations', () => {
  const triggers = [
    trigger('finished', 3, { status: 'completed' }),
    trigger('interrupt', 5, { interrupt_after_coordinate: true }),
    trigger('same-time', 5, { dependencies: ['finished'], processing_mode: 'batch' }),
    trigger('later', 10),
  ];
  const request = (items) => planDueWork({
    world_id: 'world-a',
    from_coordinate: 0,
    to_coordinate: 10,
    completed_trigger_ids: ['finished'],
    triggers: items,
  });
  const expected = request(triggers);
  assert.equal(expected.status, 'interrupted');
  assert.equal(expected.stop_coordinate, 5);
  assert.equal(expected.planned_until_coordinate, 5);
  for (const permutation of allPermutations(triggers)) assert.deepEqual(request(permutation), expected);
});

test('blocked dependency diagnostics are invariant to trigger input order', () => {
  const triggers = [
    trigger('z-dependent', 5, { dependencies: ['missing-z', 'missing-a'] }),
    trigger('a-dependent', 5, { dependencies: ['missing-b'] }),
  ];
  const request = (items) => planDueWork({
    world_id: 'world-a',
    from_coordinate: 0,
    to_coordinate: 10,
    triggers: items,
  });
  const expected = request(triggers);
  const reversed = request([...triggers].reverse());
  assert.deepEqual(reversed, expected);
  assert.deepEqual(expected.blocked, [
    { trigger_id: 'a-dependent', dependency_id: 'missing-b', reason: 'missing_dependency' },
    { trigger_id: 'z-dependent', dependency_id: 'missing-a', reason: 'missing_dependency' },
    { trigger_id: 'z-dependent', dependency_id: 'missing-z', reason: 'missing_dependency' },
  ]);
});

test('completed dependencies cannot violate causal time order', () => {
  assert.throws(
    () => planDueWork({
      world_id: 'world-a',
      from_coordinate: 0,
      to_coordinate: 10,
      triggers: [
        trigger('completed-later', 10, { status: 'completed' }),
        trigger('dependent-earlier', 5, { dependencies: ['completed-later'] }),
      ],
    }),
    (error) => error.code === 'CAUSAL_TIME_ORDER_CONFLICT',
  );
});


test('explicit undefined trigger fields are rejected instead of treated as omitted defaults', () => {
  const fields = [
    'status',
    'dependencies',
    'read_set',
    'write_set',
    'processing_mode',
    'interrupt_after_coordinate',
    'payload',
  ];
  for (const field of fields) {
    assert.throws(
      () => planDueWork({
        world_id: 'world-a',
        from_coordinate: 0,
        to_coordinate: 5,
        triggers: [trigger('undefined-' + field, 5, { [field]: undefined })],
      }),
      (error) => error.code === 'INVALID_TRIGGER_FIELD_VALUE',
      field,
    );
  }
});

test('explicit null trigger policy fields are rejected rather than defaulted', () => {
  const cases = [
    { field: 'status', value: null, code: 'INVALID_TRIGGER_STATUS' },
    { field: 'processing_mode', value: null, code: 'INVALID_PROCESSING_MODE' },
    { field: 'interrupt_after_coordinate', value: null, code: 'INVALID_INTERRUPT_POLICY' },
  ];
  for (const { field, value, code } of cases) {
    assert.throws(
      () => planDueWork({
        world_id: 'world-a',
        from_coordinate: 0,
        to_coordinate: 5,
        triggers: [trigger('null-' + field, 5, { [field]: value })],
      }),
      (error) => error.code === code,
    );
  }
});

test('due-work requests reject unknown fields instead of silently dropping misspelled coordinates', () => {
  assert.throws(
    () => planDueWork({
      world_id: 'world-a',
      from_coordinate: 0,
      to_coordinte: 5,
      triggers: [],
    }),
    (error) => error.code === 'INVALID_DUE_WORK_FIELD' && error.details.field === 'to_coordinte',
  );
});

test('due-work requests reject explicitly undefined optional fields', () => {
  assert.throws(
    () => planDueWork({
      world_id: 'world-a',
      from_coordinate: 0,
      to_coordinate: 5,
      triggers: [],
      completed_trigger_ids: undefined,
    }),
    (error) => error.code === 'INVALID_DUE_WORK_REQUEST',
  );
});

test('known registry metadata also rejects explicitly undefined values', () => {
  assert.throws(
    () => planDueWork({
      world_id: 'world-a',
      from_coordinate: 0,
      to_coordinate: 5,
      triggers: [trigger('metadata-undefined', 5, { content_hash: undefined })],
    }),
    (error) => error.code === 'INVALID_TRIGGER_FIELD_VALUE',
  );
});

test('due-work requests reject accessors without invoking them', () => {
  let getterCalled = false;
  const request = {
    world_id: 'world-a',
    from_coordinate: 0,
    to_coordinate: 5,
    triggers: [],
  };
  Object.defineProperty(request, 'to_coordinate', {
    enumerable: true,
    configurable: true,
    get() { getterCalled = true; return 5; },
  });
  assert.throws(
    () => planDueWork(request),
    (error) => error.code === 'INVALID_DUE_WORK_REQUEST',
  );
  assert.equal(getterCalled, false);
});

test('trigger records reject unknown fields instead of silently dropping misspelled scheduling intent', () => {
  assert.throws(
    () => planDueWork({
      world_id: 'world-a',
      from_coordinate: 0,
      to_coordinate: 5,
      triggers: [trigger('typo', 5, { interrupt_after_coordiante: true })],
    }),
    (error) => error.code === 'INVALID_TRIGGER_FIELD' && error.details.field === 'interrupt_after_coordiante',
  );
});

test('trigger records reject accessors without invoking them', () => {
  let getterCalled = false;
  const unsafe = trigger('accessor', 5);
  Object.defineProperty(unsafe, 'interrupt_after_coordinate', {
    enumerable: true,
    configurable: true,
    get() { getterCalled = true; return true; },
  });

  assert.throws(
    () => planDueWork({
      world_id: 'world-a',
      from_coordinate: 0,
      to_coordinate: 5,
      triggers: [unsafe],
    }),
    (error) => error.code === 'INVALID_TRIGGER',
  );
  assert.equal(getterCalled, false);
});

test('sparse trigger arrays fail closed instead of silently dropping scheduled work', () => {
  const triggers = [];
  triggers.length = 1;
  assert.throws(
    () => planDueWork({
      world_id: 'world-a',
      from_coordinate: 0,
      to_coordinate: 5,
      triggers,
    }),
    (error) => error.code === 'INVALID_TRIGGER_LIST',
  );
});

test('sparse dependency/reference arrays fail closed instead of skipping entries', () => {
  const dependencies = [];
  dependencies.length = 1;
  assert.throws(
    () => planDueWork({
      world_id: 'world-a',
      from_coordinate: 0,
      to_coordinate: 5,
      triggers: [trigger('dependent', 5, { dependencies })],
    }),
    (error) => error.code === 'INVALID_REFERENCE_LIST',
  );
});

test('scheduler arrays reject accessor entries without invoking them', () => {
  let getterCalled = false;
  const triggers = [];
  triggers.length = 1;
  Object.defineProperty(triggers, '0', {
    enumerable: true,
    configurable: true,
    get() { getterCalled = true; return trigger('hidden', 5); },
  });

  assert.throws(
    () => planDueWork({
      world_id: 'world-a',
      from_coordinate: 0,
      to_coordinate: 5,
      triggers,
    }),
    (error) => error.code === 'INVALID_TRIGGER_LIST',
  );
  assert.equal(getterCalled, false);
});

test('completed prerequisites cannot be scheduled after their dependent trigger', () => {
  for (const completedIds of [[], ['future-prerequisite']]) {
    assert.throws(
      () => planDueWork({
        world_id: 'world-a',
        from_coordinate: 0,
        to_coordinate: 10,
        completed_trigger_ids: completedIds,
        triggers: [
          trigger('future-prerequisite', 8, { status: 'completed' }),
          trigger('dependent', 5, { dependencies: ['future-prerequisite'] }),
        ],
      }),
      (error) => error.code === 'CAUSAL_TIME_ORDER_CONFLICT'
        && error.details.trigger_id === 'dependent'
        && error.details.dependency_id === 'future-prerequisite',
    );
  }
});

test('historically completed prerequisites at earlier coordinates remain satisfied', () => {
  const plan = planDueWork({
    world_id: 'world-a',
    from_coordinate: 0,
    to_coordinate: 10,
    completed_trigger_ids: ['past-prerequisite'],
    triggers: [
      trigger('past-prerequisite', 3, { status: 'completed' }),
      trigger('dependent', 5, { dependencies: ['past-prerequisite'] }),
    ],
  });
  assert.equal(plan.status, 'planned');
  assert.deepEqual(plan.segments.map((segment) => segment.trigger_ids), [['dependent']]);
});
