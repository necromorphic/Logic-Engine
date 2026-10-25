import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';

const worldInput = (worldId = 'world-a') => ({
  world_id: worldId,
  world_pack_id: 'test-pack',
  world_pack_version: '1',
  game_time: '2000-01-01T00:00:00.000Z',
});

const processInput = (worldId = 'world-a') => ({
  process_id: 'knowledge-boundary-check',
  definition_version: '1',
  idempotency_key: 'create-knowledge-boundary-check',
  expected_revision: 0,
  milestones: [
    {
      milestone_id: 'first',
      trigger_id: 'knowledge-boundary-first',
      due_coordinate: 1000,
      prerequisites: [],
      read_set: [],
      write_set: [],
      event: { turn_id: 'knowledge-boundary-first-event', event_type: 'process.milestone', effects: [] },
    },
    {
      milestone_id: 'second',
      trigger_id: 'knowledge-boundary-second',
      due_coordinate: 2000,
      prerequisites: ['first'],
      read_set: [],
      write_set: [],
      event: { turn_id: 'knowledge-boundary-second-event', event_type: 'process.milestone', effects: [] },
    },
  ],
  world_id: worldId,
});

test('process completion is isolated from NPC knowledge, delivery, and receipt side effects', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-engine-knowledge-boundary-'));
  const store = new SQLiteStore(join(directory, 'engine.sqlite'));
  const engine = new LogicEngine(store);
  t.after(() => {
    try { store.close(); } catch {}
    rmSync(directory, { recursive: true, force: true });
  });

  store.createWorld(worldInput());
  const beforeTables = store.db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  ).all().map((row) => row.name);

  const created = engine.createProcess('world-a', processInput());
  assert.equal(created.process.status, 'scheduled');

  let state = engine.getState('world-a');
  const first = engine.startTimeAdvance('world-a', {
    idempotency_key: 'advance-first-milestone',
    expected_revision: state.world_revision,
    to_coordinate: 1000,
  });
  assert.equal(first.status, 'completed');
  assert.equal(engine.getProcess('world-a', 'knowledge-boundary-check').progress.completed, 1);

  state = engine.getState('world-a');
  const second = engine.startTimeAdvance('world-a', {
    idempotency_key: 'advance-second-milestone',
    expected_revision: state.world_revision,
    to_coordinate: 2000,
  });
  assert.equal(second.status, 'completed');

  const completed = engine.getProcess('world-a', 'knowledge-boundary-check');
  assert.equal(completed.status, 'completed');
  assert.equal(completed.progress.completed, 2);
  assert.equal(Object.hasOwn(completed, 'knowledge_records'), false);
  assert.equal(Object.hasOwn(completed, 'deliveries'), false);
  assert.equal(Object.hasOwn(completed, 'receipts'), false);

  const audit = engine.getAudit('world-a');
  assert.equal(audit.some((entry) => /^(npc\.)?knowledge\.|^delivery\.|^receipt\./.test(entry.action)), false);

  const afterTables = store.db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  ).all().map((row) => row.name);
  assert.deepEqual(afterTables, beforeTables,
    'advancing a process must not create knowledge, delivery, or receipt persistence tables');
});
