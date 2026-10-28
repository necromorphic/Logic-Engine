import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    causal_links: [],
    ...overrides,
  };
}


test('entity.create is explicit and entity.update applies an attribute patch with removal semantics', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  engine.commitEvent('causality-world', command({
    event_id: 'explicit-create', idempotency_key: 'explicit-create',
    effects: [{ kind: 'entity.create', entity_id: 'guard', entity_type: 'character', attributes: { name: 'A', role: 'guard' } }],
  }));
  engine.commitEvent('causality-world', command({
    event_id: 'explicit-update', idempotency_key: 'explicit-update', turn_id: 'explicit-update', expected_revision: 1,
    causal_links: [{ relation: 'REQUIRES', predicate: { kind: 'entity_exists', entity_id: 'guard' } }],
    effects: [{ kind: 'entity.update', entity_id: 'guard', attributes: { role: 'captain', active: true }, remove_attributes: ['name'] }],
  }));

  const entity = engine.getState('causality-world').entities.find((item) => item.entity_id === 'guard');
  assert.deepEqual(entity.attributes, { role: 'captain', active: true });
  assert.equal(entity.status, 'active');
});

test('entity.update requires an explicit existence precondition and does not consume idempotency key on rejection', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());
  engine.commitEvent('causality-world', command({
    event_id: 'create-guard-for-update', idempotency_key: 'create-guard-for-update',
    effects: [{ kind: 'entity.create', entity_id: 'guard', entity_type: 'character' }],
  }));
  assert.throws(() => engine.commitEvent('causality-world', command({
    idempotency_key: 'missing-update-precondition', turn_id: 'bad-update', expected_revision: 1,
    effects: [{ kind: 'entity.update', entity_id: 'guard', attributes: { role: 'captain' } }],
  })), (error) => error.code === 'ENTITY_UPDATE_PRECONDITION_REQUIRED' && error.status === 400);
  const accepted = engine.commitEvent('causality-world', command({
    event_id: 'good-update', idempotency_key: 'missing-update-precondition', turn_id: 'good-update', expected_revision: 1,
    causal_links: [{ relation: 'REQUIRES', predicate: { kind: 'entity_exists', entity_id: 'guard' } }],
    effects: [{ kind: 'entity.update', entity_id: 'guard', attributes: { role: 'captain' } }],
  }));
  assert.equal(accepted.accepted, true);
});

test('rollback of an entity creator invalidates a later explicit update that requires the entity', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());
  engine.commitEvent('causality-world', command({
    event_id: 'creator', idempotency_key: 'creator',
    effects: [{ kind: 'entity.create', entity_id: 'guard', entity_type: 'character', attributes: { role: 'guard' } }],
  }));
  engine.commitEvent('causality-world', command({
    event_id: 'updater', idempotency_key: 'updater', turn_id: 'updater', expected_revision: 1,
    causal_links: [{ relation: 'REQUIRES', predicate: { kind: 'entity_exists', entity_id: 'guard' } }],
    effects: [{ kind: 'entity.update', entity_id: 'guard', attributes: { role: 'captain' } }],
  }));
  const rollback = engine.rollbackEvent('causality-world', { root_event_id: 'creator', idempotency_key: 'rollback-creator' });
  const state = engine.getState('causality-world');
  const events = new Map(engine.getEvents('causality-world', true).map((event) => [event.event_id, event]));
  assert.deepEqual(new Set(rollback.invalidated_event_ids), new Set(['creator', 'updater']));
  assert.equal(events.get('updater').validity, 'invalidated');
  assert.equal(state.entities.some((item) => item.entity_id === 'guard'), false);
});


test('duplicate entity.create is atomic and a corrected retry can reuse the idempotency key', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());
  engine.commitEvent('causality-world', command({
    event_id: 'initial-entity-create', idempotency_key: 'initial-entity-create',
    effects: [{ kind: 'entity.create', entity_id: 'guard', entity_type: 'character', attributes: { role: 'guard' } }],
  }));

  assert.throws(() => engine.commitEvent('causality-world', command({
    idempotency_key: 'duplicate-create-key', turn_id: 'duplicate-create', expected_revision: 1,
    effects: [{ kind: 'entity.create', entity_id: 'guard', entity_type: 'character', attributes: { role: 'impostor' } }],
  })), (error) => error.code === 'ENTITY_ALREADY_EXISTS' && error.status === 409);

  const afterRejection = engine.getState('causality-world');
  assert.equal(afterRejection.world_revision, 1);
  assert.deepEqual(afterRejection.entities[0].attributes, { role: 'guard' });
  assert.equal(engine.getEvents('causality-world', true).length, 1);

  const corrected = engine.commitEvent('causality-world', command({
    event_id: 'corrected-entity-create', idempotency_key: 'duplicate-create-key',
    turn_id: 'corrected-create', expected_revision: 1,
    effects: [{ kind: 'entity.create', entity_id: 'witness', entity_type: 'character' }],
  }));
  assert.equal(corrected.accepted, true);
  assert.equal(engine.getState('causality-world').world_revision, 2);
  assert.equal(engine.getState('causality-world').entities.length, 2);
});

test('rolling back entity.update restores the exact prior canonical attributes', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());
  engine.commitEvent('causality-world', command({
    event_id: 'entity-before-update', idempotency_key: 'entity-before-update',
    effects: [{ kind: 'entity.create', entity_id: 'guard', entity_type: 'character', attributes: { role: 'guard', district: 'west' } }],
  }));
  engine.commitEvent('causality-world', command({
    event_id: 'entity-update-to-rollback', idempotency_key: 'entity-update-to-rollback',
    turn_id: 'entity-update-to-rollback', expected_revision: 1,
    causal_links: [{ relation: 'REQUIRES', predicate: { kind: 'entity_exists', entity_id: 'guard' } }],
    effects: [{ kind: 'entity.update', entity_id: 'guard', attributes: { role: 'captain', badge: true }, remove_attributes: ['district'] }],
  }));

  const rollback = engine.rollbackEvent('causality-world', {
    root_event_id: 'entity-update-to-rollback', idempotency_key: 'rollback-entity-update',
  });
  const entity = engine.getState('causality-world').entities.find((item) => item.entity_id === 'guard');
  assert.deepEqual(new Set(rollback.invalidated_event_ids), new Set(['entity-update-to-rollback']));
  assert.deepEqual(entity.attributes, { role: 'guard', district: 'west' });
  assert.equal(entity.created_by_event_id, 'entity-before-update');
  assert.equal(engine.getState('causality-world').world_revision, 3);
});

test('rolling back a later entity change preserves an earlier event that read the entity', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  engine.commitEvent('causality-world', command({
    event_id: 'witness-created-before-observation',
    idempotency_key: 'witness-created-before-observation',
    effects: [{ kind: 'entity.upsert', entity_id: 'witness', entity_type: 'character', attributes: { present: true } }],
  }));
  engine.commitEvent('causality-world',
    command({
      event_id: 'observation-before-change',
      idempotency_key: 'observation-before-change',
      turn_id: 'observation-before-change',
      expected_revision: 1,
      read_set: ['entity:witness'],
      depends_on: ['entity:witness'],
      causal_links: [{ relation: 'READS_ENTITY', target_id: 'witness' }],
      effects: [{ kind: 'fact.set', fact_id: 'witness-observed', predicate: 'observed', value: true }],
    }));
  engine.commitEvent('causality-world', command({
    event_id: 'later-witness-change',
    idempotency_key: 'later-witness-change',
    turn_id: 'later-witness-change',
    expected_revision: 2,
    effects: [{ kind: 'entity.upsert', entity_id: 'witness', entity_type: 'character', attributes: { present: false } }],
  }));

  const rollback = engine.rollbackEvent('causality-world', {
    root_event_id: 'later-witness-change',
    idempotency_key: 'rollback-later-witness-change',
  });
  const events = new Map(engine.getEvents('causality-world', true).map((event) => [event.event_id, event]));
  const state = engine.getState('causality-world');

  assert.deepEqual(rollback.invalidated_event_ids, ['later-witness-change']);
  assert.equal(events.get('observation-before-change').validity, 'valid');
  assert.equal(state.facts.some((fact) => fact.fact_id === 'witness-observed' && fact.value === true), true);
  assert.equal(state.entities.find((entity) => entity.entity_id === 'witness').attributes.present, true);
});

