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
