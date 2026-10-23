import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';

function setup() {
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  engine.createWorld({
    world_id: 'fact-identity-world',
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

test('fact.set accepts repeated same-value claims with stable identity and preserves provenance', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  engine.commitEvent('fact-identity-world', command({
    event_id: 'fact-claim-1', idempotency_key: 'fact-claim-1',
    effects: [{ kind: 'fact.set', fact_id: 'weather', predicate: 'weather', value: 'rain' }],
  }));
  engine.commitEvent('fact-identity-world', command({
    event_id: 'fact-claim-2', idempotency_key: 'fact-claim-2', turn_id: 'turn-2', expected_revision: 1,
    effects: [{ kind: 'fact.set', fact_id: 'weather', subject_ref: null, predicate: 'weather', value: 'rain' }],
  }));

  const fact = engine.getState('fact-identity-world').facts.find((item) => item.fact_id === 'weather');
  assert.equal(fact.status, 'active');
  assert.deepEqual(fact.source_event_ids, ['fact-claim-1', 'fact-claim-2']);
  assert.deepEqual(fact.candidates, ['rain']);
});

test('fact.set preserves conflict-aware projection for competing values', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  engine.commitEvent('fact-identity-world', command({
    event_id: 'fact-claim-a', idempotency_key: 'fact-claim-a',
    effects: [{ kind: 'fact.set', fact_id: 'door', subject_ref: 'room-1', predicate: 'door_state', value: 'open' }],
  }));
  engine.commitEvent('fact-identity-world', command({
    event_id: 'fact-claim-b', idempotency_key: 'fact-claim-b', turn_id: 'turn-b', expected_revision: 1,
    effects: [{ kind: 'fact.set', fact_id: 'door', subject_ref: 'room-1', predicate: 'door_state', value: 'closed' }],
  }));

  const fact = engine.getState('fact-identity-world').facts.find((item) => item.fact_id === 'door');
  assert.equal(fact.status, 'conflicted');
  assert.deepEqual(new Set(fact.candidates), new Set(['open', 'closed']));
});

test('fact.set rejects changed predicate or subject identity before writes', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  engine.commitEvent('fact-identity-world', command({
    event_id: 'identity-original', idempotency_key: 'identity-original',
    effects: [{ kind: 'fact.set', fact_id: 'door', subject_ref: 'room-1', predicate: 'door_state', value: 'open' }],
  }));
  const before = engine.getState('fact-identity-world');
  const beforeEvents = store.events('fact-identity-world', true);
  const beforeAudit = store.audit('fact-identity-world');

  assert.throws(() => engine.commitEvent('fact-identity-world', command({
    event_id: 'identity-wrong-predicate', idempotency_key: 'retry-identity-check', turn_id: 'bad-predicate', expected_revision: 1,
    effects: [{ kind: 'fact.set', fact_id: 'door', subject_ref: 'room-1', predicate: 'window_state', value: 'open' }],
  })), (error) => error.code === 'FACT_IDENTITY_MISMATCH' && error.status === 409);

  assert.throws(() => engine.commitEvent('fact-identity-world', command({
    event_id: 'identity-wrong-subject', idempotency_key: 'retry-identity-check', turn_id: 'bad-subject', expected_revision: 1,
    effects: [{ kind: 'fact.set', fact_id: 'door', subject_ref: 'room-2', predicate: 'door_state', value: 'open' }],
  })), (error) => error.code === 'FACT_IDENTITY_MISMATCH' && error.status === 409);

  assert.equal(engine.getState('fact-identity-world').world_revision, before.world_revision);
  assert.deepEqual(store.events('fact-identity-world', true), beforeEvents);
  assert.deepEqual(store.audit('fact-identity-world'), beforeAudit);
});

test('fact.set rejects duplicate fact IDs within one event with a stable domain error', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  assert.throws(() => engine.commitEvent('fact-identity-world', command({
    idempotency_key: 'duplicate-facts', event_id: 'duplicate-facts',
    effects: [
      { kind: 'fact.set', fact_id: 'door', predicate: 'door_state', value: 'open' },
      { kind: 'fact.set', fact_id: 'door', predicate: 'door_state', value: 'closed' },
    ],
  })), (error) => error.code === 'DUPLICATE_FACT_EFFECT' && error.status === 400);

  assert.equal(engine.getState('fact-identity-world').world_revision, 0);
  assert.deepEqual(store.events('fact-identity-world', true).map((event) => event.event_id), []);
  assert.equal(engine.getState('fact-identity-world').facts.length, 0);
  // Reusing the same idempotency key with a valid request proves the rejected call did not consume it.
  const accepted = engine.commitEvent('fact-identity-world', command({
    idempotency_key: 'duplicate-facts', event_id: 'duplicate-facts-fixed',
    effects: [{ kind: 'fact.set', fact_id: 'door', predicate: 'door_state', value: 'open' }],
  }));
  assert.equal(accepted.accepted, true);
});

test('fact.set rejects empty and whitespace-only subject references', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  for (const subject_ref of ['', '   ', '\\t']) {
    assert.throws(() => engine.commitEvent('fact-identity-world', command({
      idempotency_key: 'empty-subject-' + JSON.stringify(subject_ref),
      effects: [{ kind: 'fact.set', fact_id: 'bad-subject', subject_ref, predicate: 'p', value: true }],
    })), (error) => error.code === 'INVALID_EFFECT' && error.status === 400);
  }
  assert.equal(engine.getState('fact-identity-world').world_revision, 0);
});

test('rollback rebuilds fact identity claims and projection from remaining valid events', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  engine.commitEvent('fact-identity-world', command({
    event_id: 'rollback-fact-a', idempotency_key: 'rollback-fact-a',
    effects: [{ kind: 'fact.set', fact_id: 'signal', subject_ref: 'tower', predicate: 'signal', value: 'red' }],
  }));
  engine.commitEvent('fact-identity-world', command({
    event_id: 'rollback-fact-b', idempotency_key: 'rollback-fact-b', turn_id: 'turn-b', expected_revision: 1,
    effects: [{ kind: 'fact.set', fact_id: 'signal', subject_ref: 'tower', predicate: 'signal', value: 'blue' }],
  }));
  assert.equal(engine.getState('fact-identity-world').facts[0].status, 'conflicted');

  engine.rollbackEvent('fact-identity-world', { root_event_id: 'rollback-fact-b', idempotency_key: 'rollback-fact-b-key' });
  const fact = engine.getState('fact-identity-world').facts.find((item) => item.fact_id === 'signal');
  assert.equal(fact.status, 'active');
  assert.equal(fact.value, 'red');
  assert.deepEqual(fact.source_event_ids, ['rollback-fact-a']);

  assert.throws(() => engine.commitEvent('fact-identity-world', command({
    event_id: 'rollback-identity-mismatch', idempotency_key: 'rollback-identity-mismatch', expected_revision: 3,
    effects: [{ kind: 'fact.set', fact_id: 'signal', subject_ref: 'other-tower', predicate: 'signal', value: 'red' }],
  })), (error) => error.code === 'FACT_IDENTITY_MISMATCH');
});
