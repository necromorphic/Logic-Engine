import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';

function setup() {
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  engine.createWorld({
    world_id: 'time-trigger-world',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    game_time: '2026-01-01T00:00:00.000Z',
  });
  return { store, engine };
}

function trigger(triggerId, dueCoordinate, entityId, dependencies = []) {
  return {
    trigger_id: triggerId,
    due_coordinate: dueCoordinate,
    dependencies,
    read_set: [],
    write_set: ['entity:' + entityId],
    processing_mode: 'exact',
    interrupt_after_coordinate: false,
    payload: {
      event: {
        event_type: 'time.trigger',
        effects: [{
          kind: 'entity.upsert',
          entity_id: entityId,
          entity_type: 'object',
          attributes: { trigger_id: triggerId },
        }],
      },
    },
  };
}

test('registered triggers are immutable, world-scoped, and registration replay is idempotent', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  const input = trigger('first', 10000, 'trigger-entity');
  const registered = engine.registerTimeTrigger('time-trigger-world', input);
  assert.equal(registered.status, 'pending');
  assert.equal(registered.idempotent_replay, false);
  assert.equal(engine.getState('time-trigger-world').world_revision, 1);

  const replay = engine.registerTimeTrigger('time-trigger-world', input);
  assert.equal(replay.idempotent_replay, true);
  assert.equal(replay.trigger_id, 'first');
  assert.equal(engine.getState('time-trigger-world').world_revision, 1);

  assert.throws(
    () => engine.registerTimeTrigger('time-trigger-world', trigger('first', 20000, 'different-entity')),
    (error) => error.code === 'TIME_TRIGGER_ID_IMMUTABLE',
  );
  assert.equal(engine.listTimeTriggers('time-trigger-world').length, 1);
  assert.equal(engine.getAudit('time-trigger-world').filter((entry) => entry.action === 'time.trigger.registered').length, 1);
});

test('trigger listing omits payloads and oversized payloads are rejected before storage', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  engine.registerTimeTrigger('time-trigger-world', trigger('small', 10000, 'small-entity'));
  const [listed] = engine.listTimeTriggers('time-trigger-world');
  assert.equal(Object.hasOwn(listed, 'payload'), false);
  assert.equal(engine.getTimeTrigger('time-trigger-world', 'small').payload.event.event_type, 'time.trigger');

  assert.throws(
    () => engine.registerTimeTrigger('time-trigger-world', {
      ...trigger('too-large', 20000, 'large-entity'),
      payload: { event: { event_type: 'time.trigger', effects: [], large_text: 'x'.repeat(262145) } },
    }),
    (error) => error.code === 'TIME_TRIGGER_PAYLOAD_TOO_LARGE',
  );
  assert.equal(engine.listTimeTriggers('time-trigger-world').length, 1);
  assert.equal(engine.getState('time-trigger-world').world_revision, 1);
});

test('world TimePolicy may allow an advance longer than seven days while event segments stay bounded', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());
  engine.registerTimeConfiguration('time-trigger-world', {
    version: 'policy-long-skip',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    calendar_definition: {
      calendar_id: 'test.calendar',
      version: '1.0.0',
      day_length_ms: 86400000,
      weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      year_cycle: [{ id: 'standard', name: 'Standard', months: [{ id: 'jan', name: 'January', days: 31 }] }],
      epoch: { coordinate: 0, year_number: 2026, year_cycle_index: 0, month_id: 'jan', day_of_month: 1, weekday_index: 0, time_of_day_ms: 0 },
      holidays: [],
    },
    time_policy: {
      policy_id: 'test.long-skip',
      version: '1.0.0',
      max_action_duration_ms: 43200000,
      max_skip_duration_ms: 1209600000,
      duration_rules: [],
    },
  });
  const operation = engine.startTimeAdvance('time-trigger-world', {
    idempotency_key: 'eight-day-policy-advance',
    expected_revision: engine.getState('time-trigger-world').world_revision,
    to_coordinate: 8 * 86400000,
  });
  assert.equal(operation.status, 'completed');
  assert.equal(operation.confirmed_coordinate, 8 * 86400000);
  assert.equal(engine.getEvents('time-trigger-world').filter((event) => event.event_type === 'time.advance').length, 2);
  assert.deepEqual(engine.getEvents('time-trigger-world').map((event) => event.time_advance_seconds), [604800, 86400]);
});

