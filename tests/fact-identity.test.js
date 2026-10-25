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

  for (const subject_ref of ['', '   ', String.fromCharCode(9)]) {
    assert.throws(() => engine.commitEvent('fact-identity-world', command({
      idempotency_key: 'empty-subject-' + JSON.stringify(subject_ref),
      effects: [{ kind: 'fact.set', fact_id: 'bad-subject', subject_ref, predicate: 'p', value: true }],
    })), (error) => error.code === 'INVALID_EFFECT' && error.status === 400);
  }
  assert.equal(engine.getState('fact-identity-world').world_revision, 0);
});

test('fact.set rejects surrounding whitespace in canonical identity fields before writes', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  const auditBefore = store.db.prepare('SELECT COUNT(*) AS count FROM audit_entries').get().count;
  const invalidEffects = [
    { kind: 'fact.set', fact_id: ' door', predicate: 'state', value: 'open' },
    { kind: 'fact.set', fact_id: 'door ', predicate: 'state', value: 'open' },
    { kind: 'fact.set', fact_id: 'door', predicate: ' state', value: 'open' },
    { kind: 'fact.set', fact_id: 'door', predicate: 'state ', value: 'open' },
    { kind: 'fact.set', fact_id: 'door', subject_ref: ' room', predicate: 'state', value: 'open' },
    { kind: 'fact.set', fact_id: 'door', subject_ref: 'room ', predicate: 'state', value: 'open' },
  ];

  invalidEffects.forEach((effect, index) => {
    assert.throws(() => engine.commitEvent('fact-identity-world', command({
      idempotency_key: 'padded-identity-' + index,
      event_id: 'padded-identity-event-' + index,
      effects: [effect],
    })), (error) => error.code === 'INVALID_EFFECT' && error.status === 400);
  });
  assert.equal(engine.getState('fact-identity-world').world_revision, 0);
  assert.deepEqual(store.events('fact-identity-world', true), []);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM audit_entries').get().count, auditBefore);
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


test('fact.set treats absent subject_ref as SQL NULL and keeps it equivalent to explicit null', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  engine.commitEvent('fact-identity-world', command({
    event_id: 'absent-subject-ref', idempotency_key: 'absent-subject-ref',
    effects: [{ kind: 'fact.set', fact_id: 'nullable-subject', predicate: 'p', value: 'v1' }],
  }));
  const stored = store.db.prepare(
    'SELECT subject_ref FROM fact_claims WHERE world_id=? AND fact_id=?'
  ).get('fact-identity-world', 'nullable-subject');
  assert.equal(stored.subject_ref, null);

  const accepted = engine.commitEvent('fact-identity-world', command({
    event_id: 'explicit-null-subject-ref', idempotency_key: 'explicit-null-subject-ref',
    turn_id: 'turn-null', expected_revision: 1,
    effects: [{ kind: 'fact.set', fact_id: 'nullable-subject', subject_ref: null, predicate: 'p', value: 'v2' }],
  }));
  assert.equal(accepted.accepted, true);
});

test('fact.set identity is isolated between worlds', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());
  engine.createWorld({
    world_id: 'fact-identity-world-b',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    game_time: '2005-12-29T10:00:00Z',
  });

  engine.commitEvent('fact-identity-world', command({
    event_id: 'world-a-fact', idempotency_key: 'world-a-fact',
    effects: [{ kind: 'fact.set', fact_id: 'shared-id', predicate: 'p1', value: 'a' }],
  }));
  const accepted = engine.commitEvent('fact-identity-world-b', command({
    event_id: 'world-b-fact', idempotency_key: 'world-b-fact',
    effects: [{ kind: 'fact.set', fact_id: 'shared-id', predicate: 'p2', value: 'b' }],
  }));
  assert.equal(accepted.accepted, true);
});

test('fact.set rejects exact duplicate effects in one event', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  const duplicate = { kind: 'fact.set', fact_id: 'same', predicate: 'p', value: 'v' };
  assert.throws(() => engine.commitEvent('fact-identity-world', command({
    event_id: 'exact-duplicate', idempotency_key: 'exact-duplicate',
    effects: [duplicate, { ...duplicate }],
  })), (error) => error.code === 'DUPLICATE_FACT_EFFECT' && error.status === 400);
  assert.equal(engine.getState('fact-identity-world').world_revision, 0);
});

test('identity mismatch rejection does not consume the idempotency key', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  engine.commitEvent('fact-identity-world', command({
    event_id: 'key-identity-original', idempotency_key: 'key-identity-original',
    effects: [{ kind: 'fact.set', fact_id: 'keyed-fact', predicate: 'p1', value: 'v' }],
  }));
  assert.throws(() => engine.commitEvent('fact-identity-world', command({
    event_id: 'key-identity-rejected', idempotency_key: 'reusable-after-identity-error',
    expected_revision: 1,
    effects: [{ kind: 'fact.set', fact_id: 'keyed-fact', predicate: 'p2', value: 'v' }],
  })), (error) => error.code === 'FACT_IDENTITY_MISMATCH');

  const accepted = engine.commitEvent('fact-identity-world', command({
    event_id: 'key-identity-retry-valid', idempotency_key: 'reusable-after-identity-error',
    expected_revision: 1,
    effects: [{ kind: 'fact.set', fact_id: 'another-fact', predicate: 'p2', value: 'v' }],
  }));
  assert.equal(accepted.accepted, true);
});

