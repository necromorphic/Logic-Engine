import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';

function setup(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'logic-engine-snapshot-'));
  const databasePath = join(directory, 'world.sqlite');
  const store = new SQLiteStore(databasePath);
  const engine = new LogicEngine(store);
  if (options.journalMode) {
    const mode = store.db.prepare('PRAGMA journal_mode=' + options.journalMode).get().journal_mode;
    assert.equal(mode.toLowerCase(), options.journalMode.toLowerCase());
  }
  engine.createWorld({
    world_id: options.worldId || 'snapshot-world',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    game_time: '2005-12-29T10:00:00Z',
  });
  t.after(() => {
    try { store.close(); } catch {}
    rmSync(directory, { recursive: true, force: true });
  });
  return { store, engine, databasePath };
}

function commit(engine, worldId, eventId, expectedRevision, effects) {
  return engine.commitEvent(worldId, {
    event_id: eventId,
    idempotency_key: eventId,
    turn_id: eventId + '-turn',
    event_type: 'action.completed',
    expected_revision: expectedRevision,
    effects,
    caused_by: [],
    depends_on: [],
    read_set: [],
    causal_links: [],
  });
}

function seedCharacter(engine, worldId, entityId) {
  const state = engine.getState(worldId);
  return commit(engine, worldId, 'seed-' + entityId, state.world_revision, [
    { kind: 'entity.create', entity_id: entityId, entity_type: 'character', attributes: { name: entityId } },
  ]);
}

test('internal snapshot returns only requested world-scoped rows with a composite cursor', (t) => {
  const { store, engine } = setup(t);
  commit(engine, 'snapshot-world', 'snapshot-seed', 0, [
    { kind: 'entity.create', entity_id: 'npc-z', entity_type: 'character' },
    { kind: 'entity.create', entity_id: 'npc-a', entity_type: 'character' },
    { kind: 'fact.set', fact_id: 'fact-z', predicate: 'state', subject_ref: 'npc-z', value: 'z' },
    { kind: 'fact.set', fact_id: 'fact-a', predicate: 'state', subject_ref: 'npc-a', value: 'a' },
  ]);

  const before = {
    state: engine.getState('snapshot-world'),
    events: store.events('snapshot-world', true),
    audit: store.audit('snapshot-world'),
    idempotencyCount: store.db.prepare('SELECT COUNT(*) AS count FROM idempotency_keys WHERE world_id=?').get('snapshot-world').count,
  };

  const snapshot = engine.getSnapshot('snapshot-world', {
    entityIds: ['npc-z', 'npc-a'],
    factIds: ['fact-z', 'fact-missing', 'fact-a'],
    eventIds: ['snapshot-seed', 'event-missing'],
  });

  assert.equal(snapshot.world_revision, 1);
  assert.equal(snapshot.commit_sequence, 1);
  assert.deepEqual(snapshot.entities.map((entity) => entity.entity_id), ['npc-a', 'npc-z']);
  assert.deepEqual(snapshot.facts.map((fact) => fact.fact_id), ['fact-a', 'fact-z']);
  assert.deepEqual(snapshot.events.map((event) => event.event_id), ['snapshot-seed']);
  assert.deepEqual(snapshot.missing_fact_ids, ['fact-missing']);
  assert.deepEqual(snapshot.missing_event_ids, ['event-missing']);
  assert.equal('effects' in snapshot.events[0], false);

  assert.deepEqual(engine.getState('snapshot-world'), before.state);
  assert.deepEqual(store.events('snapshot-world', true), before.events);
  assert.deepEqual(store.audit('snapshot-world'), before.audit);
  assert.equal(
    store.db.prepare('SELECT COUNT(*) AS count FROM idempotency_keys WHERE world_id=?').get('snapshot-world').count,
    before.idempotencyCount,
  );
});

