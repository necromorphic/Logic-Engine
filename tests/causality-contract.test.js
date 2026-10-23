import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';

function setup() {
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  engine.createWorld({
    world_id: 'causality-world',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    game_time: '2005-12-29T10:00:00Z',
  });
  return { store, engine };
}

function command(overrides = {}) {
  return {
    idempotency_key: 'key',
    turn_id: 'turn',
    event_type: 'action.completed',
    expected_revision: 0,
    effects: [],
    caused_by: [],
    depends_on: [],
    read_set: [],
    ...overrides,
  };
}

test('rollback follows declared entity dependencies but preserves independent later events', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  engine.commitEvent('causality-world', command({
    event_id: 'seed-victim',
    idempotency_key: 'seed-victim',
    effects: [{ kind: 'entity.upsert', entity_id: 'victim', entity_type: 'character', attributes: { alive: true } }],
  }));
  engine.commitEvent('causality-world', command({
    event_id: 'death',
    idempotency_key: 'death',
    turn_id: 'death',
    expected_revision: 1,
    effects: [{ kind: 'entity.upsert', entity_id: 'victim', entity_type: 'character', status: 'destroyed', attributes: { alive: false } }],
  }));
  engine.commitEvent('causality-world', command({
    event_id: 'dependent-clue',
    idempotency_key: 'dependent-clue',
    turn_id: 'dependent-clue',
    expected_revision: 2,
    depends_on: ['entity:victim'],
    effects: [{ kind: 'fact.set', fact_id: 'death-clue', predicate: 'exists', value: true }],
  }));
  engine.commitEvent('causality-world', command({
    event_id: 'independent',
    idempotency_key: 'independent',
    turn_id: 'independent',
    expected_revision: 3,
    effects: [{ kind: 'entity.upsert', entity_id: 'unrelated-witness', entity_type: 'character' }],
  }));

  const rollback = engine.rollbackEvent('causality-world', {
    root_event_id: 'death',
    idempotency_key: 'rollback-death',
  });
  const state = engine.getState('causality-world');
  const events = engine.getEvents('causality-world', true);

  assert.deepEqual(new Set(rollback.invalidated_event_ids), new Set(['death', 'dependent-clue']));
  assert.equal(state.entities.find((entity) => entity.entity_id === 'victim').status, 'active');
  assert.equal(state.entities.some((entity) => entity.entity_id === 'unrelated-witness'), true);
  assert.equal(state.facts.some((fact) => fact.fact_id === 'death-clue'), false);
  assert.equal(events.find((event) => event.event_id === 'independent').validity, 'valid');
  assert.equal(state.world_revision, 5);
  assert.equal(state.game_time, '2005-12-29T10:00:00.000Z');
});

test('rollback traverses a causal diamond and preserves a truly independent branch', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  engine.commitEvent('causality-world', command({
    event_id: 'root',
    idempotency_key: 'root',
    effects: [{ kind: 'entity.upsert', entity_id: 'witness', entity_type: 'character', attributes: { present: true } }],
  }));
  engine.commitEvent('causality-world', command({
    event_id: 'left-branch',
    idempotency_key: 'left-branch',
    turn_id: 'left-branch',
    expected_revision: 1,
    read_set: ['entity:witness'],
    effects: [{ kind: 'fact.set', fact_id: 'left-observation', predicate: 'observed', value: true }],
  }));
  engine.commitEvent('causality-world', command({
    event_id: 'right-branch',
    idempotency_key: 'right-branch',
    turn_id: 'right-branch',
    expected_revision: 2,
    depends_on: ['entity:witness'],
    effects: [{ kind: 'fact.set', fact_id: 'right-observation', predicate: 'observed', value: true }],
  }));
  engine.commitEvent('causality-world', command({
    event_id: 'join',
    idempotency_key: 'join',
    turn_id: 'join',
    expected_revision: 3,
    caused_by: ['left-branch', 'right-branch'],
    effects: [{ kind: 'fact.set', fact_id: 'combined-conclusion', predicate: 'supported', value: true }],
  }));
  engine.commitEvent('causality-world', command({
    event_id: 'independent-branch',
    idempotency_key: 'independent-branch',
    turn_id: 'independent-branch',
    expected_revision: 4,
    effects: [{ kind: 'entity.upsert', entity_id: 'unrelated', entity_type: 'object' }],
  }));

  const result = engine.rollbackEvent('causality-world', {
    root_event_id: 'root',
    idempotency_key: 'rollback-diamond',
  });
  const state = engine.getState('causality-world');
  const events = new Map(engine.getEvents('causality-world', true).map((event) => [event.event_id, event]));

  assert.deepEqual(new Set(result.invalidated_event_ids), new Set(['root', 'left-branch', 'right-branch', 'join']));
  assert.equal(events.get('root').validity, 'retracted');
  assert.equal(events.get('left-branch').validity, 'invalidated');
  assert.equal(events.get('right-branch').validity, 'invalidated');
  assert.equal(events.get('join').validity, 'invalidated');
  assert.equal(events.get('independent-branch').validity, 'valid');
  assert.equal(state.entities.some((entity) => entity.entity_id === 'witness'), false);
  assert.equal(state.entities.some((entity) => entity.entity_id === 'unrelated'), true);
  assert.equal(state.facts.length, 0);
  assert.equal(state.world_revision, 6);
  assert.equal(state.game_time, '2005-12-29T10:00:00.000Z');
});

