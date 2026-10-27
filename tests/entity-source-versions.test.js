import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'logic-core-source-version-'));
  const path = join(directory, 'core.sqlite');
  let store = new SQLiteStore(path);
  let engine = new LogicEngine(store);
  engine.createWorld({
    world_id: 'source-version-world',
    world_pack_id: 'test.source-version',
    world_pack_version: '1',
    game_time: '2026-01-01T00:00:00Z',
  });
  t.after(() => {
    try { store?.close(); } catch {}
    rmSync(directory, { recursive: true, force: true });
  });
  const readVersion = (entityId) => store.db.prepare(
    'SELECT source_version FROM entity_source_versions WHERE world_id=? AND entity_id=?',
  ).get('source-version-world', entityId)?.source_version ?? null;
  const commit = (eventId, expectedRevision, effects, causalLinks = []) => engine.commitEvent('source-version-world', {
    event_id: eventId,
    idempotency_key: eventId,
    turn_id: eventId,
    event_type: 'action.completed',
    expected_revision: expectedRevision,
    causal_links: causalLinks,
    effects,
  });
  return {
    directory, path,
    get store() { return store; },
    get engine() { return engine; },
    readVersion,
    commit,
    reopen() {
      store.close();
      store = new SQLiteStore(path);
      engine = new LogicEngine(store);
    },
  };
}

test('canonical entity source versions advance on every committed entity mutation and survive restart', (t) => {
  const s = fixture(t);
  s.commit('create-source', 0, [{
    kind: 'entity.create',
    entity_id: 'source-a',
    entity_type: 'character',
    attributes: { public_note: 'first' },
  }]);
  assert.equal(s.readVersion('source-a'), 1);
  assert.equal(s.engine.getSnapshot('source-version-world', { entityIds: ['source-a'] }).entities[0].attributes.public_note, 'first');

  s.commit('update-source', 1, [{
    kind: 'entity.update',
    entity_id: 'source-a',
    attributes: { public_note: 'second' },
  }], [{
    relation: 'REQUIRES',
    predicate: { kind: 'entity_exists', entity_id: 'source-a' },
  }]);
  assert.equal(s.readVersion('source-a'), 2);
  assert.equal(s.engine.getSnapshot('source-version-world', { entityIds: ['source-a'] }).entities[0].attributes.public_note, 'second');

  s.reopen();
  assert.equal(s.readVersion('source-a'), 2);
  s.commit('update-source-again', 2, [{
    kind: 'entity.update',
    entity_id: 'source-a',
    attributes: { public_note: 'third' },
  }], [{
    relation: 'REQUIRES',
    predicate: { kind: 'entity_exists', entity_id: 'source-a' },
  }]);
  assert.equal(s.readVersion('source-a'), 3);
});

test('rollback advances canonical source version instead of rewinding to the restored projection', (t) => {
  const s = fixture(t);
  s.commit('create-source', 0, [{
    kind: 'entity.create',
    entity_id: 'source-a',
    entity_type: 'character',
    attributes: { public_note: 'before' },
  }]);
  s.commit('update-source', 1, [{
    kind: 'entity.update',
    entity_id: 'source-a',
    attributes: { public_note: 'after' },
  }], [{
    relation: 'REQUIRES',
    predicate: { kind: 'entity_exists', entity_id: 'source-a' },
  }]);
  assert.equal(s.readVersion('source-a'), 2);

  const result = s.engine.rollbackEvent('source-version-world', {
    root_event_id: 'update-source',
    idempotency_key: 'rollback-source-update',
  });
  assert.equal(result.rollback_outcome, 'resolved');
  assert.equal(s.engine.getSnapshot('source-version-world', { entityIds: ['source-a'] }).entities[0].attributes.public_note, 'before');
  assert.equal(s.readVersion('source-a'), 3);
});