test('internal snapshot fails closed for missing entities and does not cross world boundaries', (t) => {
  const { engine } = setup(t, { worldId: 'world-a' });
  engine.createWorld({
    world_id: 'world-b',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    game_time: '2005-12-29T10:00:00Z',
  });
  seedCharacter(engine, 'world-b', 'shared-entity-id');

  assert.throws(
    () => engine.getSnapshot('world-a', { entityIds: ['shared-entity-id'] }),
    (error) => error.code === 'ENTITY_NOT_FOUND' && error.status === 404,
  );
  assert.throws(
    () => engine.getSnapshot('missing-world', { entityIds: ['shared-entity-id'] }),
    (error) => error.code === 'WORLD_NOT_FOUND' && error.status === 404,
  );
});

test('internal snapshot rejects malformed or duplicate requested identifiers', (t) => {
  const { engine } = setup(t);
  assert.throws(
    () => engine.getSnapshot('snapshot-world', { entityIds: ['npc-a', 'npc-a'] }),
    (error) => error.code === 'INVALID_SNAPSHOT_REQUEST' && error.status === 400,
  );
  assert.throws(
    () => engine.getSnapshot('snapshot-world', { factIds: ['   '] }),
    (error) => error.code === 'INVALID_SNAPSHOT_REQUEST' && error.status === 400,
  );
  assert.throws(
    () => engine.getSnapshot('snapshot-world', { unbounded: true }),
    (error) => error.code === 'INVALID_SNAPSHOT_REQUEST' && error.status === 400,
  );
});

test('SQLite read transaction keeps a coherent view when a rollback-journal writer has uncommitted changes', (t) => {
  const { store, engine, databasePath } = setup(t);
  seedCharacter(engine, 'snapshot-world', 'npc-a');
  const writer = new DatabaseSync(databasePath);
  writer.exec('PRAGMA busy_timeout=0');
  t.after(() => { try { writer.close(); } catch {} });

  store.db.exec('BEGIN');
  const initialWorld = store.db.prepare('SELECT world_revision FROM worlds WHERE world_id=?').get('snapshot-world');
  const initialEntity = store.db.prepare('SELECT status FROM entities WHERE world_id=? AND entity_id=?').get('snapshot-world', 'npc-a');
  writer.exec('BEGIN IMMEDIATE');
  writer.prepare('UPDATE worlds SET world_revision=? WHERE world_id=?').run(initialWorld.world_revision + 1, 'snapshot-world');
  writer.prepare('UPDATE entities SET status=? WHERE world_id=? AND entity_id=?').run('inactive', 'snapshot-world', 'npc-a');

  assert.throws(() => writer.exec('COMMIT'));
  assert.equal(store.db.prepare('SELECT world_revision FROM worlds WHERE world_id=?').get('snapshot-world').world_revision, initialWorld.world_revision);
  assert.equal(store.db.prepare('SELECT status FROM entities WHERE world_id=? AND entity_id=?').get('snapshot-world', 'npc-a').status, initialEntity.status);

  store.db.exec('COMMIT');
  writer.exec('COMMIT');
  writer.close();

  const snapshot = engine.getSnapshot('snapshot-world', { entityIds: ['npc-a'] });
  assert.equal(snapshot.world_revision, initialWorld.world_revision + 1);
  assert.equal(snapshot.entities[0].status, 'inactive');
});

test('SQLite read transaction retains its established snapshot when a WAL writer commits mid-read', (t) => {
  const { store, engine, databasePath } = setup(t, { journalMode: 'WAL' });
  seedCharacter(engine, 'snapshot-world', 'npc-a');
  const writer = new DatabaseSync(databasePath);
  t.after(() => { try { writer.close(); } catch {} });

  store.db.exec('BEGIN');
  const initialWorld = store.db.prepare('SELECT world_revision FROM worlds WHERE world_id=?').get('snapshot-world');
  const initialEntity = store.db.prepare('SELECT status FROM entities WHERE world_id=? AND entity_id=?').get('snapshot-world', 'npc-a');
  writer.exec('BEGIN IMMEDIATE');
  writer.prepare('UPDATE worlds SET world_revision=? WHERE world_id=?').run(initialWorld.world_revision + 1, 'snapshot-world');
  writer.prepare('UPDATE entities SET status=? WHERE world_id=? AND entity_id=?').run('inactive', 'snapshot-world', 'npc-a');
  writer.exec('COMMIT');

  const observedWorld = store.db.prepare('SELECT world_revision FROM worlds WHERE world_id=?').get('snapshot-world');
  const observedEntity = store.db.prepare('SELECT status FROM entities WHERE world_id=? AND entity_id=?').get('snapshot-world', 'npc-a');
  assert.equal(observedWorld.world_revision, initialWorld.world_revision);
  assert.equal(observedEntity.status, initialEntity.status);
  store.db.exec('COMMIT');

  const fresh = engine.getSnapshot('snapshot-world', { entityIds: ['npc-a'] });
  assert.equal(fresh.world_revision, initialWorld.world_revision + 1);
  assert.equal(fresh.entities[0].status, 'inactive');
});

