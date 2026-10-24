import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';

const calendar = (version = '1.0.0') => ({
  calendar_id: 'world.calendar',
  version,
  day_length_ms: 86400000,
  weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  year_cycle: [{ id: 'standard', name: 'Standard', months: [
    { id: 'jan', name: 'January', days: 31 },
    { id: 'feb', name: 'February', days: 28 },
    { id: 'mar', name: 'March', days: 31 },
  ] }],
  epoch: { coordinate: 0, year_number: 2000, year_cycle_index: 0, month_id: 'jan', day_of_month: 1, weekday_index: 0, time_of_day_ms: 0 },
  holidays: [{ id: 'new-year', name: 'New Year', month_id: 'jan', day_of_month: 1 }],
});

const policy = (version = '1.0.0') => ({
  policy_id: 'world.time',
  version,
  max_action_duration_ms: 43200000,
  max_skip_duration_ms: 604800000,
  duration_rules: [
    { event_type: 'travel.completed', rule: { kind: 'fixed', duration_ms: 60000 } },
    { event_type: 'craft.completed', rule: { kind: 'category_map', categories: [
      { category: 'simple', duration_ms: 30000 },
      { category: 'complex', duration_ms: 120000 },
    ] } },
    { event_type: 'rest.completed', rule: { kind: 'range', min_duration_ms: 3600000, max_duration_ms: 28800000, resolution: 'author' } },
  ],
});

function setup() {
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  engine.createWorld({
    world_id: 'time-config-world',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    game_time: '2005-12-29T10:00:00.000Z',
  });
  return { store, engine };
}

function register(engine, overrides = {}) {
  return engine.registerTimeConfiguration('time-config-world', {
    version: 'config-1',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    calendar_definition: calendar(),
    time_policy: policy(),
    ...overrides,
  });
}

test('time configuration is pinned to the world pack, versioned, audited, and projects calendar time', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());
  const first = register(engine);
  assert.equal(first.active, true);
  assert.equal(engine.getState('time-config-world').time_config_version, 'config-1');
  assert.equal(engine.getState('time-config-world').world_revision, 1);
  assert.equal(engine.projectTime('time-config-world').calendar.year_number, 2000);
  assert.equal(engine.projectTime('time-config-world').calendar.month_id, 'jan');
  assert.equal(engine.getAudit('time-config-world').some((entry) => entry.action === 'time.configuration.activated'), true);

  const replay = register(engine);
  assert.equal(replay.active, true);
  assert.equal(engine.getState('time-config-world').world_revision, 1);

  assert.throws(
    () => register(engine, { time_policy: policy('2.0.0') }),
    (error) => error.code === 'TIME_CONFIG_VERSION_IMMUTABLE',
  );
  assert.throws(
    () => register(engine, { world_pack_version: '2.0.0' }),
    (error) => error.code === 'TIME_CONFIG_WORLD_PACK_MISMATCH',
  );
});

test('Core resolves fixed and category durations; arbitrary caller duration is rejected', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());
  register(engine);

  const fixed = engine.commitEvent('time-config-world', {
    idempotency_key: 'travel-key',
    turn_id: 'travel-turn',
    event_type: 'travel.completed',
    expected_revision: 1,
    effects: [],
  });
  assert.equal(fixed.game_time_coordinate, 60000);
  const fixedEvent = engine.getEvents('time-config-world')[0];
  assert.equal(fixedEvent.time_advance_seconds, 60);
  const audit = engine.getAudit('time-config-world').find((entry) => entry.action === 'event.committed');
  assert.equal(audit.payload.duration_decision.source, 'world_rule');
  assert.equal(audit.payload.duration_decision.duration_ms, 60000);

  assert.throws(
    () => engine.commitEvent('time-config-world', {
      idempotency_key: 'bad-duration-key',
      turn_id: 'bad-duration-turn',
      event_type: 'travel.completed',
      expected_revision: 2,
      time_advance_seconds: 30,
      effects: [],
    }),
    (error) => error.code === 'DURATION_MISMATCH',
  );
  assert.equal(engine.getState('time-config-world').game_time_coordinate, 60000);

  const category = engine.commitEvent('time-config-world', {
    idempotency_key: 'craft-key',
    turn_id: 'craft-turn',
    event_type: 'craft.completed',
    duration_proposal: { category: 'complex' },
    expected_revision: 2,
    effects: [],
  });
  assert.equal(category.game_time_coordinate, 180000);
});

