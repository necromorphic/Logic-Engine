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