test('internal snapshot refuses to expose uncommitted state from a store write transaction', (t) => {
  const { store, engine } = setup(t);
  assert.throws(
    () => store.tx(() => engine.getSnapshot('snapshot-world')),
    (error) => error.code === 'SNAPSHOT_READ_DURING_WRITE_TRANSACTION' && error.status === 409,
  );
  assert.equal(engine.getState('snapshot-world').world_revision, 0);
});

test('internal snapshot returns no partial result and cleans up after a mid-read query failure', (t) => {
  const { store, engine } = setup(t);
  seedCharacter(engine, 'snapshot-world', 'npc-a');
  store.db.exec('DROP TABLE facts');

  assert.throws(
    () => engine.getSnapshot('snapshot-world', { entityIds: ['npc-a'], factIds: ['fact-a'] }),
  );

  store.db.exec(`CREATE TABLE facts(
    world_id TEXT NOT NULL REFERENCES worlds(world_id),
    fact_id TEXT NOT NULL,
    subject_ref TEXT,
    predicate TEXT NOT NULL,
    status TEXT NOT NULL,
    value_json TEXT,
    candidates_json TEXT NOT NULL,
    source_event_ids_json TEXT NOT NULL,
    updated_revision INTEGER NOT NULL,
    PRIMARY KEY(world_id,fact_id)
  )`);

  const recovered = engine.getSnapshot('snapshot-world', { entityIds: ['npc-a'] });
  assert.equal(recovered.entities[0].entity_id, 'npc-a');
  assert.equal(recovered.world_revision, 1);
});


test('internal snapshot preserves the composite marker across rollback-only revision changes', (t) => {
  const { store, engine } = setup(t);
  seedCharacter(engine, 'snapshot-world', 'npc-a');

  const before = engine.getSnapshot('snapshot-world');
  assert.equal(before.world_revision, 1);
  assert.equal(before.commit_sequence, 1);

  const rollback = engine.rollbackEvent('snapshot-world', {
    root_event_id: 'seed-npc-a',
    idempotency_key: 'snapshot-rollback-seed',
  });
  assert.equal(rollback.accepted, true);
  assert.equal(rollback.world_revision, 2);

  const after = engine.getSnapshot('snapshot-world');
  assert.equal(after.world_revision, 2);
  assert.equal(after.commit_sequence, 1);
  assert.deepEqual(after.entities, []);
  assert.deepEqual(after.facts, []);
  assert.deepEqual(after.events, []);
});