test('READS_ENTITY reader survives rollback when a later valid write preserves the same projection', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  engine.commitEvent('causality-world', command({
    event_id: 'initial-witness',
    idempotency_key: 'initial-witness',
    effects: [{ kind: 'entity.upsert', entity_id: 'witness', entity_type: 'person', status: 'active', attributes: { role: 'guard' } }],
  }));
  engine.commitEvent('causality-world', command({
    event_id: 'independent-witness-restatement',
    idempotency_key: 'independent-witness-restatement',
    turn_id: 'independent-witness-restatement',
    expected_revision: 1,
    effects: [{ kind: 'entity.upsert', entity_id: 'witness', entity_type: 'person', status: 'active', attributes: { role: 'guard' } }],
  }));
  engine.commitEvent('causality-world', command({
    event_id: 'reader-of-preserved-witness',
    idempotency_key: 'reader-of-preserved-witness',
    turn_id: 'reader-of-preserved-witness',
    expected_revision: 2,
    read_set: ['entity:witness'],
    depends_on: ['entity:witness'],
    causal_links: [{ relation: 'READS_ENTITY', target_id: 'witness' }],
    effects: [{ kind: 'fact.set', fact_id: 'witness-report', predicate: 'exists', value: true }],
  }));

  const rollback = engine.rollbackEvent('causality-world', {
    root_event_id: 'initial-witness',
    idempotency_key: 'rollback-initial-witness',
  });
  const events = new Map(engine.getEvents('causality-world', true).map((event) => [event.event_id, event]));
  const witness = engine.getState('causality-world').entities.find((item) => item.entity_id === 'witness');

  assert.deepEqual(rollback.invalidated_event_ids, ['initial-witness']);
  assert.equal(events.get('reader-of-preserved-witness').validity, 'valid');
  assert.deepEqual({
    entity_id: witness.entity_id,
    entity_type: witness.entity_type,
    status: witness.status,
    attributes: witness.attributes,
  }, {
    entity_id: 'witness',
    entity_type: 'person',
    status: 'active',
    attributes: { role: 'guard' },
  });
});


test('rollback of a causal chain preserves a reader when an independent branch restores the same projection', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  engine.commitEvent('causality-world', command({
    event_id: 'chain-root-entity',
    idempotency_key: 'chain-root-entity',
    effects: [{ kind: 'entity.upsert', entity_id: 'witness', entity_type: 'person', status: 'active', attributes: { role: 'guard' } }],
  }));
  engine.commitEvent('causality-world', command({
    event_id: 'chain-dependent-write',
    idempotency_key: 'chain-dependent-write',
    turn_id: 'chain-dependent-write',
    expected_revision: 1,
    caused_by: ['chain-root-entity'],
    effects: [{ kind: 'entity.upsert', entity_id: 'witness', entity_type: 'person', status: 'active', attributes: { role: 'guard' } }],
  }));
  engine.commitEvent('causality-world', command({
    event_id: 'independent-restoring-write',
    idempotency_key: 'independent-restoring-write',
    turn_id: 'independent-restoring-write',
    expected_revision: 2,
    effects: [{ kind: 'entity.upsert', entity_id: 'witness', entity_type: 'person', status: 'active', attributes: { role: 'guard' } }],
  }));
  engine.commitEvent('causality-world', command({
    event_id: 'reader-after-causal-chain',
    idempotency_key: 'reader-after-causal-chain',
    turn_id: 'reader-after-causal-chain',
    expected_revision: 3,
    read_set: ['entity:witness'],
    depends_on: ['entity:witness'],
    causal_links: [{ relation: 'READS_ENTITY', target_id: 'witness' }],
    effects: [{ kind: 'fact.set', fact_id: 'witness-report', predicate: 'exists', value: true }],
  }));

  const rollback = engine.rollbackEvent('causality-world', {
    root_event_id: 'chain-root-entity',
    idempotency_key: 'rollback-causal-chain',
  });
  const events = new Map(engine.getEvents('causality-world', true).map((event) => [event.event_id, event]));

  assert.deepEqual(new Set(rollback.invalidated_event_ids), new Set(['chain-root-entity', 'chain-dependent-write']));
  assert.equal(events.get('independent-restoring-write').validity, 'valid');
  assert.equal(events.get('reader-after-causal-chain').validity, 'valid');
  assert.equal(engine.getState('causality-world').entities.find((item) => item.entity_id === 'witness').attributes.role, 'guard');
});


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


test('typed READS_SOURCE link invalidates its dependent event when the source is rolled back', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  engine.commitEvent('causality-world', command({
    event_id: 'typed-source',
    idempotency_key: 'typed-source',
    effects: [{ kind: 'entity.upsert', entity_id: 'witness', entity_type: 'character' }],
  }));
  engine.commitEvent('causality-world', command({
    event_id: 'typed-reader',
    idempotency_key: 'typed-reader',
    turn_id: 'typed-reader',
    expected_revision: 1,
    causal_links: [{ relation: 'READS_SOURCE', target_id: 'typed-source' }],
    effects: [{ kind: 'fact.set', fact_id: 'witness-clue', predicate: 'observed', value: true }],
  }));

  const rollback = engine.rollbackEvent('causality-world', {
    root_event_id: 'typed-source',
    idempotency_key: 'rollback-typed-source',
  });
  const events = new Map(engine.getEvents('causality-world', true).map((event) => [event.event_id, event]));

  assert.deepEqual(new Set(rollback.invalidated_event_ids), new Set(['typed-source', 'typed-reader']));
  assert.equal(events.get('typed-source').validity, 'retracted');
  assert.equal(events.get('typed-reader').validity, 'invalidated');
  assert.equal(events.get('typed-reader').causal_links[0].relation, 'READS_SOURCE');
});

test('typed READS_CLAIM link invalidates a reader when the claim loses its only source', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  engine.commitEvent('causality-world', command({
    event_id: 'claim-source',
    idempotency_key: 'claim-source',
    effects: [{ kind: 'fact.set', fact_id: 'door-state', predicate: 'open', value: true }],
  }));
  engine.commitEvent('causality-world', command({
    event_id: 'claim-reader',
    idempotency_key: 'claim-reader',
    turn_id: 'claim-reader',
    expected_revision: 1,
    causal_links: [{ relation: 'READS_CLAIM', target_id: 'door-state' }],
    effects: [{ kind: 'fact.set', fact_id: 'derived-door-report', predicate: 'reported', value: true }],
  }));

  const rollback = engine.rollbackEvent('causality-world', {
    root_event_id: 'claim-source',
    idempotency_key: 'rollback-claim-source',
  });
  const state = engine.getState('causality-world');
  const events = new Map(engine.getEvents('causality-world', true).map((event) => [event.event_id, event]));

  assert.deepEqual(new Set(rollback.invalidated_event_ids), new Set(['claim-source', 'claim-reader']));
  assert.equal(events.get('claim-reader').validity, 'invalidated');
  assert.equal(state.facts.some((fact) => fact.fact_id === 'derived-door-report'), false);
});


test('unknown event and causal-predicate fields fail closed instead of being silently ignored', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());
  assert.throws(
    () => engine.commitEvent('causality-world', command({ observed_version: 3 })),
    (error) => error.code === 'UNSUPPORTED_EVENT_FIELD' && error.status === 400,
  );
  assert.throws(
    () => engine.commitEvent('causality-world', command({
      causal_links: [{ relation: 'REQUIRES', predicate: { kind: 'entity_exists', entity_id: 'guard', version: 3 } }],
    })),
    (error) => error.code === 'INVALID_CAUSAL_PREDICATE' && error.status === 400,
  );
  assert.equal(engine.getState('causality-world').world_revision, 0);
  assert.equal(engine.getEvents('causality-world', true).length, 0);
});

test('unsupported typed causal relationships are rejected before consuming the idempotency key', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  assert.throws(
    () => engine.commitEvent('causality-world', command({
      idempotency_key: 'retry-after-rejection',
      causal_links: [{ relation: 'MAINTAINS', target_id: 'door-state' }],
    })),
    (error) => error.code === 'UNSUPPORTED_CAUSAL_RELATION' && error.status === 400,
  );

  const accepted = engine.commitEvent('causality-world', command({
    idempotency_key: 'retry-after-rejection',
    event_id: 'corrected-event',
    causal_links: [],
  }));
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.event_id, 'corrected-event');
  assert.equal(engine.getState('causality-world').world_revision, 1);
});