test('registered trigger cannot masquerade as a canonical time.advance event', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());
  assert.throws(
    () => engine.registerTimeTrigger('time-trigger-world', {
      ...trigger('bad-time-trigger', 10000, 'bad-entity'),
      payload: { event: { event_type: 'time.advance', effects: [] } },
    }),
    (error) => error.code === 'INVALID_TRIGGER_EVENT_TYPE',
  );
});

test('timed action resolves duration through TimePolicy and processes due triggers before final action effects', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());
  engine.registerTimeConfiguration('time-trigger-world', {
    version: 'timed-action-policy',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    calendar_definition: {
      calendar_id: 'timed-action.calendar',
      version: '1.0.0',
      day_length_ms: 86400000,
      weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      year_cycle: [{ id: 'standard', name: 'Standard', months: [{ id: 'jan', name: 'January', days: 31 }] }],
      epoch: { coordinate: 0, year_number: 2026, year_cycle_index: 0, month_id: 'jan', day_of_month: 1, weekday_index: 0, time_of_day_ms: 0 },
      holidays: [],
    },
    time_policy: {
      policy_id: 'timed-action.policy',
      version: '1.0.0',
      max_action_duration_ms: 43200000,
      max_skip_duration_ms: 604800000,
      duration_rules: [{ event_type: 'travel.completed', rule: { kind: 'fixed', duration_ms: 30000 } }],
    },
  });
  engine.registerTimeTrigger('time-trigger-world', trigger('at-ten-seconds', 10000, 'intermediate-entity'));
  const revision = engine.getState('time-trigger-world').world_revision;
  const request = {
    idempotency_key: 'timed-travel-action',
    expected_revision: revision,
    event: {
      turn_id: 'timed-travel-turn',
      event_type: 'travel.completed',
      effects: [{ kind: 'entity.upsert', entity_id: 'traveller', entity_type: 'character', attributes: { arrived: true } }],
    },
  };
  const operation = engine.startTimedAction('time-trigger-world', request);
  assert.equal(operation.status, 'completed');
  assert.equal(operation.confirmed_coordinate, 30000);
  assert.equal(operation.result.final_action_status, 'committed');
  assert.deepEqual(operation.result.completed_trigger_ids, ['at-ten-seconds']);
  assert.equal(engine.getState('time-trigger-world').entities.find((entity) => entity.entity_id === 'traveller').attributes.arrived, true);
  assert.equal(engine.getTimeTrigger('time-trigger-world', 'at-ten-seconds').status, 'completed');
  const events = engine.getEvents('time-trigger-world');
  assert.deepEqual(events.map((event) => [event.event_type, event.game_time_coordinate]), [
    ['time.advance', 10000],
    ['time.trigger', 10000],
    ['time.advance', 30000],
    ['travel.completed', 30000],
  ]);
  const actionEvent = events.find((event) => event.event_type === 'travel.completed');
  assert.equal(actionEvent.time_advance_seconds, 0);
  assert.equal(operation.plan.final_action_duration_decision.duration_ms, 30000);

  const replay = engine.startTimedAction('time-trigger-world', request);
  assert.equal(replay.operation_id, operation.operation_id);
  assert.equal(replay.result.final_action_status, 'committed');
  assert.equal(engine.getEvents('time-trigger-world').filter((event) => event.event_type === 'travel.completed').length, 1);
});

