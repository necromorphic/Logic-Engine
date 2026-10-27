import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    source_version: 'core-entity-v1:1',
    lineage: [{ source_kind: 'canonical_entity', entity_id: 'source-a', source_version: 'core-entity-v1:1' }],
    ...overrides,
  };
}

test('Core source-version validator accepts only the exact active canonical entity revision', (t) => {
  const { engine, validate } = setup(t);
  const snapshot = engine.getSnapshot('source-authority-world', { entityIds: ['source-a'], includeSourceVersions: true });
  const revision = snapshot.entities[0].source_version;

  assert.equal(validate(candidate({ source_version: revision, lineage: [
    { source_kind: 'canonical_entity', entity_id: 'source-a', source_version: revision },
  ] })), true);
  assert.equal(validate(candidate({ source_version: '999' })), false);
  assert.equal(validate(candidate({ source_version: 'core-entity-v1:01' })), false);
  assert.equal(validate(candidate({ source_version: undefined })), false);
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
  const initial = engine.getSnapshot('source-authority-world', { entityIds: ['source-a'], includeSourceVersions: true });
  const initialVersion = initial.entities[0].source_version;
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
  const changed = engine.getSnapshot('source-authority-world', { entityIds: ['source-a'], includeSourceVersions: true });
  const changedVersion = changed.entities[0].source_version;
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
  const restored = engine.getSnapshot('source-authority-world', { entityIds: ['source-a'], includeSourceVersions: true });
  const restoredVersion = restored.entities[0].source_version;
  assert.equal(restored.commit_sequence, changed.commit_sequence);
  assert.notEqual(restored.world_revision, changed.world_revision);
  assert.notEqual(restoredVersion, changedVersion, 'rollback must not reuse the invalidated source token');
  assert.notEqual(restoredVersion, initialVersion, 'rollback to old content must issue a new source token');
  assert.equal(validate(candidate({ source_version: changedVersion, lineage: [
    { source_kind: 'canonical_entity', entity_id: 'source-a', source_version: changedVersion },
  ] })), false);
  assert.equal(validate(candidate({ source_version: restoredVersion, lineage: [
    { source_kind: 'canonical_entity', entity_id: 'source-a', source_version: restoredVersion },
  ] })), true);
});

test('Core source-version validator rejects destroyed entities and unavailable Core snapshots', (t) => {
  const { engine, validate } = setup(t);
  const current = engine.getSnapshot('source-authority-world', { entityIds: ['source-a'], includeSourceVersions: true });
  const version = current.entities[0].source_version;
  assert.equal(validate(candidate({ source_version: version, lineage: [
    { source_kind: 'canonical_entity', entity_id: 'source-a', source_version: version },
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
  const destroyedSnapshot = engine.getSnapshot('source-authority-world', { entityIds: ['source-a'], includeSourceVersions: true });
  const destroyedVersion = destroyedSnapshot.entities[0].source_version;
  assert.equal(validate(candidate({ source_version: destroyedVersion, lineage: [
    { source_kind: 'canonical_entity', entity_id: 'source-a', source_version: destroyedVersion },
  ] })), false);

  const unavailable = createCanonicalEntitySourceVersionValidator({
    getSnapshot() { throw new Error('store unavailable'); },
  });
  assert.throws(() => unavailable(candidate({ source_version: version })), /CORE_SOURCE_SNAPSHOT_UNAVAILABLE/);
});


test('Core source token is stable across unrelated events and persists across restart', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-entity-source-version-'));
  const dbPath = join(directory, 'core.sqlite');
  let store = new SQLiteStore(dbPath);
  let engine = new LogicEngine(store);
  engine.createWorld({
    world_id: 'source-token-persistence-world',
    world_pack_id: 'test.world',
    world_pack_version: '1',
    game_time: '2026-01-01T00:00:00Z',
  });
  engine.commitEvent('source-token-persistence-world', {
    idempotency_key: 'seed-source-token-persistence',
    turn_id: 'seed-source-token-persistence',
    event_type: 'action.completed',
    expected_revision: 0,
    effects: [{ kind: 'entity.create', entity_id: 'source-a', entity_type: 'character', attributes: { note: 'stable' } }],
  });
  const first = engine.getSnapshot('source-token-persistence-world', {
    entityIds: ['source-a'], includeSourceVersions: true,
  }).entities[0].source_version;

  const beforeUnrelated = engine.getSnapshot('source-token-persistence-world', {
    entityIds: ['source-a'], includeSourceVersions: true,
  });
  engine.commitEvent('source-token-persistence-world', {
    idempotency_key: 'create-unrelated-source-token-entity',
    turn_id: 'create-unrelated-source-token-entity',
    event_type: 'action.completed',
    expected_revision: beforeUnrelated.world_revision,
    effects: [{ kind: 'entity.create', entity_id: 'unrelated', entity_type: 'object' }],
  });
  const afterUnrelated = engine.getSnapshot('source-token-persistence-world', {
    entityIds: ['source-a'], includeSourceVersions: true,
  }).entities[0].source_version;
  assert.equal(afterUnrelated, first, 'unrelated entity changes must not invalidate this source token');

  store.close();
  store = new SQLiteStore(dbPath);
  engine = new LogicEngine(store);
  const afterRestart = engine.getSnapshot('source-token-persistence-world', {
    entityIds: ['source-a'], includeSourceVersions: true,
  }).entities[0].source_version;
  assert.equal(afterRestart, afterUnrelated, 'source token must persist across process/store restart');

  t.after(() => {
    try { store.close(); } catch {}
    rmSync(directory, { recursive: true, force: true });
  });
});


test('migration backfills Core source tokens for entities already persisted before migration', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-entity-source-version-migration-'));
  const dbPath = join(directory, 'core.sqlite');
  let store = new SQLiteStore(dbPath);
  const engine = new LogicEngine(store);
  engine.createWorld({
    world_id: 'source-token-migration-world',
    world_pack_id: 'test.world',
    world_pack_version: '1',
    game_time: '2026-01-01T00:00:00Z',
  });
  engine.commitEvent('source-token-migration-world', {
    idempotency_key: 'seed-source-token-migration',
    turn_id: 'seed-source-token-migration',
    event_type: 'action.completed',
    expected_revision: 0,
    effects: [{ kind: 'entity.create', entity_id: 'source-a', entity_type: 'character', attributes: { note: 'legacy' } }],
  });
  store.db.exec('DROP TABLE entity_source_versions; DELETE FROM schema_migrations WHERE version=12;');
  store.close();

  store = new SQLiteStore(dbPath);
  const reopenedEngine = new LogicEngine(store);
  const snapshot = reopenedEngine.getSnapshot('source-token-migration-world', {
    entityIds: ['source-a'], includeSourceVersions: true,
  });
  assert.equal(snapshot.entities[0].source_version, 'core-entity-v1:1');
  t.after(() => {
    try { store.close(); } catch {}
    rmSync(directory, { recursive: true, force: true });
  });
});