test('typed READS_CLAIM reader survives rollback while another valid source still supports the claim', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  engine.commitEvent('causality-world', command({
    event_id: 'claim-source-a',
    idempotency_key: 'claim-source-a',
    effects: [{ kind: 'fact.set', fact_id: 'door-state', predicate: 'open', value: true }],
  }));
  engine.commitEvent('causality-world', command({
    event_id: 'claim-source-b',
    idempotency_key: 'claim-source-b',
    turn_id: 'claim-source-b',
    expected_revision: 1,
    effects: [{ kind: 'fact.set', fact_id: 'door-state', predicate: 'open', value: true }],
  }));
  engine.commitEvent('causality-world', command({
    event_id: 'claim-reader-independent-support',
    idempotency_key: 'claim-reader-independent-support',
    turn_id: 'claim-reader-independent-support',
    expected_revision: 2,
    causal_links: [{ relation: 'READS_CLAIM', target_id: 'door-state' }],
    effects: [{ kind: 'fact.set', fact_id: 'door-report', predicate: 'reported', value: true }],
  }));

  const rollback = engine.rollbackEvent('causality-world', {
    root_event_id: 'claim-source-a',
    idempotency_key: 'rollback-one-claim-source',
  });
  const events = new Map(engine.getEvents('causality-world', true).map((event) => [event.event_id, event]));
  const fact = engine.getState('causality-world').facts.find((item) => item.fact_id === 'door-state');

  assert.equal(events.get('claim-reader-independent-support').validity, 'valid');
  assert.deepEqual(new Set(rollback.invalidated_event_ids), new Set(['claim-source-a']));
  assert.deepEqual(fact.source_event_ids, ['claim-source-b']);
  assert.equal(fact.status, 'active');
});


test('READS_CLAIM reader is invalidated when rollback changes a conflict into a single claim', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  engine.commitEvent('causality-world', command({
    event_id: 'claim-open',
    idempotency_key: 'claim-open',
    effects: [{ kind: 'fact.set', fact_id: 'door-state', predicate: 'state', value: 'open' }],
  }));
  engine.commitEvent('causality-world', command({
    event_id: 'claim-closed',
    idempotency_key: 'claim-closed',
    turn_id: 'claim-closed',
    expected_revision: 1,
    effects: [{ kind: 'fact.set', fact_id: 'door-state', predicate: 'state', value: 'closed' }],
  }));
  engine.commitEvent('causality-world', command({
    event_id: 'reader-observes-conflict',
    idempotency_key: 'reader-observes-conflict',
    turn_id: 'reader-observes-conflict',
    expected_revision: 2,
    causal_links: [{ relation: 'READS_CLAIM', target_id: 'door-state' }],
    effects: [{ kind: 'fact.set', fact_id: 'report', predicate: 'recorded', value: true }],
  }));

  const rollback = engine.rollbackEvent('causality-world', {
    root_event_id: 'claim-closed',
    idempotency_key: 'rollback-conflicting-claim',
  });
  const events = new Map(engine.getEvents('causality-world', true).map((event) => [event.event_id, event]));
  const fact = engine.getState('causality-world').facts.find((item) => item.fact_id === 'door-state');

  assert.deepEqual(new Set(rollback.invalidated_event_ids), new Set(['claim-closed', 'reader-observes-conflict']));
  assert.equal(events.get('reader-observes-conflict').validity, 'invalidated');
  assert.equal(fact.status, 'active');
  assert.equal(fact.value, 'open');
});


test('commit_sequence is per-world, stable across rollback, and distinct from world_revision', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  const first = engine.commitEvent('causality-world', command({
    event_id: 'sequence-first',
    idempotency_key: 'sequence-first',
  }));
  const second = engine.commitEvent('causality-world', command({
    event_id: 'sequence-second',
    idempotency_key: 'sequence-second',
    turn_id: 'sequence-second',
    expected_revision: 1,
  }));
  assert.equal(first.commit_sequence, 1);
  assert.equal(second.commit_sequence, 2);

  const rollback = engine.rollbackEvent('causality-world', {
    root_event_id: 'sequence-second',
    idempotency_key: 'rollback-sequence-second',
  });
  assert.equal(rollback.world_revision, 3);

  const third = engine.commitEvent('causality-world', command({
    event_id: 'sequence-third',
    idempotency_key: 'sequence-third',
    turn_id: 'sequence-third',
    expected_revision: 3,
  }));
  assert.equal(third.commit_sequence, 3);
  assert.equal(third.world_revision, 4);

  const events = engine.getEvents('causality-world', true);
  assert.deepEqual(events.map((event) => event.commit_sequence), [1, 2, 3]);
  assert.equal(events.find((event) => event.event_id === 'sequence-second').validity, 'retracted');
});

test('commit_sequence starts independently for each world', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  engine.createWorld({
    world_id: 'sequence-other-world',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    game_time: '2005-12-29T10:00:00Z',
  });
  const a = engine.commitEvent('causality-world', command({
    event_id: 'sequence-world-a',
    idempotency_key: 'sequence-world-a',
  }));
  const b = engine.commitEvent('sequence-other-world', command({
    event_id: 'sequence-world-b',
    idempotency_key: 'sequence-world-b',
  }));

  assert.equal(a.commit_sequence, 1);
  assert.equal(b.commit_sequence, 1);
});