test('rollback of the last claim releases fact identity for a later valid event', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  engine.commitEvent('fact-identity-world', command({
    event_id: 'rollback-last-claim', idempotency_key: 'rollback-last-claim',
    effects: [{ kind: 'fact.set', fact_id: 'reusable-fact-id', predicate: 'old_predicate', value: 'old' }],
  }));
  engine.rollbackEvent('fact-identity-world', {
    root_event_id: 'rollback-last-claim',
    idempotency_key: 'rollback-last-claim-key',
  });

  assert.equal(store.db.prepare(
    'SELECT COUNT(*) AS count FROM fact_claims WHERE world_id=? AND fact_id=?'
  ).get('fact-identity-world', 'reusable-fact-id').count, 0);

  const currentRevision = engine.getState('fact-identity-world').world_revision;
  const accepted = engine.commitEvent('fact-identity-world', command({
    event_id: 'reused-fact-id-after-rollback',
    idempotency_key: 'reused-fact-id-after-rollback',
    expected_revision: currentRevision,
    effects: [{ kind: 'fact.set', fact_id: 'reusable-fact-id', predicate: 'new_predicate', value: 'new' }],
  }));
  assert.equal(accepted.accepted, true);
  assert.equal(engine.getState('fact-identity-world').facts.find((fact) => fact.fact_id === 'reusable-fact-id').predicate, 'new_predicate');
});


test('fact.set identity guard detects inconsistent historical claims, not only the projection', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  engine.commitEvent('fact-identity-world', command({
    event_id: 'historical-consistent-claim', idempotency_key: 'historical-consistent-claim',
    effects: [{ kind: 'fact.set', fact_id: 'legacy-fact', predicate: 'p1', value: 'v1' }],
  }));
  // Simulate legacy/inconsistent storage history that predates the identity guard.
  store.db.prepare(
    'INSERT INTO fact_claims(world_id,fact_id,event_id,subject_ref,predicate,value_json,committed_revision) VALUES(?,?,?,?,?,?,?)'
  ).run('fact-identity-world', 'legacy-fact', 'historical-inconsistent-event', null, 'p2', JSON.stringify('v2'), 0);

  assert.throws(() => engine.commitEvent('fact-identity-world', command({
    event_id: 'legacy-fact-new-claim', idempotency_key: 'legacy-fact-new-claim',
    expected_revision: 1,
    effects: [{ kind: 'fact.set', fact_id: 'legacy-fact', predicate: 'p1', value: 'v3' }],
  })), (error) => error.code === 'FACT_IDENTITY_MISMATCH' && error.status === 409);
  assert.equal(engine.getState('fact-identity-world').world_revision, 1);
});


test('fact identity guard checks historical claims hidden by the current projection', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  engine.commitEvent('fact-identity-world', command({
    event_id: 'legacy-identity-a', idempotency_key: 'legacy-identity-a',
    effects: [{ kind: 'fact.set', fact_id: 'door', subject_ref: 'room-1', predicate: 'window_state', value: 'open' }],
  }));
  engine.commitEvent('fact-identity-world', command({
    event_id: 'legacy-identity-b', idempotency_key: 'legacy-identity-b', turn_id: 'turn-b', expected_revision: 1,
    effects: [{ kind: 'entity.create', entity_id: 'temporary-entity', entity_type: 'test' }],
  }));

  // Simulate legacy event history created before the identity guard existed:
  // the later claim restores the visible projection's identity, hiding the
  // earlier inconsistent identity unless the commit guard reads all claims.
  store.db.prepare('UPDATE world_events SET effects_json=? WHERE world_id=? AND event_id=?').run(
    JSON.stringify([{ kind: 'fact.set', fact_id: 'door', subject_ref: 'room-1', predicate: 'door_state', value: 'open' }]),
    'fact-identity-world',
    'legacy-identity-b',
  );
  store.rebuild('fact-identity-world', 2);

  const visible = engine.getState('fact-identity-world').facts.find((item) => item.fact_id === 'door');
  assert.equal(visible.predicate, 'door_state');

  assert.throws(() => engine.commitEvent('fact-identity-world', command({
    event_id: 'legacy-identity-c', idempotency_key: 'legacy-identity-c', turn_id: 'turn-c', expected_revision: 2,
    effects: [{ kind: 'fact.set', fact_id: 'door', subject_ref: 'room-1', predicate: 'door_state', value: 'open' }],
  })), (error) => error.code === 'FACT_IDENTITY_MISMATCH' && error.status === 409);

  assert.equal(engine.getState('fact-identity-world').world_revision, 2);
  assert.equal(store.events('fact-identity-world', true).length, 2);
});