test('timed action is not committed when due work interrupts the interval', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());
  engine.registerTimeConfiguration('time-trigger-world', {
    version: 'interrupt-action-policy',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    calendar_definition: {
      calendar_id: 'interrupt-action.calendar',
      version: '1.0.0',
      day_length_ms: 86400000,
      weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      year_cycle: [{ id: 'standard', name: 'Standard', months: [{ id: 'jan', name: 'January', days: 31 }] }],
      epoch: { coordinate: 0, year_number: 2026, year_cycle_index: 0, month_id: 'jan', day_of_month: 1, weekday_index: 0, time_of_day_ms: 0 },
      holidays: [],
    },
    time_policy: {
      policy_id: 'interrupt-action.policy',
      version: '1.0.0',
      max_action_duration_ms: 43200000,
      max_skip_duration_ms: 604800000,
      duration_rules: [{ event_type: 'travel.completed', rule: { kind: 'fixed', duration_ms: 30000 } }],
    },
  });
  engine.registerTimeTrigger('time-trigger-world', {
    ...trigger('interrupt-at-ten', 10000, 'interrupt-entity'),
    interrupt_after_coordinate: true,
  });
  const operation = engine.startTimedAction('time-trigger-world', {
    idempotency_key: 'interrupted-travel-action',
    expected_revision: engine.getState('time-trigger-world').world_revision,
    event: { turn_id: 'interrupted-travel-turn', event_type: 'travel.completed', effects: [] },
  });
  assert.equal(operation.status, 'interrupted');
  assert.equal(operation.confirmed_coordinate, 10000);
  assert.equal(operation.result.final_action_status, 'not_executed_interrupted');
  assert.equal(engine.getEvents('time-trigger-world').some((event) => event.event_type === 'travel.completed'), false);
  assert.equal(engine.getTimeTrigger('time-trigger-world', 'interrupt-at-ten').status, 'completed');
});

test('timed action rejects conflicts with scheduled effects at the exact target before any progress', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());
  engine.registerTimeConfiguration('time-trigger-world', {
    version: 'conflict-action-policy',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    calendar_definition: {
      calendar_id: 'conflict-action.calendar',
      version: '1.0.0',
      day_length_ms: 86400000,
      weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      year_cycle: [{ id: 'standard', name: 'Standard', months: [{ id: 'jan', name: 'January', days: 31 }] }],
      epoch: { coordinate: 0, year_number: 2026, year_cycle_index: 0, month_id: 'jan', day_of_month: 1, weekday_index: 0, time_of_day_ms: 0 },
      holidays: [],
    },
    time_policy: {
      policy_id: 'conflict-action.policy',
      version: '1.0.0',
      max_action_duration_ms: 43200000,
      max_skip_duration_ms: 604800000,
      duration_rules: [{ event_type: 'travel.completed', rule: { kind: 'fixed', duration_ms: 10000 } }],
    },
  });
  engine.registerTimeTrigger('time-trigger-world', trigger('at-target', 10000, 'shared-target'));
  const revision = engine.getState('time-trigger-world').world_revision;
  assert.throws(
    () => engine.startTimedAction('time-trigger-world', {
      idempotency_key: 'conflicting-target-action',
      expected_revision: revision,
      event: {
        turn_id: 'conflicting-target-turn',
        event_type: 'travel.completed',
        effects: [{ kind: 'entity.upsert', entity_id: 'shared-target', entity_type: 'object', attributes: { action: true } }],
      },
    }),
    (error) => error.code === 'TIME_ACTION_TRIGGER_CONFLICT',
  );
  assert.equal(engine.getState('time-trigger-world').game_time_coordinate, 0);
  assert.equal(engine.getTimeTrigger('time-trigger-world', 'at-target').status, 'pending');
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM time_advance_operations WHERE world_id=?').get('time-trigger-world').count, 0);
});

test('direct timed commits cannot cross registered triggers outside the advance operation', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());
  engine.registerTimeTrigger('time-trigger-world', trigger('must-run-first', 10000, 'must-run-entity'));
  const revision = engine.getState('time-trigger-world').world_revision;
  assert.throws(
    () => engine.commitEvent('time-trigger-world', {
      idempotency_key: 'direct-crossing-event',
      turn_id: 'direct-crossing-turn',
      event_type: 'action.completed',
      expected_revision: revision,
      time_advance_seconds: 20,
      effects: [],
    }),
    (error) => error.code === 'TIME_ADVANCE_OPERATION_REQUIRED',
  );
  assert.equal(engine.getState('time-trigger-world').game_time_coordinate, 0);
  assert.equal(engine.getEvents('time-trigger-world').length, 0);
  assert.equal(engine.getTimeTrigger('time-trigger-world', 'must-run-first').status, 'pending');
});

