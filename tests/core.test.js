import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { evaluateCondition } from '../src/core/rules.js';

function setup() {
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  engine.createWorld({ world_id: 'w', world_pack_id: 'test.world', world_pack_version: '1.0.0', game_time: '2005-12-29T10:00:00Z' });
  return { store, engine };
}

const cmd = (x) => ({
  idempotency_key: 'key-1', turn_id: 'turn-1', event_type: 'action.completed',
  expected_revision: 0, effects: [], caused_by: [], depends_on: [], read_set: [], ...x,
});

test('idempotency replays only an identical request', (t) => {
  const h = setup();
  t.after(() => h.store.close());
  const x = cmd({
    time_advance_seconds: 300,
    effects: [{ kind: 'entity.upsert', entity_id: 'n1', entity_type: 'character', attributes: { name: 'Mira' } }],
  });
  const a = h.engine.commitEvent('w', x);
  const b = h.engine.commitEvent('w', x);
  assert.equal(a.world_revision, 1);
  assert.equal(a.game_time, '2005-12-29T10:05:00.000Z');
  assert.equal(b.idempotent_replay, true);
  assert.equal(h.engine.getState('w').entities.length, 1);

  assert.throws(
    () => h.engine.commitEvent('w', { ...x, effects: [{ kind: 'entity.upsert', entity_id: 'different', entity_type: 'object' }] }),
    (error) => error.code === 'IDEMPOTENCY_KEY_CONFLICT' && error.status === 409,
  );
  assert.equal(h.engine.getState('w').entities.some((entity) => entity.entity_id === 'different'), false);
});

test('stale proposal is rejected without partial effects', (t) => {
  const h = setup();
  t.after(() => h.store.close());
  h.engine.commitEvent('w', cmd({ effects: [{ kind: 'entity.upsert', entity_id: 'a', entity_type: 'object' }] }));
  assert.throws(
    () => h.engine.commitEvent('w', cmd({ idempotency_key: 'key-2', turn_id: 'turn-2', effects: [{ kind: 'entity.upsert', entity_id: 'b', entity_type: 'object' }] })),
    (error) => error.code === 'REVISION_CONFLICT',
  );
  assert.equal(h.engine.getState('w').entities.length, 1);
});

test('causal references must resolve to valid prior events in the same world', (t) => {
  const h = setup();
  t.after(() => h.store.close());
  assert.throws(
    () => h.engine.commitEvent('w', cmd({ caused_by: ['missing-event'] })),
    (error) => error.code === 'INVALID_CAUSAL_REFERENCE',
  );
  assert.throws(
    () => h.engine.commitEvent('w', cmd({ idempotency_key: 'bad-dependency', depends_on: ['missing-event'] })),
    (error) => error.code === 'INVALID_CAUSAL_REFERENCE',
  );
  assert.throws(
    () => h.engine.commitEvent('w', cmd({ idempotency_key: 'bad-read-set', read_set: ['untyped-reference'] })),
    (error) => error.code === 'INVALID_READ_SET_REFERENCE',
  );

  h.engine.createWorld({ world_id: 'other-world', world_pack_id: 'test.world', world_pack_version: '1.0.0', game_time: '2005-12-29T10:00:00Z' });
  const foreign = h.engine.commitEvent('other-world', cmd({ event_id: 'foreign-event', idempotency_key: 'foreign-key' }));
  assert.equal(foreign.accepted, true);
  assert.throws(
    () => h.engine.commitEvent('w', cmd({ idempotency_key: 'cross-world', caused_by: ['foreign-event'] })),
    (error) => error.code === 'CROSS_WORLD_REFERENCE',
  );
});

test('depends_on entity and fact references must exist in the current world', (t) => {
  const h = setup();
  t.after(() => h.store.close());
  assert.throws(
    () => h.engine.commitEvent('w', cmd({ depends_on: ['entity:ghost'] })),
    (error) => error.code === 'INVALID_DEPENDENCY_REFERENCE',
  );
  h.engine.commitEvent('w', cmd({ effects: [{ kind: 'entity.upsert', entity_id: 'n1', entity_type: 'character' }] }));
  assert.throws(
    () => h.engine.commitEvent('w', cmd({ idempotency_key: 'bad-fact-dependency', expected_revision: 1, depends_on: ['fact:missing'] })),
    (error) => error.code === 'INVALID_DEPENDENCY_REFERENCE',
  );
});

test('rollback restores projections, preserves independent branch, and never rewinds game time', (t) => {
  const h = setup();
  t.after(() => h.store.close());
  h.engine.commitEvent('w', cmd({
    event_id: 'seed', idempotency_key: 'seed',
    effects: [{ kind: 'entity.upsert', entity_id: 'victim', entity_type: 'character', attributes: { alive: true } }],
  }));
  h.engine.commitEvent('w', cmd({
    event_id: 'death', idempotency_key: 'death', turn_id: 'death', expected_revision: 1,
    time_advance_seconds: 3600,
    effects: [{ kind: 'entity.upsert', entity_id: 'victim', entity_type: 'character', status: 'destroyed', attributes: { alive: false } }],
  }));
  h.engine.commitEvent('w', cmd({
    event_id: 'evidence', idempotency_key: 'evidence', turn_id: 'evidence', expected_revision: 2,
    caused_by: ['death'], read_set: ['entity:victim'],
    effects: [{ kind: 'fact.set', fact_id: 'dead', predicate: 'dead', value: true }],
  }));
  h.engine.commitEvent('w', cmd({
    event_id: 'independent', idempotency_key: 'independent', turn_id: 'independent', expected_revision: 3,
    effects: [{ kind: 'entity.upsert', entity_id: 'witness', entity_type: 'character' }],
  }));
  const result = h.engine.rollbackEvent('w', { root_event_id: 'death', idempotency_key: 'rollback' });
  const state = h.engine.getState('w');
  assert.deepEqual(new Set(result.invalidated_event_ids), new Set(['death', 'evidence']));
  assert.equal(state.entities.find((entity) => entity.entity_id === 'victim').status, 'active');
  assert.equal(state.entities.some((entity) => entity.entity_id === 'witness'), true);
  assert.equal(state.facts.length, 0);
  assert.equal(state.game_time, '2005-12-29T11:00:00.000Z');
  assert.equal(state.world_revision, 5);
});

