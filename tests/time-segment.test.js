import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';

function setup() {
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  engine.createWorld({
    world_id: 'segment-world',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    game_time: '2005-12-29T10:00:00.000Z',
  });
  return { store, engine };
}

const event = (eventId, key, effects, overrides = {}) => ({
  event_id: eventId,
  idempotency_key: key,
  turn_id: 'turn-' + eventId,
  event_type: 'action.completed',
  time_advance_seconds: 0,
  effects,
  caused_by: [],
  depends_on: [],
  read_set: [],
  causal_links: [],
  ...overrides,
});

const segment = (overrides = {}) => ({
  idempotency_key: 'segment-key',
  expected_revision: 0,
  expected_commit_sequence: 0,
  events: [
    event('segment-event-1', 'segment-event-key-1', [
      { kind: 'entity.upsert', entity_id: 'alpha', entity_type: 'object', attributes: { value: 1 } },
    ], { time_advance_seconds: 10 }),
    event('segment-event-2', 'segment-event-key-2', [
      { kind: 'entity.upsert', entity_id: 'beta', entity_type: 'object', attributes: { value: 2 } },
    ], { time_advance_seconds: 20 }),
  ],
  ...overrides,
});

test('independent events commit as one atomic segment and rebuild projections once', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());
  const originalRebuild = store.rebuild.bind(store);
  let rebuildCalls = 0;
  store.rebuild = (...args) => {
    rebuildCalls += 1;
    return originalRebuild(...args);
  };

  const result = engine.commitSegment('segment-world', segment());
  assert.equal(result.accepted, true);
  assert.deepEqual(result.event_ids, ['segment-event-1', 'segment-event-2']);
  assert.equal(result.start_game_time_coordinate, 0);
  assert.equal(result.end_game_time_coordinate, 30000);
  assert.equal(result.start_world_revision, 0);
  assert.equal(result.world_revision, 2);
  assert.equal(result.commit_sequence, 2);
  assert.equal(rebuildCalls, 1);
  assert.equal(engine.getState('segment-world').entities.length, 2);
  assert.equal(engine.getState('segment-world').game_time_coordinate, 30000);
  assert.deepEqual(
    engine.getEvents('segment-world').map((item) => ({ event_id: item.event_id, game_time_coordinate: item.game_time_coordinate })),
    [
      { event_id: 'segment-event-1', game_time_coordinate: 10000 },
      { event_id: 'segment-event-2', game_time_coordinate: 30000 },
    ],
  );
});

test('segment replay returns the stored result without repeating effects or projection rebuild', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());
  const request = segment();
  const first = engine.commitSegment('segment-world', request);
  const replay = engine.commitSegment('segment-world', request);

  assert.equal(replay.idempotent_replay, true);
  assert.equal(replay.segment_id, first.segment_id);
  assert.deepEqual(replay.event_ids, first.event_ids);
  assert.equal(engine.getState('segment-world').world_revision, 2);
  assert.equal(engine.getEvents('segment-world').length, 2);
});

