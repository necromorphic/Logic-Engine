import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { ActorBindingService } from '../src/application/actor-bindings.js';
import { AuthorizedReadService } from '../src/application/authorized-read-service.js';

function setup(t) {
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  const bindings = new ActorBindingService(engine);
  engine.createWorld({
    world_id: 'source-trust-world',
    world_pack_id: 'test.world',
    world_pack_version: '1',
    game_time: '2026-01-01T00:00:00Z',
  });
  const actor = engine.commitEvent('source-trust-world', {
    idempotency_key: 'source-trust-seed-actor',
    turn_id: 'source-trust-seed-actor',
    event_type: 'action.completed',
    expected_revision: 0,
    effects: [{
      kind: 'entity.create',
      entity_id: 'source-trust-actor',
      entity_type: 'character',
      attributes: { name: 'Actor' },
    }],
  });
  assert.equal(actor.accepted, true);
  bindings.bind('source-trust-world', 'adapter-a', 'source-trust-actor');
  t.after(() => store.close());
  return { store, engine, bindings };
}

test('rollback invalidates READS_SOURCE dependents even when commit_sequence does not advance', (t) => {
  const { store, engine } = setup(t);
  const source = engine.commitEvent('source-trust-world', {
    idempotency_key: 'source-trust-source-event',
    turn_id: 'source-trust-source-event',
    event_type: 'action.completed',
    expected_revision: engine.getState('source-trust-world').world_revision,
    effects: [{
      kind: 'entity.create',
      entity_id: 'source-trust-target',
      entity_type: 'character',
      attributes: { name: 'Source value' },
    }],
  });
  assert.equal(source.accepted, true);

  const dependent = engine.commitEvent('source-trust-world', {
    idempotency_key: 'source-trust-dependent-event',
    turn_id: 'source-trust-dependent-event',
    event_type: 'action.completed',
    expected_revision: engine.getState('source-trust-world').world_revision,
    causal_links: [{ relation: 'READS_SOURCE', target_id: source.event_id }],
    effects: [{
      kind: 'entity.create',
      entity_id: 'source-trust-derived',
      entity_type: 'note',
      attributes: { summary: 'Derived from source' },
    }],
  });
  assert.equal(dependent.accepted, true);

  const beforeRollback = engine.getSnapshot('source-trust-world');
  const sequenceBefore = store.currentCommitSequence('source-trust-world');
  const result = engine.rollbackEvent('source-trust-world', {
    root_event_id: source.event_id,
    idempotency_key: 'source-trust-rollback',
  });

  assert.equal(result.accepted, true);
  assert.equal(result.rollback_outcome, 'resolved');
  assert.ok(result.invalidated_event_ids.includes(source.event_id));
  assert.ok(result.invalidated_event_ids.includes(dependent.event_id));
  assert.equal(store.currentCommitSequence('source-trust-world'), sequenceBefore);
  assert.ok(engine.getState('source-trust-world').world_revision > beforeRollback.world_revision);

  const sourceRow = store.db.prepare(
    'SELECT validity FROM world_events WHERE world_id=? AND event_id=?',
  ).get('source-trust-world', source.event_id);
  const dependentRow = store.db.prepare(
    'SELECT validity FROM world_events WHERE world_id=? AND event_id=?',
  ).get('source-trust-world', dependent.event_id);
  assert.equal(sourceRow.validity, 'retracted');
  assert.equal(dependentRow.validity, 'invalidated');
});

