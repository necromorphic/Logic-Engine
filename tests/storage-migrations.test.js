import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SQLiteStore } from '../src/storage/sqlite-store.js';

function createLegacyDatabase(path) {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE worlds(
      world_id TEXT PRIMARY KEY, world_pack_id TEXT NOT NULL, world_pack_version TEXT NOT NULL,
      initial_game_time TEXT NOT NULL, game_time TEXT NOT NULL, world_revision INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL
    );
    CREATE TABLE world_events(
      event_id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(world_id),
      turn_id TEXT NOT NULL, generation_id TEXT, event_type TEXT NOT NULL, game_time TEXT NOT NULL,
      committed_revision INTEGER NOT NULL, validity TEXT NOT NULL, caused_by_json TEXT NOT NULL,
      depends_on_json TEXT NOT NULL, read_set_json TEXT NOT NULL, effects_json TEXT NOT NULL,
      time_advance_seconds INTEGER NOT NULL DEFAULT 0, source_message_id TEXT, created_at TEXT NOT NULL,
      rollback_id TEXT
    );
    CREATE TABLE idempotency_keys(
      world_id TEXT NOT NULL REFERENCES worlds(world_id), idempotency_key TEXT NOT NULL,
      response_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(world_id,idempotency_key)
    );
    CREATE TABLE context_manifests(
      manifest_id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(world_id),
      generation_id TEXT NOT NULL, base_commit_sequence INTEGER NOT NULL,
      items_json TEXT NOT NULL, manifest_hash TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(world_id,generation_id)
    );
    INSERT INTO worlds(world_id,world_pack_id,world_pack_version,initial_game_time,game_time,world_revision,status,created_at)
      VALUES('legacy-world','test.world','1.0.0','2005-12-29T10:00:00.000Z','2005-12-29T10:05:00.000Z',2,'active','2005-12-29T10:00:00.000Z');
    INSERT INTO world_events(event_id,world_id,turn_id,event_type,game_time,committed_revision,validity,caused_by_json,depends_on_json,read_set_json,effects_json,created_at)
      VALUES
        ('legacy-event-1','legacy-world','turn-1','action.completed','2005-12-29T10:01:00.000Z',1,'valid','[]','[]','[]','[]','2005-12-29T10:01:00.000Z'),
        ('legacy-event-2','legacy-world','turn-2','action.completed','2005-12-29T10:05:00.000Z',2,'valid','[]','[]','[]','[]','2005-12-29T10:05:00.000Z');
    INSERT INTO idempotency_keys(world_id,idempotency_key,response_json,created_at)
      VALUES('legacy-world','legacy-key','{"accepted":true}','2005-12-29T10:05:00.000Z');
    INSERT INTO context_manifests(manifest_id,world_id,generation_id,base_commit_sequence,items_json,manifest_hash,created_at)
      VALUES('legacy-manifest','legacy-world','legacy-generation',2,'[]','legacy-hash','2005-12-29T10:05:00.000Z');
  `);
  db.close();
}

test('legacy schema upgrades all numbered migrations, preserves rows, and is idempotent on reopen', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-engine-migration-compat-'));
  const path = join(directory, 'legacy.sqlite');
  createLegacyDatabase(path);
  let store;
  t.after(() => {
    store?.close();
    rmSync(directory, { recursive: true, force: true });
  });

  store = new SQLiteStore(path);
  const eventColumns = store.db.prepare('PRAGMA table_info(world_events)').all().map((column) => column.name);
  const idempotencyColumns = store.db.prepare('PRAGMA table_info(idempotency_keys)').all().map((column) => column.name);
  const manifestColumns = store.db.prepare('PRAGMA table_info(context_manifests)').all().map((column) => column.name);
  assert.ok(eventColumns.includes('causal_links_json'));
  assert.ok(eventColumns.includes('commit_sequence'));
  assert.ok(eventColumns.includes('context_manifest_id'));
  assert.ok(eventColumns.includes('game_time_coordinate'));
  assert.ok(eventColumns.includes('time_advance_ms'));
  assert.ok(idempotencyColumns.includes('request_hash'));
  assert.ok(manifestColumns.includes('base_world_revision'));
  const migratedWorld = store.db.prepare('SELECT initial_game_time_coordinate,game_time_coordinate FROM worlds WHERE world_id=?').get('legacy-world');
  assert.deepEqual(migratedWorld, { initial_game_time_coordinate: 0, game_time_coordinate: 300000 });
  assert.deepEqual(
    store.db.prepare('SELECT event_id,game_time_coordinate,time_advance_ms FROM world_events WHERE world_id=? ORDER BY commit_sequence').all('legacy-world'),
    [
      { event_id: 'legacy-event-1', game_time_coordinate: 60000, time_advance_ms: 0 },
      { event_id: 'legacy-event-2', game_time_coordinate: 300000, time_advance_ms: 0 },
    ],
  );
  assert.deepEqual(
    store.db.prepare('SELECT event_id,commit_sequence FROM world_events WHERE world_id=? ORDER BY commit_sequence').all('legacy-world').map((row) => ({ event_id: row.event_id, commit_sequence: row.commit_sequence })),
    [{ event_id: 'legacy-event-1', commit_sequence: 1 }, { event_id: 'legacy-event-2', commit_sequence: 2 }],
  );
  assert.equal(store.db.prepare('SELECT response_json FROM idempotency_keys WHERE world_id=? AND idempotency_key=?').get('legacy-world', 'legacy-key').response_json, '{"accepted":true}');
  assert.equal(store.db.prepare('SELECT base_world_revision FROM context_manifests WHERE manifest_id=?').get('legacy-manifest').base_world_revision, 0);
  assert.deepEqual(store.db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((row) => row.version), [1, 2, 3, 4, 5, 6]);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='index' AND name='events_world_commit_sequence'").get().count, 1);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='mechanic_instances'").get().count, 1);

  store.close();
  store = new SQLiteStore(path);
  assert.deepEqual(
    store.db.prepare('SELECT event_id,commit_sequence FROM world_events WHERE world_id=? ORDER BY commit_sequence').all('legacy-world').map((row) => ({ event_id: row.event_id, commit_sequence: row.commit_sequence })),
    [{ event_id: 'legacy-event-1', commit_sequence: 1 }, { event_id: 'legacy-event-2', commit_sequence: 2 }],
  );
  assert.deepEqual(store.db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((row) => row.version), [1, 2, 3, 4, 5, 6]);
});

test('failed numbered migration rolls back its DDL and does not record the version', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-engine-migration-failure-'));
  const path = join(directory, 'state.sqlite');
  const initial = new SQLiteStore(path);
  initial.close();

  const setup = new DatabaseSync(path);
  setup.exec(`
    DROP TABLE mechanic_instances;
    DROP INDEX events_world_event_id;
    DELETE FROM schema_migrations WHERE version=5;
    CREATE TRIGGER reject_migration_five BEFORE INSERT ON schema_migrations
      WHEN NEW.version=5 BEGIN SELECT RAISE(ABORT, 'injected migration ledger failure'); END;
  `);
  setup.close();

  t.after(() => rmSync(directory, { recursive: true, force: true }));
  assert.throws(() => new SQLiteStore(path), /injected migration ledger failure/);

  const inspect = new DatabaseSync(path);
  assert.equal(inspect.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='mechanic_instances'").get().count, 0);
  assert.equal(inspect.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='index' AND name='events_world_event_id'").get().count, 0);
  assert.equal(inspect.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version=5').get().count, 0);
  inspect.exec('DROP TRIGGER reject_migration_five');
  inspect.close();

  const recovered = new SQLiteStore(path);
  assert.equal(recovered.db.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version=5').get().count, 1);
  assert.equal(recovered.db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='mechanic_instances'").get().count, 1);
  recovered.close();
});