test('legacy event history is backfilled with stable commit_sequence values', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-engine-sequence-migration-'));
  const databasePath = join(directory, 'legacy.sqlite');
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE worlds(
      world_id TEXT PRIMARY KEY, world_pack_id TEXT NOT NULL, world_pack_version TEXT NOT NULL,
      initial_game_time TEXT NOT NULL, game_time TEXT NOT NULL, world_revision INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL
    );
    CREATE TABLE world_events(
      event_id TEXT PRIMARY KEY, world_id TEXT NOT NULL, turn_id TEXT NOT NULL,
      generation_id TEXT, event_type TEXT NOT NULL, game_time TEXT NOT NULL, committed_revision INTEGER NOT NULL,
      validity TEXT NOT NULL CHECK(validity IN ('valid','retracted','invalidated')),
      caused_by_json TEXT NOT NULL, depends_on_json TEXT NOT NULL, read_set_json TEXT NOT NULL,
      effects_json TEXT NOT NULL, time_advance_seconds INTEGER NOT NULL DEFAULT 0, source_message_id TEXT,
      created_at TEXT NOT NULL, rollback_id TEXT
    );
    INSERT INTO worlds(world_id,world_pack_id,world_pack_version,initial_game_time,game_time,world_revision,created_at)
      VALUES('legacy-world','test.world','1.0.0','2005-12-29T10:00:00.000Z','2005-12-29T10:00:00.000Z',2,'2005-12-29T10:00:00.000Z');
    INSERT INTO world_events(event_id,world_id,turn_id,event_type,game_time,committed_revision,validity,caused_by_json,depends_on_json,read_set_json,effects_json,created_at)
      VALUES('legacy-event-a','legacy-world','legacy-turn-a','action.completed','2005-12-29T10:00:00.000Z',1,'valid','[]','[]','[]','[]','2005-12-29T10:00:00.000Z');
    INSERT INTO world_events(event_id,world_id,turn_id,event_type,game_time,committed_revision,validity,caused_by_json,depends_on_json,read_set_json,effects_json,created_at)
      VALUES('legacy-event-b','legacy-world','legacy-turn-b','action.completed','2005-12-29T10:00:00.000Z',2,'valid','[]','[]','[]','[]','2005-12-29T10:00:00.000Z');
  `);
  legacy.close();

  const store = new SQLiteStore(databasePath);
  const engine = new LogicEngine(store);
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });

  assert.deepEqual(engine.getEvents('legacy-world', true).map((event) => event.commit_sequence), [1, 2]);
  const next = engine.commitEvent('legacy-world', command({
    event_id: 'legacy-event-c',
    idempotency_key: 'legacy-event-c',
    turn_id: 'legacy-turn-c',
    expected_revision: 2,
  }));
  assert.equal(next.commit_sequence, 3);
});


test('REQUIRES predicate is checked before commit and rejected input can retry with the same key', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  assert.throws(
    () => engine.commitEvent('causality-world', command({
      idempotency_key: 'requires-retry',
      causal_links: [{ relation: 'REQUIRES', predicate: { kind: 'entity_exists', entity_id: 'guard' } }],
    })),
    (error) => error.code === 'REQUIRED_PREDICATE_NOT_SATISFIED' && error.status === 409,
  );

  engine.commitEvent('causality-world', command({
    event_id: 'create-guard',
    idempotency_key: 'create-guard',
    effects: [{ kind: 'entity.upsert', entity_id: 'guard', entity_type: 'object' }],
  }));
  const accepted = engine.commitEvent('causality-world', command({
    event_id: 'requires-guard',
    idempotency_key: 'requires-retry',
    turn_id: 'requires-guard',
    expected_revision: 1,
    causal_links: [{ relation: 'REQUIRES', predicate: { kind: 'entity_exists', entity_id: 'guard' } }],
  }));

  assert.equal(accepted.accepted, true);
  assert.equal(accepted.commit_sequence, 2);
});

test('rollback invalidates an event when its REQUIRES predicate becomes false at its historical commit point', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  engine.commitEvent('causality-world', command({
    event_id: 'create-ready-actor',
    idempotency_key: 'create-ready-actor',
    effects: [{ kind: 'entity.upsert', entity_id: 'actor', entity_type: 'character', attributes: { stage: 'ready' } }],
  }));
  engine.commitEvent('causality-world', command({
    event_id: 'action-requiring-ready-actor',
    idempotency_key: 'action-requiring-ready-actor',
    turn_id: 'action-requiring-ready-actor',
    expected_revision: 1,
    causal_links: [{
      relation: 'REQUIRES',
      predicate: { kind: 'entity_attribute', entity_id: 'actor', attribute: 'stage', value: 'ready' },
    }],
    effects: [{ kind: 'fact.set', fact_id: 'action-result', predicate: 'completed', value: true }],
  }));

  const rollback = engine.rollbackEvent('causality-world', {
    root_event_id: 'create-ready-actor',
    idempotency_key: 'rollback-ready-actor',
  });
  const events = new Map(engine.getEvents('causality-world', true).map((event) => [event.event_id, event]));
  const state = engine.getState('causality-world');

  assert.deepEqual(new Set(rollback.invalidated_event_ids), new Set(['create-ready-actor', 'action-requiring-ready-actor']));
  assert.equal(events.get('action-requiring-ready-actor').validity, 'invalidated');
  assert.equal(state.facts.some((fact) => fact.fact_id === 'action-result'), false);
});

test('REQUIRES survives rollback when an independent event still satisfies the historical predicate', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  engine.commitEvent('causality-world', command({
    event_id: 'actor-source-to-rollback',
    idempotency_key: 'actor-source-to-rollback',
    effects: [{ kind: 'entity.upsert', entity_id: 'actor', entity_type: 'character', attributes: { stage: 'ready' } }],
  }));
  engine.commitEvent('causality-world', command({
    event_id: 'independent-actor-source',
    idempotency_key: 'independent-actor-source',
    turn_id: 'independent-actor-source',
    expected_revision: 1,
    effects: [{ kind: 'entity.upsert', entity_id: 'actor', entity_type: 'character', attributes: { stage: 'ready' } }],
  }));
  engine.commitEvent('causality-world', command({
    event_id: 'action-with-independent-precondition-support',
    idempotency_key: 'action-with-independent-precondition-support',
    turn_id: 'action-with-independent-precondition-support',
    expected_revision: 2,
    causal_links: [{
      relation: 'REQUIRES',
      predicate: { kind: 'entity_attribute', entity_id: 'actor', attribute: 'stage', value: 'ready' },
    }],
    effects: [{ kind: 'fact.set', fact_id: 'action-result', predicate: 'completed', value: true }],
  }));

  const rollback = engine.rollbackEvent('causality-world', {
    root_event_id: 'actor-source-to-rollback',
    idempotency_key: 'rollback-one-actor-source',
  });
  const events = new Map(engine.getEvents('causality-world', true).map((event) => [event.event_id, event]));
  const state = engine.getState('causality-world');

  assert.deepEqual(rollback.invalidated_event_ids, ['actor-source-to-rollback']);
  assert.equal(events.get('independent-actor-source').validity, 'valid');
  assert.equal(events.get('action-with-independent-precondition-support').validity, 'valid');
  assert.equal(state.entities.find((entity) => entity.entity_id === 'actor').attributes.stage, 'ready');
  assert.equal(state.facts.find((fact) => fact.fact_id === 'action-result').value, true);
});


test('rolling back a later state change does not invalidate an earlier satisfied REQUIRES predicate', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  engine.commitEvent('causality-world', command({
    event_id: 'actor-ready',
    idempotency_key: 'actor-ready',
    effects: [{ kind: 'entity.upsert', entity_id: 'actor', entity_type: 'character', attributes: { stage: 'ready' } }],
  }));
  engine.commitEvent('causality-world', command({
      event_id: 'action-when-ready',
      idempotency_key: 'action-when-ready',
      turn_id: 'action-when-ready',
      expected_revision: 1,
      causal_links: [{
        relation: 'REQUIRES',
        predicate: { kind: 'entity_attribute', entity_id: 'actor', attribute: 'stage', value: 'ready' },
      }],
      effects: [{ kind: 'fact.set', fact_id: 'action-result', predicate: 'completed', value: true }],
    }));
  engine.commitEvent('causality-world', command({
    event_id: 'actor-became-busy',
    idempotency_key: 'actor-became-busy',
    turn_id: 'actor-became-busy',
    expected_revision: 2,
    effects: [{ kind: 'entity.upsert', entity_id: 'actor', entity_type: 'character', attributes: { stage: 'busy' } }],
  }));

  const rollback = engine.rollbackEvent('causality-world', {
    root_event_id: 'actor-became-busy',
    idempotency_key: 'rollback-later-state-change',
  });
  const events = new Map(engine.getEvents('causality-world', true).map((event) => [event.event_id, event]));

  assert.deepEqual(rollback.invalidated_event_ids, ['actor-became-busy']);
  assert.equal(events.get('action-when-ready').validity, 'valid');
  assert.equal(engine.getState('causality-world').facts.find((fact) => fact.fact_id === 'action-result').value, true);
  assert.equal(engine.getState('causality-world').entities.find((entity) => entity.entity_id === 'actor').attributes.stage, 'ready');
});


test('fact_value REQUIRES rejects unknown conflicted claims without consuming the idempotency key', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  engine.commitEvent('causality-world', command({
    event_id: 'fact-claim-red',
    idempotency_key: 'fact-claim-red',
    effects: [{ kind: 'fact.set', fact_id: 'signal', predicate: 'color', value: 'red' }],
  }));
  engine.commitEvent('causality-world', command({
    event_id: 'fact-claim-blue',
    idempotency_key: 'fact-claim-blue',
    turn_id: 'fact-claim-blue',
    expected_revision: 1,
    effects: [{ kind: 'fact.set', fact_id: 'signal', predicate: 'color', value: 'blue' }],
  }));

  assert.throws(
    () => engine.commitEvent('causality-world', command({
      idempotency_key: 'requires-signal',
      turn_id: 'requires-signal',
      expected_revision: 2,
      causal_links: [{ relation: 'REQUIRES', predicate: { kind: 'fact_value', fact_id: 'signal', value: 'red' } }],
    })),
    (error) => error.code === 'REQUIRED_PREDICATE_UNKNOWN' && error.status === 409,
  );

  engine.rollbackEvent('causality-world', { root_event_id: 'fact-claim-blue', idempotency_key: 'rollback-blue-claim' });
  const accepted = engine.commitEvent('causality-world', command({
    event_id: 'requires-red-signal',
    idempotency_key: 'requires-signal',
    turn_id: 'requires-red-signal',
    expected_revision: 3,
    causal_links: [{ relation: 'REQUIRES', predicate: { kind: 'fact_value', fact_id: 'signal', value: 'red' } }],
  }));

  assert.equal(accepted.accepted, true);
  assert.equal(accepted.commit_sequence, 3);
});

test('fact_value REQUIRES is evaluated against the requiring event historical cursor during rollback', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  engine.commitEvent('causality-world', command({
    event_id: 'signal-source-one',
    idempotency_key: 'signal-source-one',
    effects: [{ kind: 'fact.set', fact_id: 'signal', predicate: 'state', value: 'ready' }],
  }));
  engine.commitEvent('causality-world', command({
    event_id: 'signal-source-two',
    idempotency_key: 'signal-source-two',
    turn_id: 'signal-source-two',
    expected_revision: 1,
    effects: [{ kind: 'fact.set', fact_id: 'signal', predicate: 'state', value: 'ready' }],
  }));
  engine.commitEvent('causality-world', command({
    event_id: 'action-requiring-ready-signal',
    idempotency_key: 'action-requiring-ready-signal',
    turn_id: 'action-requiring-ready-signal',
    expected_revision: 2,
    causal_links: [{ relation: 'REQUIRES', predicate: { kind: 'fact_value', fact_id: 'signal', value: 'ready' } }],
    effects: [{ kind: 'fact.set', fact_id: 'action-result', predicate: 'completed', value: true }],
  }));

  const rollback = engine.rollbackEvent('causality-world', {
    root_event_id: 'signal-source-one',
    idempotency_key: 'rollback-one-signal-source',
  });
  const events = new Map(engine.getEvents('causality-world', true).map((event) => [event.event_id, event]));

  assert.deepEqual(rollback.invalidated_event_ids, ['signal-source-one']);
  assert.deepEqual(rollback.requires_review_event_ids, []);
  assert.equal(events.get('signal-source-two').validity, 'valid');
  assert.equal(events.get('action-requiring-ready-signal').validity, 'valid');
  assert.equal(engine.getState('causality-world').facts.find((fact) => fact.fact_id === 'action-result').value, true);
});

test('fact_value REQUIRES is invalidated when rollback removes its only historical support', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  engine.commitEvent('causality-world', command({
    event_id: 'only-signal-source',
    idempotency_key: 'only-signal-source',
    effects: [{ kind: 'fact.set', fact_id: 'signal', predicate: 'state', value: 'ready' }],
  }));
  engine.commitEvent('causality-world', command({
    event_id: 'action-requiring-only-signal',
    idempotency_key: 'action-requiring-only-signal',
    turn_id: 'action-requiring-only-signal',
    expected_revision: 1,
    causal_links: [{ relation: 'REQUIRES', predicate: { kind: 'fact_value', fact_id: 'signal', value: 'ready' } }],
    effects: [{ kind: 'fact.set', fact_id: 'action-result', predicate: 'completed', value: true }],
  }));

  const rollback = engine.rollbackEvent('causality-world', {
    root_event_id: 'only-signal-source',
    idempotency_key: 'rollback-only-signal-source',
  });
  const events = new Map(engine.getEvents('causality-world', true).map((event) => [event.event_id, event]));

  assert.deepEqual(new Set(rollback.invalidated_event_ids), new Set(['only-signal-source', 'action-requiring-only-signal']));
  assert.equal(rollback.requires_review_event_ids.length, 0);
  assert.equal(events.get('action-requiring-only-signal').validity, 'invalidated');
  assert.equal(engine.getState('causality-world').facts.some((fact) => fact.fact_id === 'action-result'), false);
});


test('generation-bound context manifest rejects undeclared reads before consuming idempotency key', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  engine.commitEvent('causality-world', command({
    event_id: 'manifest-seed',
    idempotency_key: 'manifest-seed',
    effects: [
      { kind: 'entity.upsert', entity_id: 'visible-entity', entity_type: 'object' },
      { kind: 'entity.upsert', entity_id: 'hidden-entity', entity_type: 'object' },
    ],
  }));
  const manifest = engine.registerContextManifest('causality-world', {
    generation_id: 'generation-manifest-1',
    base_commit_sequence: 1,
    base_world_revision: 1,
    items: [{ kind: 'entity', target_id: 'visible-entity' }],
  });
  assert.equal(manifest.idempotent_replay, false);
  assert.equal(engine.registerContextManifest('causality-world', {
    generation_id: 'generation-manifest-1',
    base_commit_sequence: 1,
    base_world_revision: 1,
    items: [{ kind: 'entity', target_id: 'visible-entity' }],
  }).manifest_id, manifest.manifest_id);

  assert.throws(
    () => engine.commitEvent('causality-world', command({
      event_id: 'manifest-invalid-read',
      idempotency_key: 'manifest-read-key',
      turn_id: 'manifest-invalid-read',
      expected_revision: 1,
      generation_id: 'generation-manifest-1',
      context_manifest_id: manifest.manifest_id,
      read_set: ['entity:hidden-entity'],
    })),
    (error) => error.code === 'INVALID_DECLARED_READ' && error.status === 400,
  );

  const accepted = engine.commitEvent('causality-world', command({
    event_id: 'manifest-corrected-read',
    idempotency_key: 'manifest-read-key',
    turn_id: 'manifest-corrected-read',
    expected_revision: 1,
    generation_id: 'generation-manifest-1',
    context_manifest_id: manifest.manifest_id,
    read_set: ['entity:visible-entity'],
  }));
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.commit_sequence, 2);
  assert.equal(engine.getEvents('causality-world', true).find((event) => event.event_id === 'manifest-corrected-read').context_manifest_id, manifest.manifest_id);
});

test('context manifest is rejected when the world revision changes after snapshot registration', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  engine.commitEvent('causality-world', command({
    event_id: 'manifest-stale-seed',
    idempotency_key: 'manifest-stale-seed',
    effects: [{ kind: 'entity.upsert', entity_id: 'visible-entity', entity_type: 'object' }],
  }));
  const manifest = engine.registerContextManifest('causality-world', {
    generation_id: 'generation-stale',
    base_commit_sequence: 1,
    base_world_revision: 1,
    items: [{ kind: 'entity', target_id: 'visible-entity' }],
  });
  engine.commitEvent('causality-world', command({
    event_id: 'world-changed-after-context',
    idempotency_key: 'world-changed-after-context',
    turn_id: 'world-changed-after-context',
    expected_revision: 1,
    effects: [],
  }));

  assert.throws(
    () => engine.commitEvent('causality-world', command({
      event_id: 'stale-context-event',
      idempotency_key: 'stale-context-event',
      turn_id: 'stale-context-event',
      expected_revision: 2,
      generation_id: 'generation-stale',
      context_manifest_id: manifest.manifest_id,
    })),
    (error) => error.code === 'CONTEXT_SNAPSHOT_STALE' && error.status === 409,
  );
});

test('context manifest rejects a generation mismatch and a manifest from another world', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());
  engine.createWorld({
    world_id: 'other-manifest-world',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    game_time: '2005-12-29T10:00:00Z',
  });
  const manifest = engine.registerContextManifest('causality-world', {
    generation_id: 'generation-bound',
    base_commit_sequence: 0,
    base_world_revision: 0,
    items: [],
  });

  assert.throws(
    () => engine.commitEvent('causality-world', command({
      idempotency_key: 'wrong-generation',
      generation_id: 'another-generation',
      context_manifest_id: manifest.manifest_id,
    })),
    (error) => error.code === 'CONTEXT_GENERATION_MISMATCH' && error.status === 400,
  );
  assert.throws(
    () => engine.commitEvent('other-manifest-world', command({
      idempotency_key: 'cross-world-manifest',
      generation_id: 'generation-bound',
      context_manifest_id: manifest.manifest_id,
    })),
    (error) => error.code === 'CONTEXT_MANIFEST_NOT_FOUND' && error.status === 400,
  );
});


test('entity_absent REQUIRES is re-evaluated when rollback restores a previously present entity', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  engine.commitEvent('causality-world', command({
    event_id: 'absence-guard-created',
    idempotency_key: 'absence-guard-created',
    effects: [{ kind: 'entity.upsert', entity_id: 'guard', entity_type: 'character', status: 'active' }],
  }));
  engine.commitEvent('causality-world', command({
    event_id: 'absence-guard-destroyed',
    idempotency_key: 'absence-guard-destroyed',
    turn_id: 'absence-guard-destroyed',
    expected_revision: 1,
    effects: [{ kind: 'entity.delete', entity_id: 'guard' }],
  }));
  engine.commitEvent('causality-world', command({
    event_id: 'action-requiring-guard-absence',
    idempotency_key: 'action-requiring-guard-absence',
    turn_id: 'action-requiring-guard-absence',
    expected_revision: 2,
    causal_links: [{ relation: 'REQUIRES', predicate: { kind: 'entity_absent', entity_id: 'guard' } }],
    effects: [{ kind: 'fact.set', fact_id: 'action-result', predicate: 'completed', value: true }],
  }));

  const rollback = engine.rollbackEvent('causality-world', {
    root_event_id: 'absence-guard-destroyed',
    idempotency_key: 'rollback-guard-destruction',
  });
  const events = new Map(engine.getEvents('causality-world', true).map((event) => [event.event_id, event]));

  assert.deepEqual(new Set(rollback.invalidated_event_ids), new Set(['absence-guard-destroyed', 'action-requiring-guard-absence']));
  assert.equal(events.get('action-requiring-guard-absence').validity, 'invalidated');
  assert.equal(engine.getState('causality-world').entities.find((entity) => entity.entity_id === 'guard').status, 'active');
  assert.equal(engine.getState('causality-world').facts.some((fact) => fact.fact_id === 'action-result'), false);
});

test('fact_absent REQUIRES distinguishes absence from an existing or conflicted fact', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  const absentEvent = engine.commitEvent('causality-world', command({
    event_id: 'action-requiring-no-signal',
    idempotency_key: 'action-requiring-no-signal',
    causal_links: [{ relation: 'REQUIRES', predicate: { kind: 'fact_absent', fact_id: 'signal' } }],
    effects: [{ kind: 'fact.set', fact_id: 'absence-result', predicate: 'completed', value: true }],
  }));
  assert.equal(absentEvent.accepted, true);
  engine.commitEvent('causality-world', command({
    event_id: 'signal-now-exists',
    idempotency_key: 'signal-now-exists',
    turn_id: 'signal-now-exists',
    expected_revision: 1,
    effects: [{ kind: 'fact.set', fact_id: 'signal', predicate: 'state', value: 'present' }],
  }));

  assert.throws(
    () => engine.commitEvent('causality-world', command({
      event_id: 'action-requiring-absence-after-signal',
      idempotency_key: 'action-requiring-absence-after-signal',
      turn_id: 'action-requiring-absence-after-signal',
      expected_revision: 2,
      causal_links: [{ relation: 'REQUIRES', predicate: { kind: 'fact_absent', fact_id: 'signal' } }],
    })),
    (error) => error.code === 'REQUIRED_PREDICATE_NOT_SATISFIED' && error.status === 409,
  );
});

test('context manifests can explicitly represent an absent entity or fact', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  const manifest = engine.registerContextManifest('causality-world', {
    generation_id: 'absence-generation',
    base_commit_sequence: 0,
    base_world_revision: 0,
    items: [
      { kind: 'entity_absence', target_id: 'guard' },
      { kind: 'fact_absence', target_id: 'signal' },
    ],
  });
  const accepted = engine.commitEvent('causality-world', command({
    event_id: 'absence-manifest-action',
    idempotency_key: 'absence-manifest-action',
    generation_id: 'absence-generation',
    context_manifest_id: manifest.manifest_id,
    causal_links: [
      { relation: 'REQUIRES', predicate: { kind: 'entity_absent', entity_id: 'guard' } },
      { relation: 'REQUIRES', predicate: { kind: 'fact_absent', fact_id: 'signal' } },
    ],
  }));
  assert.equal(accepted.accepted, true);
});


test('rollback returns a structured review result and makes no semantic changes when an affected historical predicate is unknown', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  for (const [eventId, value, revision] of [
    ['conflict-root', true, 0],
    ['conflict-source-b', false, 1],
    ['conflict-source-c', 'uncertain', 2],
  ]) {
    engine.commitEvent('causality-world', command({
      event_id: eventId,
      idempotency_key: eventId,
      turn_id: eventId,
      expected_revision: revision,
      effects: [{ kind: 'fact.set', fact_id: 'contested-fact', predicate: 'state', value }],
    }));
  }
  engine.commitEvent('causality-world', command({
    event_id: 'legacy-requiring-event',
    idempotency_key: 'legacy-requiring-event',
    turn_id: 'legacy-requiring-event',
    expected_revision: 3,
    effects: [{ kind: 'fact.set', fact_id: 'legacy-output', predicate: 'created', value: true }],
  }));

  // Simulate a legacy/inconsistent record: a normal commit would reject this
  // REQUIRES predicate because contested-fact is already conflicted.
  store.db.prepare('UPDATE world_events SET causal_links_json=? WHERE event_id=?').run(
    JSON.stringify([{ relation: 'REQUIRES', predicate: { kind: 'fact_value', fact_id: 'contested-fact', value: true } }]),
    'legacy-requiring-event',
  );

  const before = engine.getState('causality-world');
  const auditCountBefore = store.db.prepare('SELECT COUNT(*) AS count FROM audit_entries WHERE world_id=?').get('causality-world').count;
  const first = engine.rollbackEvent('causality-world', {
    root_event_id: 'conflict-root',
    idempotency_key: 'review-contested-root',
  });
  const after = engine.getState('causality-world');

  assert.equal(first.rollback_outcome, 'requires_review');
  assert.equal(first.no_op, true);
  assert.equal(first.rollback_id, null);
  assert.deepEqual(first.invalidated_event_ids, []);
  assert.deepEqual(first.proposed_invalidated_event_ids, ['conflict-root']);
  assert.deepEqual(first.requires_review_event_ids, ['legacy-requiring-event']);
  assert.equal(first.requires_review_items[0].reason_code, 'historical_predicate_unknown');
  assert.deepEqual(first.requires_review_items[0].affected_dependencies, [
    { kind: 'projection', target_ref: 'fact:contested-fact' },
  ]);
  assert.equal(after.world_revision, before.world_revision);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM audit_entries WHERE world_id=?').get('causality-world').count, auditCountBefore);
  assert.equal(after.facts.find((fact) => fact.fact_id === 'contested-fact').status, 'conflicted');
  assert.equal(new Map(engine.getEvents('causality-world', true).map((event) => [event.event_id, event])).get('conflict-root').validity, 'valid');

  const replay = engine.rollbackEvent('causality-world', {
    root_event_id: 'conflict-root',
    idempotency_key: 'review-contested-root',
  });
  assert.equal(replay.idempotent_replay, true);
  assert.deepEqual(replay.requires_review_items, first.requires_review_items);
  assert.equal(engine.getState('causality-world').world_revision, before.world_revision);
});

test('rollback does not require review when removing a duplicate source leaves an unknown fact projection unchanged', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  engine.commitEvent('causality-world', command({
    event_id: 'same-claim-source-a',
    idempotency_key: 'same-claim-source-a',
    effects: [{ kind: 'fact.set', fact_id: 'contested-fact', predicate: 'state', value: 'open' }],
  }));
  engine.commitEvent('causality-world', command({
    event_id: 'same-claim-source-b',
    idempotency_key: 'same-claim-source-b',
    turn_id: 'same-claim-source-b',
    expected_revision: 1,
    effects: [{ kind: 'fact.set', fact_id: 'contested-fact', predicate: 'state', value: 'open' }],
  }));
  engine.commitEvent('causality-world', command({
    event_id: 'different-claim-source',
    idempotency_key: 'different-claim-source',
    turn_id: 'different-claim-source',
    expected_revision: 2,
    effects: [{ kind: 'fact.set', fact_id: 'contested-fact', predicate: 'state', value: 'closed' }],
  }));
  engine.commitEvent('causality-world', command({
    event_id: 'legacy-unknown-reader',
    idempotency_key: 'legacy-unknown-reader',
    turn_id: 'legacy-unknown-reader',
    expected_revision: 3,
    effects: [{ kind: 'fact.set', fact_id: 'legacy-output', predicate: 'recorded', value: true }],
  }));
  store.db.prepare('UPDATE world_events SET causal_links_json=? WHERE event_id=?').run(
    JSON.stringify([{ relation: 'REQUIRES', predicate: { kind: 'fact_value', fact_id: 'contested-fact', value: 'open' } }]),
    'legacy-unknown-reader',
  );

  const rollback = engine.rollbackEvent('causality-world', {
    root_event_id: 'same-claim-source-a',
    idempotency_key: 'rollback-duplicate-conflict-source',
  });
  const events = new Map(engine.getEvents('causality-world', true).map((event) => [event.event_id, event]));
  const fact = engine.getState('causality-world').facts.find((item) => item.fact_id === 'contested-fact');

  assert.equal(rollback.rollback_outcome, 'resolved');
  assert.deepEqual(rollback.invalidated_event_ids, ['same-claim-source-a']);
  assert.deepEqual(rollback.requires_review_event_ids, []);
  assert.equal(events.get('legacy-unknown-reader').validity, 'valid');
  assert.equal(fact.status, 'conflicted');
  assert.deepEqual(fact.candidates, ['open', 'closed']);
});


test('an unrelated unknown historical predicate does not block an independent rollback', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  engine.commitEvent('causality-world', command({
    event_id: 'unrelated-root',
    idempotency_key: 'unrelated-root',
    effects: [{ kind: 'entity.upsert', entity_id: 'independent-entity', entity_type: 'object' }],
  }));
  engine.commitEvent('causality-world', command({
    event_id: 'unrelated-conflict-a',
    idempotency_key: 'unrelated-conflict-a',
    turn_id: 'unrelated-conflict-a',
    expected_revision: 1,
    effects: [{ kind: 'fact.set', fact_id: 'unrelated-conflict', predicate: 'state', value: 'a' }],
  }));
  engine.commitEvent('causality-world', command({
    event_id: 'unrelated-conflict-b',
    idempotency_key: 'unrelated-conflict-b',
    turn_id: 'unrelated-conflict-b',
    expected_revision: 2,
    effects: [{ kind: 'fact.set', fact_id: 'unrelated-conflict', predicate: 'state', value: 'b' }],
  }));
  engine.commitEvent('causality-world', command({
    event_id: 'unrelated-legacy-event',
    idempotency_key: 'unrelated-legacy-event',
    turn_id: 'unrelated-legacy-event',
    expected_revision: 3,
    effects: [],
  }));
  store.db.prepare('UPDATE world_events SET causal_links_json=? WHERE event_id=?').run(
    JSON.stringify([{ relation: 'REQUIRES', predicate: { kind: 'fact_value', fact_id: 'unrelated-conflict', value: 'a' } }]),
    'unrelated-legacy-event',
  );

  const result = engine.rollbackEvent('causality-world', {
    root_event_id: 'unrelated-root',
    idempotency_key: 'rollback-independent-root',
  });

  assert.equal(result.rollback_outcome, 'resolved');
  assert.equal(result.no_op, false);
  assert.deepEqual(result.requires_review_items, []);
  assert.deepEqual(result.invalidated_event_ids, ['unrelated-root']);
  assert.equal(engine.getState('causality-world').entities.some((entity) => entity.entity_id === 'independent-entity'), false);
});


test('rolling back a later fact source does not require review for an earlier unknown historical predicate', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  for (const [eventId, value, revision] of [
    ['same-fact-conflict-a', 'a', 0],
    ['same-fact-conflict-b', 'b', 1],
  ]) {
    engine.commitEvent('causality-world', command({
      event_id: eventId,
      idempotency_key: eventId,
      turn_id: eventId,
      expected_revision: revision,
      effects: [{ kind: 'fact.set', fact_id: 'same-fact', predicate: 'state', value }],
    }));
  }
  engine.commitEvent('causality-world', command({
    event_id: 'earlier-unknown-requirement',
    idempotency_key: 'earlier-unknown-requirement',
    turn_id: 'earlier-unknown-requirement',
    expected_revision: 2,
    effects: [{ kind: 'fact.set', fact_id: 'legacy-output', predicate: 'created', value: true }],
  }));
  store.db.prepare('UPDATE world_events SET causal_links_json=? WHERE event_id=?').run(
    JSON.stringify([{ relation: 'REQUIRES', predicate: { kind: 'fact_value', fact_id: 'same-fact', value: 'a' } }]),
    'earlier-unknown-requirement',
  );
  engine.commitEvent('causality-world', command({
    event_id: 'later-same-fact-source',
    idempotency_key: 'later-same-fact-source',
    turn_id: 'later-same-fact-source',
    expected_revision: 3,
    effects: [{ kind: 'fact.set', fact_id: 'same-fact', predicate: 'state', value: 'c' }],
  }));

  const rollback = engine.rollbackEvent('causality-world', {
    root_event_id: 'later-same-fact-source',
    idempotency_key: 'rollback-later-same-fact-source',
  });
  const events = new Map(engine.getEvents('causality-world', true).map((event) => [event.event_id, event]));

  assert.equal(rollback.rollback_outcome, 'resolved');
  assert.deepEqual(rollback.invalidated_event_ids, ['later-same-fact-source']);
  assert.deepEqual(rollback.requires_review_event_ids, []);
  assert.equal(events.get('earlier-unknown-requirement').validity, 'valid');
});

test('READS_CLAIM cannot use a later source to retroactively support an earlier reader', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  engine.commitEvent('causality-world', command({
    event_id: 'early-claim-source',
    idempotency_key: 'early-claim-source',
    effects: [{ kind: 'fact.set', fact_id: 'door-state', predicate: 'open', value: true }],
  }));
  engine.commitEvent('causality-world', command({
    event_id: 'historical-claim-reader',
    idempotency_key: 'historical-claim-reader',
    turn_id: 'historical-claim-reader',
    expected_revision: 1,
    causal_links: [{ relation: 'READS_CLAIM', target_id: 'door-state' }],
    effects: [{ kind: 'fact.set', fact_id: 'derived-door-report', predicate: 'reported', value: true }],
  }));
  engine.commitEvent('causality-world', command({
    event_id: 'late-claim-source',
    idempotency_key: 'late-claim-source',
    turn_id: 'late-claim-source',
    expected_revision: 2,
    effects: [{ kind: 'fact.set', fact_id: 'door-state', predicate: 'open', value: true }],
  }));

  const rollback = engine.rollbackEvent('causality-world', {
    root_event_id: 'early-claim-source',
    idempotency_key: 'rollback-early-claim-source',
  });
  const state = engine.getState('causality-world');
  const events = new Map(engine.getEvents('causality-world', true).map((event) => [event.event_id, event]));

  assert.deepEqual(new Set(rollback.invalidated_event_ids), new Set(['early-claim-source', 'historical-claim-reader']));
  assert.equal(events.get('historical-claim-reader').validity, 'invalidated');
  assert.equal(events.get('late-claim-source').validity, 'valid');
  assert.equal(state.facts.find((fact) => fact.fact_id === 'door-state').value, true);
  assert.equal(state.facts.some((fact) => fact.fact_id === 'derived-door-report'), false);
});


test('sequential rollbacks preserve prior invalidations and independently retract the next root', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  engine.commitEvent('causality-world', command({
    event_id: 'sequential-root-a',
    idempotency_key: 'sequential-root-a',
    effects: [{ kind: 'entity.create', entity_id: 'guard-a', entity_type: 'character', attributes: { role: 'guard' } }],
  }));
  engine.commitEvent('causality-world', command({
    event_id: 'sequential-root-b',
    idempotency_key: 'sequential-root-b',
    turn_id: 'sequential-root-b',
    expected_revision: 1,
    effects: [{ kind: 'entity.create', entity_id: 'guard-b', entity_type: 'character', attributes: { role: 'guard' } }],
  }));
  engine.commitEvent('causality-world', command({
    event_id: 'sequential-dependent-update-a',
    idempotency_key: 'sequential-dependent-update-a',
    turn_id: 'sequential-dependent-update-a',
    expected_revision: 2,
    caused_by: ['sequential-root-a'],
    causal_links: [{ relation: 'REQUIRES', predicate: { kind: 'entity_exists', entity_id: 'guard-a' } }],
    effects: [{ kind: 'entity.update', entity_id: 'guard-a', attributes: { role: 'captain' } }],
  }));

  const first = engine.rollbackEvent('causality-world', {
    root_event_id: 'sequential-root-a',
    idempotency_key: 'sequential-rollback-a',
  });
  assert.deepEqual(new Set(first.invalidated_event_ids), new Set([
    'sequential-root-a',
    'sequential-dependent-update-a',
  ]));
  assert.equal(engine.getState('causality-world').world_revision, 4);

  const second = engine.rollbackEvent('causality-world', {
    root_event_id: 'sequential-root-b',
    idempotency_key: 'sequential-rollback-b',
  });
  const events = new Map(engine.getEvents('causality-world', true).map((event) => [event.event_id, event]));
  const state = engine.getState('causality-world');

  assert.deepEqual(second.invalidated_event_ids, ['sequential-root-b']);
  assert.equal(second.world_revision, 5);
  assert.equal(state.world_revision, 5);
  assert.equal(events.get('sequential-root-a').validity, 'retracted');
  assert.equal(events.get('sequential-dependent-update-a').validity, 'invalidated');
  assert.equal(events.get('sequential-root-b').validity, 'retracted');
  assert.equal(state.entities.some((entity) => entity.entity_id === 'guard-a'), false);
  assert.equal(state.entities.some((entity) => entity.entity_id === 'guard-b'), false);
});

test('rollback idempotency replays its original result after history changes and a new key is a no-op', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  engine.commitEvent('causality-world', command({
    event_id: 'idempotent-rollback-target',
    idempotency_key: 'idempotent-rollback-target',
    effects: [{ kind: 'entity.create', entity_id: 'guard', entity_type: 'character', attributes: { role: 'guard' } }],
  }));

  const first = engine.rollbackEvent('causality-world', {
    root_event_id: 'idempotent-rollback-target',
    idempotency_key: 'idempotent-rollback-key',
  });
  assert.equal(first.world_revision, 2);
  assert.equal(first.no_op, false);

  engine.commitEvent('causality-world', command({
    event_id: 'event-after-rollback',
    idempotency_key: 'event-after-rollback',
    turn_id: 'event-after-rollback',
    expected_revision: 2,
    effects: [{ kind: 'fact.set', fact_id: 'unrelated-fact', predicate: 'exists', value: true }],
  }));
  assert.equal(engine.getState('causality-world').world_revision, 3);

  const replay = engine.rollbackEvent('causality-world', {
    root_event_id: 'idempotent-rollback-target',
    idempotency_key: 'idempotent-rollback-key',
  });
  assert.equal(replay.idempotent_replay, true);
  assert.equal(replay.rollback_id, first.rollback_id);
  assert.deepEqual(replay.invalidated_event_ids, first.invalidated_event_ids);
  assert.equal(replay.world_revision, first.world_revision);
  assert.equal(engine.getState('causality-world').world_revision, 3);
  assert.equal(engine.getState('causality-world').facts.some((fact) => fact.fact_id === 'unrelated-fact'), true);

  assert.throws(() => engine.rollbackEvent('causality-world', {
    root_event_id: 'event-after-rollback',
    idempotency_key: 'idempotent-rollback-key',
  }), (error) => error.code === 'IDEMPOTENCY_KEY_CONFLICT' && error.status === 409);

  const newKeyRetry = engine.rollbackEvent('causality-world', {
    root_event_id: 'idempotent-rollback-target',
    idempotency_key: 'idempotent-rollback-new-key',
  });
  assert.equal(newKeyRetry.idempotent_replay, false);
  assert.equal(newKeyRetry.no_op, true);
  assert.equal(newKeyRetry.rollback_id, null);
  assert.deepEqual(newKeyRetry.invalidated_event_ids, []);
  assert.equal(newKeyRetry.world_revision, 3);
  assert.equal(engine.getState('causality-world').world_revision, 3);
});

test('sequential rollbacks invalidate a READS_CLAIM reader when its last remaining support is removed', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  engine.commitEvent('causality-world', command({
    event_id: 'sequential-source-a',
    idempotency_key: 'sequential-source-a',
    effects: [{ kind: 'fact.set', fact_id: 'sequential-door-state', predicate: 'open', value: true }],
  }));
  engine.commitEvent('causality-world', command({
    event_id: 'sequential-source-b',
    idempotency_key: 'sequential-source-b',
    turn_id: 'sequential-source-b',
    expected_revision: 1,
    effects: [{ kind: 'fact.set', fact_id: 'sequential-door-state', predicate: 'open', value: true }],
  }));
  engine.commitEvent('causality-world', command({
    event_id: 'sequential-claim-reader',
    idempotency_key: 'sequential-claim-reader',
    turn_id: 'sequential-claim-reader',
    expected_revision: 2,
    causal_links: [{ relation: 'READS_CLAIM', target_id: 'sequential-door-state' }],
    effects: [{ kind: 'fact.set', fact_id: 'sequential-door-report', predicate: 'reported', value: true }],
  }));

  const firstRollback = engine.rollbackEvent('causality-world', {
    root_event_id: 'sequential-source-a',
    idempotency_key: 'rollback-sequential-source-a',
  });
  let events = new Map(engine.getEvents('causality-world', true).map((event) => [event.event_id, event]));
  let fact = engine.getState('causality-world').facts.find((item) => item.fact_id === 'sequential-door-state');

  assert.deepEqual(new Set(firstRollback.invalidated_event_ids), new Set(['sequential-source-a']));
  assert.equal(events.get('sequential-claim-reader').validity, 'valid');
  assert.deepEqual(fact.source_event_ids, ['sequential-source-b']);

  const secondRollback = engine.rollbackEvent('causality-world', {
    root_event_id: 'sequential-source-b',
    idempotency_key: 'rollback-sequential-source-b',
  });
  events = new Map(engine.getEvents('causality-world', true).map((event) => [event.event_id, event]));
  const state = engine.getState('causality-world');

  assert.deepEqual(new Set(secondRollback.invalidated_event_ids), new Set(['sequential-source-b', 'sequential-claim-reader']));
  assert.equal(events.get('sequential-claim-reader').validity, 'invalidated');
  assert.equal(state.facts.some((item) => item.fact_id === 'sequential-door-state'), false);
  assert.equal(state.facts.some((item) => item.fact_id === 'sequential-door-report'), false);
});


test('rollback of an entity update restores the seed entity projection and keeps the seed event valid', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  const seed = engine.commitEvent('causality-world', command({
    event_id: 'source-a-seed',
    idempotency_key: 'source-a-seed',
    turn_id: 'source-a-seed',
    effects: [
      { kind: 'entity.create', entity_id: 'npc-file-test', entity_type: 'character', attributes: { name: 'NPC' } },
      { kind: 'entity.create', entity_id: 'source-a', entity_type: 'character', attributes: { public_note: 'R1' } },
    ],
  }));
  assert.equal(seed.accepted, true);
  const r1Snapshot = engine.getSnapshot('causality-world', { entityIds: ['source-a'] });
  const r1Entity = r1Snapshot.entities.find((entity) => entity.entity_id === 'source-a');
  assert.ok(r1Entity, 'seed event must create source-a at R1');
  assert.equal(r1Entity.attributes.public_note, 'R1');

  const update = engine.commitEvent('causality-world', command({
    event_id: 'source-a-update-r2',
    idempotency_key: 'source-a-update-r2',
    turn_id: 'source-a-update-r2',
    expected_revision: r1Snapshot.world_revision,
    causal_links: [{ relation: 'REQUIRES', predicate: { kind: 'entity_exists', entity_id: 'source-a' } }],
    effects: [{ kind: 'entity.update', entity_id: 'source-a', attributes: { public_note: 'R2' } }],
  }));
  assert.equal(update.accepted, true);
  const r2Snapshot = engine.getSnapshot('causality-world', { entityIds: ['source-a'] });
  const r2Entity = r2Snapshot.entities.find((entity) => entity.entity_id === 'source-a');
  assert.ok(r2Entity, 'updated entity must exist at R2');
  assert.equal(r2Entity.attributes.public_note, 'R2');
  assert.notEqual(r2Entity.updated_revision, r1Entity.updated_revision);

  const rollback = engine.rollbackEvent('causality-world', {
    root_event_id: 'source-a-update-r2',
    idempotency_key: 'rollback-source-a-update-r2',
  });
  assert.deepEqual(rollback.invalidated_event_ids, ['source-a-update-r2']);

  const events = new Map(engine.getEvents('causality-world', true).map((event) => [event.event_id, event]));
  assert.equal(events.get('source-a-seed').validity, 'valid');
  assert.equal(events.get('source-a-update-r2').validity, 'retracted');

  const afterRollback = engine.getSnapshot('causality-world', { entityIds: ['source-a'] });
  const restored = afterRollback.entities.find((entity) => entity.entity_id === 'source-a');
  assert.ok(restored, 'rollback must rebuild the projection from the still-valid seed event');
  assert.equal(restored.attributes.public_note, 'R1');
  assert.equal(restored.updated_revision, r1Entity.updated_revision);
  assert.equal(afterRollback.commit_sequence, r2Snapshot.commit_sequence);
  assert.ok(afterRollback.world_revision > r2Snapshot.world_revision);
});