test('conflicting independent fact claims are not silently resolved', (t) => {
  const h = setup();
  t.after(() => h.store.close());
  h.engine.commitEvent('w', cmd({ event_id: 'a', idempotency_key: 'a', effects: [{ kind: 'fact.set', fact_id: 'door', predicate: 'open', value: true }] }));
  h.engine.commitEvent('w', cmd({ event_id: 'b', idempotency_key: 'b', turn_id: 'b', expected_revision: 1, effects: [{ kind: 'fact.set', fact_id: 'door', predicate: 'open', value: false }] }));
  assert.equal(h.engine.getState('w').facts[0].status, 'conflicted');
  h.engine.rollbackEvent('w', { root_event_id: 'b', idempotency_key: 'rb' });
  assert.equal(h.engine.getState('w').facts[0].value, true);
});

test('time bounds and declarative rules reject invalid AST and unsafe paths', (t) => {
  const h = setup();
  t.after(() => h.store.close());
  assert.throws(() => h.engine.commitEvent('w', cmd({ time_advance_seconds: 43201 })), (error) => error.code === 'TIME_ADVANCE_TOO_LARGE');
  assert.equal(evaluateCondition({
    op: 'all',
    conditions: [{ op: 'eq', path: 'npc.status', value: 'active' }, { op: 'gte', path: 'npc.age', value: 18 }],
  }, { npc: { status: 'active', age: 24 } }), true);
  assert.throws(() => evaluateCondition({ op: 'exec' }, {}), (error) => error.code === 'UNSUPPORTED_RULE_OPERATOR');
  assert.throws(() => evaluateCondition({ op: 'eq', path: '__proto__.polluted', value: true }, {}), (error) => error.code === 'INVALID_RULE_PATH');
  assert.throws(() => evaluateCondition({ op: 'gt', path: 'npc.age', value: '18' }, { npc: { age: 24 } }), (error) => error.code === 'RULE_TYPE_MISMATCH');
});


test('declarative rule evaluator accepts schema-shaped nested rules and compares JSON values deterministically', () => {
  const context = {
    npc: { status: 'active', age: 24, metadata: { first: 1, second: 2 } },
  };

  assert.equal(evaluateCondition({
    op: 'all',
    rules: [
      { op: 'eq', path: 'npc.status', value: 'active' },
      { op: 'not', rules: [{ op: 'lt', path: 'npc.age', value: 18 }] },
      { op: 'eq', path: 'npc.metadata', value: { second: 2, first: 1 } },
    ],
  }, context), true);

  assert.equal(evaluateCondition({
    op: 'any',
    rules: [
      { op: 'eq', path: 'npc.status', value: 'inactive' },
      { op: 'in', path: 'npc.metadata', values: [{ second: 2, first: 1 }] },
    ],
  }, context), true);

  assert.throws(
    () => evaluateCondition({ op: 'not', rules: [] }, context),
    (error) => error.code === 'INVALID_RULE',
  );
  assert.throws(
    () => evaluateCondition({ op: 'all', rules: [], conditions: [] }, context),
    (error) => error.code === 'INVALID_RULE',
  );
  assert.throws(
    () => evaluateCondition({ op: 'in', path: 'npc.status', values: Array(129).fill('active') }, context),
    (error) => error.code === 'INVALID_RULE',
  );
});

test('a failed audit write rolls back the entire event transaction', (t) => {
  const h = setup();
  t.after(() => h.store.close());
  h.store.db.exec(`
    CREATE TRIGGER fail_event_audit BEFORE INSERT ON audit_entries
    WHEN NEW.action='event.committed'
    BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END;
  `);
  assert.throws(() => h.engine.commitEvent('w', cmd({
    effects: [{ kind: 'entity.upsert', entity_id: 'never-committed', entity_type: 'object' }],
  })));
  assert.equal(h.engine.getState('w').world_revision, 0);
  assert.equal(h.engine.getState('w').entities.length, 0);
  assert.equal(h.engine.getEvents('w', true).length, 0);
  assert.equal(h.engine.getAudit('w').length, 1);
});

test('legacy SQLite schema is upgraded with an idempotency migration', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'logic-engine-migration-'));
  const path = join(dir, 'legacy.sqlite');
  const legacy = new DatabaseSync(path);
  legacy.exec(`
    CREATE TABLE idempotency_keys(
      world_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, response_json TEXT NOT NULL,
      created_at TEXT NOT NULL, PRIMARY KEY(world_id,idempotency_key)
    );
  `);
  legacy.close();
  const store = new SQLiteStore(path);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const columns = store.db.prepare('PRAGMA table_info(idempotency_keys)').all();
  assert.equal(columns.some((column) => column.name === 'request_hash'), true);
  assert.equal(store.db.prepare('SELECT version FROM schema_migrations WHERE version=1').get().version, 1);
});