test('authorized read rejects the pre-rollback snapshot when sequence is unchanged', (t) => {
  const { store, engine, bindings } = setup(t);
  const source = engine.commitEvent('source-trust-world', {
    idempotency_key: 'source-trust-independent-source',
    turn_id: 'source-trust-independent-source',
    event_type: 'action.completed',
    expected_revision: engine.getState('source-trust-world').world_revision,
    effects: [{
      kind: 'entity.create',
      entity_id: 'source-trust-independent-marker',
      entity_type: 'object',
      attributes: { marker: 'source version' },
    }],
  });
  assert.equal(source.accepted, true);

  const target = engine.commitEvent('source-trust-world', {
    idempotency_key: 'source-trust-still-readable-target',
    turn_id: 'source-trust-still-readable-target',
    event_type: 'action.completed',
    expected_revision: engine.getState('source-trust-world').world_revision,
    effects: [{
      kind: 'entity.create',
      entity_id: 'source-trust-readable-target',
      entity_type: 'character',
      attributes: { name: 'Must not be returned from a stale snapshot' },
    }],
  });
  assert.equal(target.accepted, true);

  const snapshot = engine.getSnapshot('source-trust-world', {
    entityIds: ['source-trust-readable-target'],
  });
  const sequenceBefore = store.currentCommitSequence('source-trust-world');
  const service = new AuthorizedReadService(engine, bindings, (_context, _entity, field) =>
    field === 'attributes.name');

  const result = engine.rollbackEvent('source-trust-world', {
    root_event_id: source.event_id,
    idempotency_key: 'source-trust-independent-rollback',
  });
  assert.equal(result.accepted, true);
  assert.equal(store.currentCommitSequence('source-trust-world'), sequenceBefore);

  assert.throws(
    () => service.readEntityAttributeForMechanic({
      worldId: 'source-trust-world',
      adapterId: 'adapter-a',
      actorEntityId: 'source-trust-actor',
      recipient: 'model',
      purpose: 'npc_decision',
      entityId: 'source-trust-readable-target',
      attribute: 'name',
      expectedWorldRevision: snapshot.world_revision,
      expectedCommitSequence: snapshot.commit_sequence,
    }),
    (error) => error.code === 'STALE_AUTHORIZED_READ_SNAPSHOT'
      && error.status === 409
      && !String(error.message).includes('Must not be returned'),
  );
});

test('source retraction and unchanged event cursor survive Core SQLite restart', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-engine-source-trust-'));
  const databasePath = join(directory, 'core.sqlite');
  let store = new SQLiteStore(databasePath);
  t.after(() => { try { store.close(); } catch {} rmSync(directory, { recursive: true, force: true }); });
  let engine = new LogicEngine(store);
  engine.createWorld({
    world_id: 'source-trust-restart-world',
    world_pack_id: 'test.world',
    world_pack_version: '1',
    game_time: '2026-01-01T00:00:00Z',
  });
  const source = engine.commitEvent('source-trust-restart-world', {
    idempotency_key: 'source-trust-restart-source',
    turn_id: 'source-trust-restart-source',
    event_type: 'action.completed',
    expected_revision: 0,
    effects: [{
      kind: 'entity.create',
      entity_id: 'source-trust-restart-marker',
      entity_type: 'object',
      attributes: { marker: 'source' },
    }],
  });
  assert.equal(source.accepted, true);
  const sequenceBefore = store.currentCommitSequence('source-trust-restart-world');
  const rollback = engine.rollbackEvent('source-trust-restart-world', {
    root_event_id: source.event_id,
    idempotency_key: 'source-trust-restart-rollback',
  });
  assert.equal(rollback.accepted, true);
  assert.equal(store.currentCommitSequence('source-trust-restart-world'), sequenceBefore);
  const revisionAfterRollback = engine.getState('source-trust-restart-world').world_revision;
  store.close();

  store = new SQLiteStore(databasePath);
  engine = new LogicEngine(store);
  const row = store.db.prepare(
    'SELECT validity FROM world_events WHERE world_id=? AND event_id=?',
  ).get('source-trust-restart-world', source.event_id);
  assert.equal(row.validity, 'retracted');
  assert.equal(store.currentCommitSequence('source-trust-restart-world'), sequenceBefore);
  assert.equal(engine.getState('source-trust-restart-world').world_revision, revisionAfterRollback);
  store.close();
});
