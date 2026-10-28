import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';

// Research-only feasibility test. Uses a temporary SQLite database and removes
// it after the test. It does not change production code or user data.
function trigger(triggerId, dueCoordinate, entityId) {
  return {
    trigger_id: triggerId,
    due_coordinate: dueCoordinate,
    dependencies: [],
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

function readSegmentRows(store, worldId, operationId) {
  const row = store.db.prepare(
    'SELECT segments_json FROM time_advance_operations WHERE world_id=? AND operation_id=?',
  ).get(worldId, operationId);
  assert.ok(row, 'operation checkpoint must remain stored');
  return JSON.parse(row.segments_json);
}

function assertSegmentCursorMapping(store, worldId, segments) {
  for (const segment of segments) {
    assert.ok(Array.isArray(segment.events) && segment.events.length > 0);
    const boundaryEventId = segment.events.at(-1).event_id;
    const event = store.db.prepare(
      'SELECT event_id,game_time_coordinate,commit_sequence,validity FROM world_events WHERE world_id=? AND event_id=?',
    ).get(worldId, boundaryEventId);
    assert.ok(event, `segment boundary event ${boundaryEventId} must exist`);
    assert.equal(event.game_time_coordinate, segment.coordinate);
    assert.equal(Number.isInteger(event.commit_sequence), true);
    assert.equal(event.validity, 'valid');
    segment.boundaryCursor = {
      event_id: event.event_id,
      game_time_coordinate: event.game_time_coordinate,
      commit_sequence: event.commit_sequence,
    };
  }
  return segments;
}

test('persisted TimeEngine segment plan can reconstruct each segment boundary cursor after restart', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-engine-spatial-cursor-'));
  const path = join(directory, 'state.sqlite');
  let store = new SQLiteStore(path);
  let engine = new LogicEngine(store);
  const worldId = 'spatial-cursor-world';

  engine.createWorld({
    world_id: worldId,
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    game_time: '2026-01-01T00:00:00.000Z',
  });

  t.after(() => {
    try { store.close(); } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  engine.registerTimeTrigger(worldId, trigger('cursor-at-10', 10000, 'entity-at-10'));
  engine.registerTimeTrigger(worldId, trigger('cursor-at-20', 20000, 'entity-at-20'));
  const operation = engine.startTimeAdvance(worldId, {
    idempotency_key: 'spatial-cursor-operation',
    expected_revision: 2,
    to_coordinate: 20000,
  });

  assert.equal(operation.status, 'completed');
  assert.equal(operation.confirmed_coordinate, 20000);
  assert.equal(Number.isInteger(operation.result.last_segment.commit_sequence), true);
  assert.equal(operation.result.last_segment.end_game_time_coordinate, 20000);

  const segmentsBeforeRestart = readSegmentRows(store, worldId, operation.operation_id);
  const mappingBeforeRestart = assertSegmentCursorMapping(store, worldId, segmentsBeforeRestart);
  assert.equal(mappingBeforeRestart.length, 2);
  assert.deepEqual(mappingBeforeRestart.map((item) => item.coordinate), [10000, 20000]);

  store.close();
  store = new SQLiteStore(path);
  engine = new LogicEngine(store);

  const recovered = engine.getTimeAdvanceOperation(worldId, operation.operation_id);
  assert.equal(recovered.status, 'completed');
  assert.equal(recovered.confirmed_coordinate, 20000);
  assert.equal(recovered.result.last_segment.commit_sequence, mappingBeforeRestart[1].boundaryCursor.commit_sequence);

  const segmentsAfterRestart = readSegmentRows(store, worldId, operation.operation_id);
  const mappingAfterRestart = assertSegmentCursorMapping(store, worldId, segmentsAfterRestart);
  assert.deepEqual(
    mappingAfterRestart.map((item) => item.boundaryCursor),
    mappingBeforeRestart.map((item) => item.boundaryCursor),
  );
});


test('rollback invalidates the affected historical boundary and makes the stored checkpoint stale', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-engine-spatial-cursor-rollback-'));
  const path = join(directory, 'state.sqlite');
  let store = new SQLiteStore(path);
  let engine = new LogicEngine(store);
  const worldId = 'spatial-cursor-rollback-world';

  engine.createWorld({
    world_id: worldId,
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    game_time: '2026-01-01T00:00:00.000Z',
  });
  t.after(() => {
    try { store.close(); } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  engine.registerTimeTrigger(worldId, trigger('rollback-at-10', 10000, 'rollback-entity-10'));
  engine.registerTimeTrigger(worldId, trigger('rollback-at-20', 20000, 'rollback-entity-20'));
  const operation = engine.startTimeAdvance(worldId, {
    idempotency_key: 'spatial-cursor-rollback-operation',
    expected_revision: 2,
    to_coordinate: 20000,
  });
  assert.equal(operation.status, 'completed');

  const segments = readSegmentRows(store, worldId, operation.operation_id);
  assert.equal(segments.length, 2);
  const firstBoundaryEventId = segments[0].events.at(-1).event_id;
  const secondBoundaryEventId = segments[1].events.at(-1).event_id;
  const storedRevision = operation.current_world_revision;

  const rollback = engine.rollbackEvent(worldId, {
    root_event_id: firstBoundaryEventId,
    idempotency_key: 'rollback-spatial-cursor-first-boundary',
  });
  assert.equal(rollback.accepted, true);
  assert.ok(rollback.invalidated_event_ids.includes(firstBoundaryEventId));

  const first = store.db.prepare(
    'SELECT validity FROM world_events WHERE world_id=? AND event_id=?',
  ).get(worldId, firstBoundaryEventId);
  const second = store.db.prepare(
    'SELECT validity FROM world_events WHERE world_id=? AND event_id=?',
  ).get(worldId, secondBoundaryEventId);
  assert.notEqual(first.validity, 'valid');
  assert.equal(second.validity, 'valid');

  const currentWorld = engine.getState(worldId);
  const recoveredOperation = engine.getTimeAdvanceOperation(worldId, operation.operation_id);
  assert.equal(recoveredOperation.status, 'completed');
  assert.notEqual(currentWorld.world_revision, storedRevision);

  // The completed operation row is not automatically rewritten by a later
  // rollback. Consumers must not treat its old checkpoint as the current world
  // marker; the invalidated earlier segment must not be a confirmed boundary.
  const firstCursorIsValid = first.validity === 'valid';
  const checkpointMatchesCurrentWorld = recoveredOperation.current_world_revision === currentWorld.world_revision;
  assert.equal(firstCursorIsValid, false);
  assert.equal(checkpointMatchesCurrentWorld, false);
});