test('rolling back one of two independent identical fact claims preserves the remaining source', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  engine.commitEvent('causality-world', command({
    event_id: 'source-a',
    idempotency_key: 'source-a',
    effects: [{ kind: 'fact.set', fact_id: 'door-state', predicate: 'open', value: true }],
  }));
  engine.commitEvent('causality-world', command({
    event_id: 'source-b',
    idempotency_key: 'source-b',
    turn_id: 'source-b',
    expected_revision: 1,
    effects: [{ kind: 'fact.set', fact_id: 'door-state', predicate: 'open', value: true }],
  }));

  engine.rollbackEvent('causality-world', { root_event_id: 'source-a', idempotency_key: 'rollback-source-a' });
  const fact = engine.getState('causality-world').facts.find((item) => item.fact_id === 'door-state');

  assert.equal(fact.status, 'active');
  assert.equal(fact.value, true);
  assert.deepEqual(fact.source_event_ids, ['source-b']);
});

test('entity dependency references cannot cross world boundaries', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  engine.createWorld({
    world_id: 'other-world',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    game_time: '2005-12-29T10:00:00Z',
  });
  engine.commitEvent('other-world', command({
    event_id: 'foreign-entity-creator',
    idempotency_key: 'foreign-entity-creator',
    effects: [{ kind: 'entity.upsert', entity_id: 'only-foreign', entity_type: 'object' }],
  }));

  assert.throws(
    () => engine.commitEvent('causality-world', command({
      idempotency_key: 'cross-world-dependency',
      depends_on: ['entity:only-foreign'],
    })),
    (error) => error.code === 'INVALID_DEPENDENCY_REFERENCE' && error.status === 400,
  );
});


test('rolling back one of two conflicting fact claims restores the remaining source', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  engine.commitEvent('causality-world', command({
    event_id: 'claim-open',
    idempotency_key: 'claim-open',
    effects: [{ kind: 'fact.set', fact_id: 'door-state', predicate: 'open', value: true }],
  }));
  engine.commitEvent('causality-world', command({
    event_id: 'claim-closed',
    idempotency_key: 'claim-closed',
    turn_id: 'claim-closed',
    expected_revision: 1,
    effects: [{ kind: 'fact.set', fact_id: 'door-state', predicate: 'open', value: false }],
  }));

  const conflicted = engine.getState('causality-world').facts.find((item) => item.fact_id === 'door-state');
  assert.equal(conflicted.status, 'conflicted');
  assert.deepEqual(new Set(conflicted.source_event_ids), new Set(['claim-open', 'claim-closed']));

  engine.rollbackEvent('causality-world', {
    root_event_id: 'claim-closed',
    idempotency_key: 'rollback-claim-closed',
  });

  const restored = engine.getState('causality-world').facts.find((item) => item.fact_id === 'door-state');
  assert.equal(restored.status, 'active');
  assert.equal(restored.value, true);
  assert.deepEqual(restored.source_event_ids, ['claim-open']);
});