test('a later event failure rolls back earlier segment events, audit, replay, revision, and time', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());
  engine.commitEvent('segment-world', {
    event_id: 'preexisting',
    idempotency_key: 'preexisting-key',
    turn_id: 'preexisting-turn',
    event_type: 'action.completed',
    expected_revision: 0,
    effects: [{ kind: 'entity.upsert', entity_id: 'occupied', entity_type: 'object' }],
    caused_by: [],
    depends_on: [],
    read_set: [],
    causal_links: [],
  });
  const request = segment({
    idempotency_key: 'failing-segment-key',
    expected_revision: 1,
    expected_commit_sequence: 1,
    events: [
      event('segment-fresh', 'segment-fresh-key', [
        { kind: 'entity.upsert', entity_id: 'fresh', entity_type: 'object' },
      ], { time_advance_seconds: 60 }),
      event('segment-duplicate', 'segment-duplicate-key', [
        { kind: 'entity.create', entity_id: 'occupied', entity_type: 'object' },
      ]),
    ],
  });

  assert.throws(
    () => engine.commitSegment('segment-world', request),
    (error) => error.code === 'ENTITY_ALREADY_EXISTS',
  );
  const state = engine.getState('segment-world');
  assert.equal(state.world_revision, 1);
  assert.equal(state.game_time_coordinate, 0);
  assert.equal(state.entities.length, 1);
  assert.equal(state.entities[0].entity_id, 'occupied');
  assert.deepEqual(engine.getEvents('segment-world').map((item) => item.event_id), ['preexisting']);
  assert.equal(engine.getAudit('segment-world').length, 2);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM idempotency_keys WHERE world_id=? AND idempotency_key IN ('failing-segment-key','segment-fresh-key','segment-duplicate-key')").get('segment-world').count, 0);
});

test('segment rejects intra-segment dependencies and read/write conflicts before mutation', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  const intra = segment({
    events: [
      event('first', 'first-key', [{ kind: 'entity.upsert', entity_id: 'alpha', entity_type: 'object' }]),
      event('second', 'second-key', [{ kind: 'entity.upsert', entity_id: 'beta', entity_type: 'object' }], { caused_by: ['first'] }),
    ],
  });
  assert.throws(
    () => engine.commitSegment('segment-world', intra),
    (error) => error.code === 'SEGMENT_INTRA_DEPENDENCY_UNSUPPORTED',
  );

  const conflict = segment({
    events: [
      event('writer', 'writer-key', [{ kind: 'entity.upsert', entity_id: 'shared', entity_type: 'object' }]),
      event('reader', 'reader-key', [{ kind: 'entity.upsert', entity_id: 'other', entity_type: 'object' }], { read_set: ['entity:shared'] }),
    ],
  });
  assert.throws(
    () => engine.commitSegment('segment-world', conflict),
    (error) => error.code === 'SEGMENT_READ_WRITE_CONFLICT',
  );
  assert.equal(engine.getState('segment-world').world_revision, 0);
  assert.equal(engine.getEvents('segment-world').length, 0);
});

test('stale segment plans are rejected without partial mutation', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());
  engine.commitEvent('segment-world', {
    idempotency_key: 'prior-key',
    turn_id: 'prior-turn',
    event_type: 'action.completed',
    expected_revision: 0,
    effects: [],
    caused_by: [],
    depends_on: [],
    read_set: [],
    causal_links: [],
  });
  assert.throws(
    () => engine.commitSegment('segment-world', segment()),
    (error) => error.code === 'REVISION_CONFLICT',
  );
  assert.equal(engine.getState('segment-world').world_revision, 1);
  assert.equal(engine.getEvents('segment-world').length, 1);
});


test('segment events can share the same context manifest base revision', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());
  engine.registerContextManifest('segment-world', 'segment-context', {
    generation_id: 'segment-generation',
    base_commit_sequence: 0,
    base_world_revision: 0,
    items: [],
  });
  const request = segment({
    idempotency_key: 'manifest-segment-key',
    events: [
      event('manifest-event-1', 'manifest-event-key-1', [
        { kind: 'entity.upsert', entity_id: 'manifest-alpha', entity_type: 'object' },
      ], { context_manifest_id: 'segment-context', generation_id: 'segment-generation' }),
      event('manifest-event-2', 'manifest-event-key-2', [
        { kind: 'entity.upsert', entity_id: 'manifest-beta', entity_type: 'object' },
      ], { context_manifest_id: 'segment-context', generation_id: 'segment-generation' }),
    ],
  });
  const result = engine.commitSegment('segment-world', request);
  assert.equal(result.accepted, true);
  assert.equal(engine.getState('segment-world').world_revision, 2);
  assert.equal(engine.getState('segment-world').entities.length, 2);
});