test('timed action refuses ambiguous policy durations before claiming triggers', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());
  engine.registerTimeConfiguration('time-trigger-world', {
    version: 'author-duration-policy',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    calendar_definition: {
      calendar_id: 'author-duration.calendar',
      version: '1.0.0',
      day_length_ms: 86400000,
      weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      year_cycle: [{ id: 'standard', name: 'Standard', months: [{ id: 'jan', name: 'January', days: 31 }] }],
      epoch: { coordinate: 0, year_number: 2026, year_cycle_index: 0, month_id: 'jan', day_of_month: 1, weekday_index: 0, time_of_day_ms: 0 },
      holidays: [],
    },
    time_policy: {
      policy_id: 'author-duration.policy',
      version: '1.0.0',
      max_action_duration_ms: 43200000,
      max_skip_duration_ms: 604800000,
      duration_rules: [{ event_type: 'rest.completed', rule: { kind: 'range', min_duration_ms: 3600000, max_duration_ms: 28800000, resolution: 'author' } }],
    },
  });
  engine.registerTimeTrigger('time-trigger-world', trigger('later-trigger', 10000, 'later-entity'));
  const revision = engine.getState('time-trigger-world').world_revision;
  assert.throws(
    () => engine.startTimedAction('time-trigger-world', {
      idempotency_key: 'ambiguous-rest-action',
      expected_revision: revision,
      event: { turn_id: 'rest-turn', event_type: 'rest.completed', effects: [] },
    }),
    (error) => error.code === 'DURATION_NEEDS_AUTHOR',
  );
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM time_advance_operations WHERE world_id=?').get('time-trigger-world').count, 0);
  assert.equal(engine.getTimeTrigger('time-trigger-world', 'later-trigger').status, 'pending');
  assert.equal(engine.getState('time-trigger-world').game_time_coordinate, 0);
});

test('registered due triggers complete atomically with their event segment and operation checkpoint', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  engine.registerTimeTrigger('time-trigger-world', trigger('at-ten', 10000, 'entity-ten'));
  engine.registerTimeTrigger('time-trigger-world', trigger('at-twenty', 20000, 'entity-twenty'));

  const operation = engine.startTimeAdvance('time-trigger-world', {
    idempotency_key: 'registered-trigger-advance',
    expected_revision: 2,
    to_coordinate: 20000,
  });
  assert.equal(operation.status, 'completed');
  assert.deepEqual(operation.result.completed_trigger_ids, ['at-ten', 'at-twenty']);
  assert.equal(operation.confirmed_coordinate, 20000);

  const triggers = engine.listTimeTriggers('time-trigger-world');
  assert.deepEqual(triggers.map((item) => item.status), ['completed', 'completed']);
  assert.deepEqual(triggers.map((item) => item.completed_operation_id), [operation.operation_id, operation.operation_id]);
  assert.equal(engine.getState('time-trigger-world').entities.find((item) => item.entity_id === 'entity-ten').attributes.trigger_id, 'at-ten');
  assert.equal(engine.getState('time-trigger-world').entities.find((item) => item.entity_id === 'entity-twenty').attributes.trigger_id, 'at-twenty');
  assert.equal(engine.getAudit('time-trigger-world').filter((entry) => entry.action === 'time.trigger.completed').length, 2);

  const replay = engine.startTimeAdvance('time-trigger-world', {
    idempotency_key: 'registered-trigger-advance',
    expected_revision: 2,
    to_coordinate: 20000,
  });
  assert.equal(replay.operation_id, operation.operation_id);
  assert.equal(replay.status, 'completed');
  assert.deepEqual(replay.result.completed_trigger_ids, ['at-ten', 'at-twenty']);
});

test('registered trigger state and completion survive a SQLite restart without re-firing', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-engine-time-trigger-recovery-'));
  const path = join(directory, 'state.sqlite');
  let store = new SQLiteStore(path);
  let engine = new LogicEngine(store);
  engine.createWorld({
    world_id: 'time-trigger-world',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    game_time: '2026-01-01T00:00:00.000Z',
  });
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });

  engine.registerTimeTrigger('time-trigger-world', trigger('durable', 10000, 'durable-entity'));
  store.close();
  store = new SQLiteStore(path);
  engine = new LogicEngine(store);
  assert.equal(engine.getTimeTrigger('time-trigger-world', 'durable').status, 'pending');

  const operation = engine.startTimeAdvance('time-trigger-world', {
    idempotency_key: 'durable-trigger-operation',
    expected_revision: 1,
    to_coordinate: 10000,
  });
  assert.equal(operation.status, 'completed');
  store.close();
  store = new SQLiteStore(path);
  engine = new LogicEngine(store);
  assert.equal(engine.getTimeTrigger('time-trigger-world', 'durable').status, 'completed');
  assert.equal(engine.getTimeTrigger('time-trigger-world', 'durable').completed_operation_id, operation.operation_id);

  const eventCount = engine.getEvents('time-trigger-world').filter((event) => event.event_type === 'time.trigger').length;
  const replay = engine.startTimeAdvance('time-trigger-world', {
    idempotency_key: 'durable-trigger-operation',
    expected_revision: 1,
    to_coordinate: 10000,
  });
  assert.equal(replay.operation_id, operation.operation_id);
  assert.equal(engine.getEvents('time-trigger-world').filter((event) => event.event_type === 'time.trigger').length, eventCount);
});