test('snapshot expands only context manifests anchored to the exact composite cursor', (t) => {
  const { engine } = setup(t);
  commit(engine, 'snapshot-world', 'manifest-seed', 0, [
    { kind: 'entity.create', entity_id: 'manifest-npc', entity_type: 'character', attributes: { name: 'Manifest NPC' } },
    { kind: 'fact.set', fact_id: 'manifest-fact', predicate: 'location', subject_ref: 'manifest-npc', value: 'Kamurocho' },
  ]);

  const manifest = engine.registerContextManifest('snapshot-world', {
    generation_id: 'generation-manifest-1',
    base_world_revision: 1,
    base_commit_sequence: 1,
    items: [
      { kind: 'entity', target_id: 'manifest-npc' },
      { kind: 'fact', target_id: 'manifest-fact' },
      { kind: 'event', target_id: 'manifest-seed' },
    ],
  });

  const current = engine.getSnapshot('snapshot-world', { contextManifestIds: [manifest.manifest_id] });
  assert.deepEqual(current.missing_context_manifest_ids, []);
  assert.deepEqual(current.entities.map((entity) => entity.entity_id), ['manifest-npc']);
  assert.deepEqual(current.facts.map((fact) => fact.fact_id), ['manifest-fact']);
  assert.deepEqual(current.events.map((event) => event.event_id), ['manifest-seed']);
  assert.equal(current.context_manifests[0].manifest_id, manifest.manifest_id);

  commit(engine, 'snapshot-world', 'after-manifest', 1, [
    { kind: 'entity.create', entity_id: 'later-npc', entity_type: 'character' },
  ]);
  const stale = engine.getSnapshot('snapshot-world', { contextManifestIds: [manifest.manifest_id] });
  assert.equal(stale.world_revision, 2);
  assert.equal(stale.commit_sequence, 2);
  assert.equal(stale.context_manifests.length, 1);
  assert.deepEqual(stale.entities, []);
  assert.deepEqual(stale.facts, []);
  assert.deepEqual(stale.events, []);
});

test('snapshot reports requested context manifests that do not exist in the requested world', (t) => {
  const { engine } = setup(t, { worldId: 'manifest-world' });
  engine.createWorld({
    world_id: 'other-manifest-world',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    game_time: '2005-12-29T10:00:00Z',
  });
  const registered = engine.registerContextManifest('other-manifest-world', {
    generation_id: 'foreign-generation',
    base_world_revision: 0,
    base_commit_sequence: 0,
    items: [],
  });

  const snapshot = engine.getSnapshot('manifest-world', {
    contextManifestIds: [registered.manifest_id, 'missing-manifest'],
  });
  assert.deepEqual(snapshot.context_manifests, []);
  assert.deepEqual(snapshot.missing_context_manifest_ids, [registered.manifest_id, 'missing-manifest']);
});


test('snapshot refuses a context manifest whose expanded entity set exceeds the bounded read limit', (t) => {
  const { engine } = setup(t);
  const entityEffects = Array.from({ length: 201 }, (_, index) => ({
    kind: 'entity.create',
    entity_id: 'bounded-npc-' + index,
    entity_type: 'character',
  }));
  commit(engine, 'snapshot-world', 'bounded-manifest-seed', 0, entityEffects);

  const manifest = engine.registerContextManifest('snapshot-world', {
    generation_id: 'generation-too-large',
    base_world_revision: 1,
    base_commit_sequence: 1,
    items: entityEffects.map((effect) => ({ kind: 'entity', target_id: effect.entity_id })),
  });

  assert.throws(
    () => engine.getSnapshot('snapshot-world', { contextManifestIds: [manifest.manifest_id] }),
    (error) => error.code === 'SNAPSHOT_TOO_LARGE' && error.status === 409,
  );
});


test('snapshot does not expand a manifest after rollback changes revision without advancing the event cursor', (t) => {
  const { engine } = setup(t);
  seedCharacter(engine, 'snapshot-world', 'rollback-stale-npc');
  const manifest = engine.registerContextManifest('snapshot-world', {
    generation_id: 'generation-before-rollback',
    base_world_revision: 1,
    base_commit_sequence: 1,
    items: [
      { kind: 'entity', target_id: 'rollback-stale-npc' },
      { kind: 'event', target_id: 'seed-rollback-stale-npc' },
    ],
  });

  const rollback = engine.rollbackEvent('snapshot-world', {
    root_event_id: 'seed-rollback-stale-npc',
    idempotency_key: 'rollback-stale-manifest',
  });
  assert.equal(rollback.world_revision, 2);

  const snapshot = engine.getSnapshot('snapshot-world', { contextManifestIds: [manifest.manifest_id] });
  assert.equal(snapshot.world_revision, 2);
  assert.equal(snapshot.commit_sequence, 1);
  assert.equal(snapshot.context_manifests.length, 1);
  assert.deepEqual(snapshot.entities, []);
  assert.deepEqual(snapshot.events, []);
});