test('ambiguous duration and unknown nonzero duration fail closed', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());
  register(engine);

  assert.throws(
    () => engine.commitEvent('time-config-world', {
      idempotency_key: 'rest-key',
      turn_id: 'rest-turn',
      event_type: 'rest.completed',
      expected_revision: 1,
      effects: [],
    }),
    (error) => error.code === 'DURATION_NEEDS_AUTHOR',
  );
  assert.throws(
    () => engine.commitEvent('time-config-world', {
      idempotency_key: 'unknown-duration-key',
      turn_id: 'unknown-duration-turn',
      event_type: 'unknown.completed',
      expected_revision: 1,
      time_advance_seconds: 10,
      effects: [],
    }),
    (error) => error.code === 'DURATION_PROPOSAL_REJECTED',
  );
  assert.equal(engine.getState('time-config-world').world_revision, 1);
});

test('explicit skip is a canonical time.advance operation and cannot carry an action duration proposal', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());
  register(engine);

  assert.throws(
    () => engine.commitEvent('time-config-world', {
      idempotency_key: 'invalid-skip-type',
      turn_id: 'invalid-skip-type-turn',
      event_type: 'action.completed',
      time_mode: 'explicit_skip',
      time_advance_seconds: 30,
      expected_revision: 1,
      effects: [],
    }),
    (error) => error.code === 'INVALID_TIME_SKIP_EVENT_TYPE',
  );

  assert.throws(
    () => engine.commitEvent('time-config-world', {
      idempotency_key: 'invalid-skip-proposal',
      turn_id: 'invalid-skip-proposal-turn',
      event_type: 'time.advance',
      time_mode: 'explicit_skip',
      time_advance_seconds: 30,
      duration_proposal: { category: 'complex' },
      expected_revision: 1,
      effects: [],
    }),
    (error) => error.code === 'UNEXPECTED_DURATION_PROPOSAL',
  );

  assert.equal(engine.getState('time-config-world').game_time_coordinate, 0);
  assert.equal(engine.getState('time-config-world').world_revision, 1);
});

test('time-advance operation enforces the active skip limit on the whole requested interval', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());
  register(engine, { time_policy: { ...policy(), max_skip_duration_ms: 10000 } });

  assert.throws(
    () => engine.startTimeAdvance('time-config-world', {
      idempotency_key: 'over-limit-operation',
      expected_revision: 1,
      to_coordinate: 11000,
      triggers: [],
      completed_trigger_ids: [],
    }),
    (error) => error.code === 'TIME_ADVANCE_TOO_LARGE'
      && error.details.requested_duration_ms === 11000
      && error.details.maximum_duration_ms === 10000,
  );
  assert.equal(engine.getState('time-config-world').game_time_coordinate, 0);
  assert.equal(engine.getState('time-config-world').world_revision, 1);
});

test('activating a new config version preserves the old version and invalidates prior revision-bound requests', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());
  register(engine);
  const second = register(engine, {
    version: 'config-2',
    calendar_definition: calendar('2.0.0'),
    time_policy: policy('2.0.0'),
  });
  assert.equal(second.active, true);
  assert.equal(engine.getState('time-config-world').time_config_version, 'config-2');
  assert.equal(engine.getTimeConfiguration('time-config-world', 'config-1').active, false);
  assert.equal(engine.getState('time-config-world').game_time_coordinate, 0);
  assert.equal(engine.getState('time-config-world').world_revision, 2);

  engine.commitEvent('time-config-world', {
    idempotency_key: 'history-event-key',
    turn_id: 'history-event-turn',
    event_type: 'relationship.transition',
    expected_revision: 2,
    effects: [],
  });
  const changedCalendar = calendar('3.0.0');
  changedCalendar.year_cycle = [{ id: 'short', name: 'Short', months: [{ id: 'jan', name: 'January', days: 30 }] }];
  assert.throws(
    () => register(engine, {
      version: 'config-3',
      calendar_definition: changedCalendar,
      time_policy: policy('3.0.0'),
    }),
    (error) => error.code === 'CALENDAR_REBASE_REQUIRES_AUTHOR_POLICY',
  );
  assert.equal(engine.getState('time-config-world').time_config_version, 'config-2');
});