test('blocked registered work does not claim triggers or advance canonical time', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  engine.registerTimeTrigger('time-trigger-world', trigger('blocked', 10000, 'blocked-entity', ['missing']));
  const result = engine.startTimeAdvance('time-trigger-world', {
    idempotency_key: 'blocked-registered-advance',
    expected_revision: 1,
    to_coordinate: 10000,
  });
  assert.equal(result.status, 'blocked');
  assert.equal(result.confirmed_coordinate, 0);
  assert.equal(engine.getState('time-trigger-world').game_time_coordinate, 0);
  const [stored] = engine.listTimeTriggers('time-trigger-world');
  assert.equal(stored.status, 'pending');
  assert.equal(stored.claimed_by_operation_id, null);
});

test('cancellation is audited and request-scoped advancement cannot bypass registered pending work', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  const input = trigger('cancel-me', 10000, 'cancelled-entity');
  engine.registerTimeTrigger('time-trigger-world', input);
  const cancelled = engine.cancelTimeTrigger('time-trigger-world', 'cancel-me', 'author_removed_process');
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.cancellation_reason, 'author_removed_process');
  assert.equal(engine.getState('time-trigger-world').world_revision, 2);
  assert.equal(engine.registerTimeTrigger('time-trigger-world', input).idempotent_replay, true);

  engine.registerTimeTrigger('time-trigger-world', trigger('registered-pending', 20000, 'pending-entity'));
  const revision = engine.getState('time-trigger-world').world_revision;
  assert.throws(
    () => engine.startTimeAdvance('time-trigger-world', {
      idempotency_key: 'external-source-advance',
      expected_revision: revision,
      to_coordinate: 20000,
      triggers: [],
    }),
    (error) => error.code === 'TIME_TRIGGER_SOURCE_CONFLICT'
      && error.details.trigger_ids.includes('registered-pending'),
  );
  assert.equal(engine.getState('time-trigger-world').game_time_coordinate, 0);
  assert.equal(engine.listTimeTriggers('time-trigger-world').find((item) => item.trigger_id === 'registered-pending').status, 'pending');
});

test('Core derives scheduler write sets from trigger effects before grouping same-coordinate work', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  engine.registerTimeTrigger('time-trigger-world', {
    ...trigger('write-one', 10000, 'shared-entity'),
    write_set: [],
  });
  engine.registerTimeTrigger('time-trigger-world', {
    ...trigger('write-two', 10000, 'shared-entity'),
    write_set: [],
  });
  assert.throws(
    () => engine.startTimeAdvance('time-trigger-world', {
      idempotency_key: 'conflicting-registered-work',
      expected_revision: 2,
      to_coordinate: 10000,
    }),
    (error) => error.code === 'TRIGGER_CONFLICT_NEEDS_REVIEW',
  );
  assert.equal(engine.getState('time-trigger-world').game_time_coordinate, 0);
  assert.equal(engine.listTimeTriggers('time-trigger-world').every((item) => item.status === 'pending'), true);
});

