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

function candidate(overrides = {}) {
  return {
    world_id: 'source-authority-world',
    source_kind: 'canonical_entity',
    source_entity_id: 'source-a',
    source_version: '1',
    lineage: [{ source_kind: 'canonical_entity', entity_id: 'source-a', source_version: '1' }],
    ...overrides,
  };
}

test('Core source-version validator accepts only the exact active canonical entity revision', (t) => {
  const { engine, validate } = setup(t);
  const snapshot = engine.getSnapshot('source-authority-world', { entityIds: ['source-a'] });
  const revision = String(snapshot.entities[0].updated_revision);

  assert.equal(validate(candidate({ source_version: revision, lineage: [
    { source_kind: 'canonical_entity', entity_id: 'source-a', source_version: revision },
  ] })), true);
  assert.equal(validate(candidate({ source_version: '999' })), false);
  assert.equal(validate(candidate({ source_version: '01' })), false);
  assert.equal(validate(candidate({ source_entity_id: 'missing-source', lineage: [
    { source_kind: 'canonical_entity', entity_id: 'missing-source', source_version: '1' },
  ] })), false);
  assert.equal(validate(candidate({ source_kind: 'host_message' })), false);
  assert.equal(validate(candidate({ lineage: [
    { source_kind: 'canonical_entity', entity_id: 'source-a', source_version: revision },
    { source_kind: 'canonical_entity', entity_id: 'source-a', source_version: revision },
  ] })), false);
});

test('Core source-version validator rejects stale revisions after update and rollback', (t) => {
  const { engine, validate } = setup(t);
  const initial = engine.getSnapshot('source-authority-world', { entityIds: ['source-a'] });
  const initialVersion = String(initial.entities[0].updated_revision);
  const update = engine.commitEvent('source-authority-world', {
    event_id: 'source-authority-update',
    idempotency_key: 'source-authority-update',
    turn_id: 'source-authority-update',
    event_type: 'action.completed',
    expected_revision: initial.world_revision,
    effects: [{ kind: 'entity.update', entity_id: 'source-a', attributes: { public_note: 'updated' } }],
  });
  assert.equal(update.accepted, true);
  const changed = engine.getSnapshot('source-authority-world', { entityIds: ['source-a'] });
  const changedVersion = String(changed.entities[0].updated_revision);
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
  const restored = engine.getSnapshot('source-authority-world', { entityIds: ['source-a'] });
  const restoredVersion = String(restored.entities[0].updated_revision);
  assert.equal(restored.commit_sequence, changed.commit_sequence);
  assert.notEqual(restored.world_revision, changed.world_revision);
  assert.equal(validate(candidate({ source_version: changedVersion, lineage: [
    { source_kind: 'canonical_entity', entity_id: 'source-a', source_version: changedVersion },
  ] })), false);
  assert.equal(validate(candidate({ source_version: restoredVersion, lineage: [
    { source_kind: 'canonical_entity', entity_id: 'source-a', source_version: restoredVersion },
  ] })), true);
});

test('Core source-version validator rejects destroyed entities and unavailable Core snapshots', (t) => {
  const { engine, validate } = setup(t);
  const current = engine.getSnapshot('source-authority-world', { entityIds: ['source-a'] });
  const version = String(current.entities[0].updated_revision);
  assert.equal(validate(candidate({ source_version: version, lineage: [
    { source_kind: 'canonical_entity', entity_id: 'source-a', source_version: version },
  ] })), true);

  const destroyed = engine.commitEvent('source-authority-world', {
    event_id: 'source-authority-destroy',
    idempotency_key: 'source-authority-destroy',
    turn_id: 'source-authority-destroy',
    event_type: 'action.completed',
    expected_revision: current.world_revision,
    effects: [{ kind: 'entity.destroy', entity_id: 'source-a' }],
  });
  assert.equal(destroyed.accepted, true);
  assert.equal(validate(candidate({ source_version: version, lineage: [
    { source_kind: 'canonical_entity', entity_id: 'source-a', source_version: version },
  ] })), false);

  const unavailable = createCanonicalEntitySourceVersionValidator({
    getSnapshot() { throw new Error('store unavailable'); },
  });
  assert.equal(unavailable(candidate({ source_version: version })), false);
});
