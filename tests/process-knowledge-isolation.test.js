import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';

const worldInput = {
  world_id: 'isolation-world',
  world_pack_id: 'test-pack',
  world_pack_version: '1',
  game_time: '2000-01-01T00:00:00.000Z',
};

const processInput = {
  process_id: 'isolated-process',
  definition_version: '1',
  idempotency_key: 'create-isolated-process',
  expected_revision: 0,
  milestones: [
    {
      milestone_id: 'first',
      trigger_id: 'isolated-first',
      due_coordinate: 1000,
      prerequisites: [],
      read_set: [],
      write_set: [],
      event: { turn_id: 'isolated-first-event', event_type: 'process.first', effects: [] },
    },
    {
      milestone_id: 'second',
      trigger_id: 'isolated-second',
      due_coordinate: 2000,
      prerequisites: ['first'],
      read_set: [],
      write_set: [],
      event: { turn_id: 'isolated-second-event', event_type: 'process.second', effects: [] },
    },
  ],
};

const sideEffectTableNames = (store) => store.db.prepare(`
  SELECT name FROM sqlite_master
  WHERE type='table'
    AND (
      lower(name) LIKE '%knowledge%'
      OR lower(name) LIKE '%delivery%'
      OR lower(name) LIKE '%receipt%'
    )
  ORDER BY name
`).all().map((row) => row.name);

const rowCounts = (store, tableNames) => Object.fromEntries(tableNames.map((name) => {
  // Table names originate from sqlite_master, not caller input.
  const quoted = '"' + name.replaceAll('"', '""') + '"';
  return [name, store.db.prepare('SELECT COUNT(*) AS count FROM ' + quoted).get().count];
}));

test('process completion stays separate from NPC knowledge, delivery, and receipt', () => {
  const store = new SQLiteStore(':memory:');
  try {
    const engine = new LogicEngine(store);
    store.createWorld(worldInput);

    const tablesBefore = sideEffectTableNames(store);
    const countsBefore = rowCounts(store, tablesBefore);

    engine.createProcess('isolation-world', processInput);
    const first = engine.getState('isolation-world');
    engine.startTimeAdvance('isolation-world', {
      idempotency_key: 'advance-first',
      expected_revision: first.world_revision,
      to_coordinate: 1000,
    });
    const second = engine.getState('isolation-world');
    const completed = engine.startTimeAdvance('isolation-world', {
      idempotency_key: 'advance-second',
      expected_revision: second.world_revision,
      to_coordinate: 2000,
    });

    assert.equal(completed.status, 'completed');
    assert.equal(engine.getProcess('isolation-world', 'isolated-process').status, 'completed');

    const tablesAfter = sideEffectTableNames(store);
    assert.deepEqual(tablesAfter, tablesBefore,
      'completing a process must not create a knowledge/delivery/receipt subsystem as a side effect');
    assert.deepEqual(rowCounts(store, tablesAfter), countsBefore,
      'process completion must not insert NPC knowledge, delivery, or receipt records');

    const eventRows = store.db.prepare(
      'SELECT event_type, effects_json FROM world_events WHERE world_id=? ORDER BY commit_sequence',
    ).all('isolation-world');
    assert.deepEqual(
      eventRows.filter((row) => row.event_type !== 'time.advance').map((row) => row.event_type),
      ['process.first', 'process.second'],
      'both process milestone events must be canonical; time.advance wrapper events are expected',
    );
    assert.equal(eventRows.every((row) => JSON.parse(row.effects_json).length === 0), true);

    const auditActions = store.db.prepare(
      'SELECT action FROM audit_entries WHERE world_id=? ORDER BY audit_id',
    ).all('isolation-world').map((row) => row.action);
    assert.equal(auditActions.some((action) => /knowledge|delivery|receipt/i.test(action)), false);
  } finally {
    store.close();
  }
});