test('failed trigger segment rolls back time and trigger completion, leaving explicit review state', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  const invalid = trigger('invalid-read', 10000, 'invalid-entity');
  invalid.read_set = ['entity:missing-source'];
  invalid.payload.event.read_set = ['entity:missing-source'];
  engine.registerTimeTrigger('time-trigger-world', invalid);

  const operation = engine.startTimeAdvance('time-trigger-world', {
    idempotency_key: 'invalid-trigger-operation',
    expected_revision: 1,
    to_coordinate: 10000,
  });
  assert.equal(operation.status, 'needs_review');
  assert.equal(engine.getState('time-trigger-world').game_time_coordinate, 0);
  assert.equal(engine.getEvents('time-trigger-world').length, 0);

  const stored = engine.getTimeTrigger('time-trigger-world', 'invalid-read');
  assert.equal(stored.status, 'pending');
  assert.equal(stored.claimed_by_operation_id, operation.operation_id);
  assert.equal(engine.cancelTimeTrigger('time-trigger-world', 'invalid-read', 'operator_reviewed_failure').status, 'cancelled');
  assert.equal(engine.getTimeTrigger('time-trigger-world', 'invalid-read').claimed_by_operation_id, null);
});

test('a running operation claim prevents concurrent trigger cancellation', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  engine.registerTimeTrigger('time-trigger-world', trigger('claimed', 10000, 'claimed-entity'));
  const event = engine.prepareEvent({
    event_id: 'claim-time-advance-event',
    idempotency_key: 'claim-time-advance-event',
    turn_id: 'claim-time-advance-event',
    event_type: 'time.advance',
    time_advance_seconds: 10,
    time_mode: 'explicit_skip',
    effects: [],
  });
  store.createTimeAdvanceOperation({
    world_id: 'time-trigger-world',
    operation_id: 'running-operation',
    idempotency_key: 'running-operation-key',
    request_hash: 'running-operation-hash',
    from_coordinate: 0,
    target_coordinate: 10000,
    starting_world_revision: 1,
    status: 'running',
    segments: [{
      coordinate: 10000,
      trigger_ids: ['claimed'],
      registered_trigger_ids: ['claimed'],
      idempotency_key: 'running-segment-key',
      request_hash: 'running-segment-hash',
      events: [event],
    }],
    plan: { status: 'planned', completed_trigger_ids: ['claimed'] },
    claimed_trigger_ids: ['claimed'],
  });

  assert.throws(
    () => engine.cancelTimeTrigger('time-trigger-world', 'claimed', 'race'),
    (error) => error.code === 'TIME_TRIGGER_CLAIMED',
  );
  assert.equal(engine.getTimeTrigger('time-trigger-world', 'claimed').claimed_by_operation_id, 'running-operation');
});


test('registered scheduled events cannot bypass the active TimePolicy duration decision', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  engine.registerTimeTrigger('time-trigger-world', trigger('travel-after-policy', 10000, 'travel-entity', []));
  const calendar_definition = {
    calendar_id: 'trigger.calendar',
    version: '1.0.0',
    day_length_ms: 86400000,
    weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    year_cycle: [{ id: 'standard', name: 'Standard', months: [{ id: 'jan', name: 'January', days: 31 }] }],
    epoch: { coordinate: 0, year_number: 2000, year_cycle_index: 0, month_id: 'jan', day_of_month: 1, weekday_index: 0, time_of_day_ms: 0 },
    holidays: [],
  };
  engine.registerTimeConfiguration('time-trigger-world', {
    version: 'time-config-policy',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    calendar_definition,
    time_policy: {
      policy_id: 'trigger.policy',
      version: '1.0.0',
      max_action_duration_ms: 43200000,
      max_skip_duration_ms: 1209600000,
      duration_rules: [{ event_type: 'time.trigger', rule: { kind: 'fixed', duration_ms: 60000 } }],
    },
  });
  const revision = engine.getState('time-trigger-world').world_revision;
  assert.throws(
    () => engine.startTimeAdvance('time-trigger-world', {
      idempotency_key: 'trigger-policy-bypass',
      expected_revision: revision,
      to_coordinate: 10000,
    }),
    (error) => error.code === 'DURATION_MISMATCH',
  );
  assert.equal(engine.getState('time-trigger-world').game_time_coordinate, 0);
  assert.equal(engine.listTimeTriggers('time-trigger-world').find((item) => item.trigger_id === 'travel-after-policy').status, 'pending');
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM time_advance_operations WHERE world_id=?').get('time-trigger-world').count, 0);

  assert.throws(
    () => engine.registerTimeTrigger('time-trigger-world', trigger('new-travel', 20000, 'new-travel-entity', [])),
    (error) => error.code === 'DURATION_MISMATCH',
  );
});
