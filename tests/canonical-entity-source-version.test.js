import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { createCanonicalEntitySourceVersionValidator } from '../src/application/canonical-entity-source-version.js';

function setup(t) {
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  engine.createWorld({
    world_id: 'source-authority-world',
    world_pack_id: 'test.world',
    world_pack_version: '1',
    game_time: '2026-01-01T00:00:00Z',
  });
  engine.commitEvent('source-authority-world', {
    idempotency_key: 'seed-source-authority-world',
    turn_id: 'seed-source-authority-world',
    event_type: 'action.completed',
    expected_revision: 0,
    effects: [
      { kind: 'entity.create', entity_id: 'source-a', entity_type: 'character', attributes: { public_note: 'original' } },
    ],
  });
  t.after(() => store.close());
  return { store, engine, validate: createCanonicalEntitySourceVersionValidator(engine) };
}
function sourceState(engine, entityId) {
  return engine.getCanonicalEntitySourceState('source-authority-world', entityId);
}
function candidate(overrides = {}) {
  return {
    world_id: 'source-authority-world',
    source_kind: 'canonical_entity',
    source_entity_id: 'source-a',
    source_version: 'core-entity-v1:1',
    lineage: [{ source_kind: 'canonical_entity', entity_id: 'source-a', source_version: 'core-entity-v1:1' }],
    ...overrides,
  };
}

test('Core source-version validator accepts only the exact active canonical entity token', (t) => {
  const { engine, validate } = setup(t);
  const version = sourceState(engine, 'source-a').source_version;
  assert.equal(validate(candidate({ source_version: version, lineage: [
    { source_kind: 'canonical_entity', entity_id: 'source-a', source_version: version },
  ] })), true);
  assert.equal(validate(candidate({ source_version: 'core-entity-v1:999' })), false);
  assert.equal(validate(candidate({ source_version: 'core-entity-v1:01' })), false);
  assert.equal(validate(candidate({ source_entity_id: 'missing-source', lineage: [
    { source_kind: 'canonical_entity', entity_id: 'missing-source', source_version: version },
  ] })), false);
  assert.equal(validate(candidate({ source_kind: 'host_message' })), false);
  assert.equal(validate(candidate({ lineage: [
    { source_kind: 'canonical_entity', entity_id: 'source-a', source_version: version },
    { source_kind: 'canonical_entity', entity_id: 'source-a', source_version: version },
  ] })), false);
});

test('Core source token advances on update and rollback instead of reusing an old token', (t) => {
  const { engine, validate } = setup(t);
  const initial = sourceState(engine, 'source-a');
  const initialVersion = initial.source_version;
  const update = engine.commitEvent('source-authority-world', {
    event_id: 'source-authority-update',
    idempotency_key: 'source-authority-update',
    turn_id: 'source-authority-update',
    event_type: 'action.completed',
    expected_revision: initial.world_revision,
    causal_links: [{ relation: 'REQUIRES', predicate: { kind: 'entity_exists', entity_id: 'source-a' } }],
    effects: [{ kind: 'entity.update', entity_id: 'source-a', attributes: { public_note: 'updated' } }],
  });
  assert.equal(update.accepted, true);
  const changed = sourceState(engine, 'source-a');
  const changedVersion = changed.source_version;
  assert.notEqual(changedVersion, initialVersion);
  assert.equal(validate(candidate({ source_version: initialVersion, lineage: [
    { source_kind: 'canonical_entity', entity_id: 'source-a', source_version: initialVersion },
  ] })), false);
  assert.equal(validate(candidate({ source_version: changedVersion, lineage: [
    { source_kind: 'canonical_entity', entity_id: 'source-a', source_version: changedVersion },
  ] })), true);

  const rollback = engine.rollbackEvent('source-authority-world', {
    root_event_id: 'source-authority-update',
    idempotency_key: 'source-authority-rollback',
  });
  assert.equal(rollback.accepted, true);
  const restored = sourceState(engine, 'source-a');
  assert.equal(restored.commit_sequence, changed.commit_sequence);
  assert.notEqual(restored.world_revision, changed.world_revision);
  assert.notEqual(restored.source_version, initialVersion);
  assert.notEqual(restored.source_version, changedVersion);
  assert.equal(validate(candidate({ source_version: initialVersion, lineage: [
    { source_kind: 'canonical_entity', entity_id: 'source-a', source_version: initialVersion },
  ] })), false);
  assert.equal(validate(candidate({ source_version: changedVersion, lineage: [
    { source_kind: 'canonical_entity', entity_id: 'source-a', source_version: changedVersion },
  ] })), false);
  assert.equal(validate(candidate({ source_version: restored.source_version, lineage: [
    { source_kind: 'canonical_entity', entity_id: 'source-a', source_version: restored.source_version },
  ] })), true);
});

test('Core source token remains source-specific after unrelated entity updates', (t) => {
  const { engine } = setup(t);
  const initial = sourceState(engine, 'source-a').source_version;
  const current = engine.getSnapshot('source-authority-world');
  const result = engine.commitEvent('source-authority-world', {
    idempotency_key: 'create-unrelated-source',
    turn_id: 'create-unrelated-source',
    event_type: 'action.completed',
    expected_revision: current.world_revision,
    effects: [{ kind: 'entity.create', entity_id: 'source-b', entity_type: 'character', attributes: { public_note: 'other' } }],
  });
  assert.equal(result.accepted, true);
  assert.equal(sourceState(engine, 'source-a').source_version, initial);
});

test('Core source-version validator rejects destroyed entities and unavailable Core snapshots', (t) => {
  const { engine, validate } = setup(t);
  const current = sourceState(engine, 'source-a');
  assert.equal(validate(candidate({ source_version: current.source_version, lineage: [
    { source_kind: 'canonical_entity', entity_id: 'source-a', source_version: current.source_version },
  ] })), true);

  const destroyed = engine.commitEvent('source-authority-world', {
    event_id: 'source-authority-destroy',
    idempotency_key: 'source-authority-destroy',
    turn_id: 'source-authority-destroy',
    event_type: 'action.completed',
    expected_revision: current.world_revision,
    causal_links: [{ relation: 'REQUIRES', predicate: { kind: 'entity_exists', entity_id: 'source-a' } }],
    effects: [{ kind: 'entity.update', entity_id: 'source-a', status: 'destroyed' }],
  });
  assert.equal(destroyed.accepted, true);
  const destroyedState = sourceState(engine, 'source-a');
  assert.equal(validate(candidate({ source_version: destroyedState.source_version, lineage: [
    { source_kind: 'canonical_entity', entity_id: 'source-a', source_version: destroyedState.source_version },
  ] })), false);

  const unavailable = createCanonicalEntitySourceVersionValidator({
    getCanonicalEntitySourceState() { throw new Error('store unavailable'); },
  });
  assert.throws(() => unavailable(candidate({ source_version: current.source_version })), /CORE_SOURCE_SNAPSHOT_UNAVAILABLE/);
});
