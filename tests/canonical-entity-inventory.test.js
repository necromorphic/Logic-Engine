import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';

function setup(t) {
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  const worldId = 'canonical-inventory-world';
  engine.createWorld({
    world_id: worldId,
    world_pack_id: 'test.canonical-inventory',
    world_pack_version: '1',
    game_time: '2026-01-01T00:00:00Z',
  });
  t.after(() => store.close());
  let revision = 0;
  let eventNumber = 0;
  function createEntities(ids) {
    eventNumber += 1;
    engine.commitEvent(worldId, {
      event_id: 'inventory-seed-' + eventNumber,
      idempotency_key: 'inventory-seed-' + eventNumber,
      turn_id: 'inventory-seed-' + eventNumber,
      event_type: 'action.completed',
      expected_revision: revision,
      effects: ids.map((entity_id) => ({
        kind: 'entity.create',
        entity_id,
        entity_type: 'character',
        attributes: { label: entity_id },
      })),
    });
    revision += 1;
  }
  return { engine, worldId, createEntities, get revision() { return revision; } };
}

test('canonical entity inventory paginates all entities and marks only the final page complete', (t) => {
  const s = setup(t);
  const ids = Array.from({ length: 205 }, (_, i) => 'entity-' + String(i).padStart(3, '0'));
  for (let i = 0; i < ids.length; i += 50) s.createEntities(ids.slice(i, i + 50));

  const collected = [];
  let cursor = null;
  let pages = 0;
  do {
    const page = s.engine.getCanonicalEntityInventory(s.worldId, { limit: 37, ...(cursor ? { cursor } : {}) });
    pages += 1;
    assert.equal(page.world_id, s.worldId);
    assert.equal(page.complete, page.next_cursor === null);
    assert.ok(Number.isSafeInteger(page.world_revision));
    assert.ok(Number.isSafeInteger(page.commit_sequence));
    collected.push(...page.entities);
    cursor = page.next_cursor;
  } while (cursor);

  assert.equal(pages, 6);
  assert.deepEqual(collected.map((entity) => entity.entity_id), ids);
  assert.ok(collected.every((entity) => entity.status === 'active'));
  assert.ok(collected.every((entity) => entity.source_version === 'core-entity-v1:1'));
});

test('canonical entity inventory distinguishes a valid empty inventory from an unknown world', (t) => {
  const s = setup(t);
  const empty = s.engine.getCanonicalEntityInventory(s.worldId);
  assert.deepEqual(empty.entities, []);
  assert.equal(empty.complete, true);
  assert.equal(empty.next_cursor, null);
  assert.throws(
    () => s.engine.getCanonicalEntityInventory('missing-world'),
    (error) => error.code === 'WORLD_NOT_FOUND',
  );
});

test('canonical inventory cursor fails closed after source mutation between pages', (t) => {
  const s = setup(t);
  s.createEntities(['entity-a', 'entity-b', 'entity-c']);
  const first = s.engine.getCanonicalEntityInventory(s.worldId, { limit: 1 });
  assert.ok(first.next_cursor);

  s.createEntities(['entity-d']);
  assert.throws(
    () => s.engine.getCanonicalEntityInventory(s.worldId, { limit: 1, cursor: first.next_cursor }),
    (error) => error.code === 'ENTITY_INVENTORY_SNAPSHOT_STALE',
  );
});

test('canonical inventory cursor rejects altered continuation state', (t) => {
  const s = setup(t);
  s.createEntities(['entity-a', 'entity-b']);
  const first = s.engine.getCanonicalEntityInventory(s.worldId, { limit: 1 });
  const altered = { ...first.next_cursor, after_entity_id: 'entity-z' };
  assert.throws(
    () => s.engine.getCanonicalEntityInventory(s.worldId, { limit: 1, cursor: altered }),
    (error) => error.code === 'INVALID_ENTITY_INVENTORY_CURSOR',
  );
});

test('canonical inventory includes destroyed entities with a fresh source version', (t) => {
  const s = setup(t);
  s.createEntities(['entity-a']);
  const versionBefore = s.engine.getCanonicalEntityInventory(s.worldId).entities[0].source_version;
  s.engine.commitEvent(s.worldId, {
    event_id: 'inventory-delete',
    idempotency_key: 'inventory-delete',
    turn_id: 'inventory-delete',
    event_type: 'action.completed',
    expected_revision: s.revision,
    effects: [{ kind: 'entity.delete', entity_id: 'entity-a' }],
  });
  const after = s.engine.getCanonicalEntityInventory(s.worldId);
  assert.equal(after.entities.length, 1);
  assert.equal(after.entities[0].status, 'destroyed');
  assert.notEqual(after.entities[0].source_version, versionBefore);
});
