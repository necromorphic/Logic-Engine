import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { loadTrustedWorldPackCatalog } from '../src/application/world-pack-catalog.js';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'logic-world-pack-catalog-'));
  const artifactPath = join(directory, 'test.world-1.0.0.json');
  const catalogPath = join(directory, 'catalog.json');
  const artifact = {
    world_pack_id: 'test.world',
    version: '1.0.0',
    schema_version: 'catalog-pin-test',
  };
  const artifactBytes = Buffer.from(JSON.stringify(artifact, null, 2) + '\n');
  writeFileSync(artifactPath, artifactBytes);
  writeFileSync(catalogPath, JSON.stringify({
    schema_version: 1,
    entries: [{
      world_pack_id: artifact.world_pack_id,
      version: artifact.version,
      artifact_path: 'test.world-1.0.0.json',
      sha256: digest(artifactBytes),
    }],
  }, null, 2) + '\n');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { directory, artifactPath, catalogPath, artifactBytes };
}

test('trusted World Pack catalog resolves only exact ID/version and pins the artifact digest to a created world', (t) => {
  const { catalogPath, artifactBytes } = fixture(t);
  const catalog = loadTrustedWorldPackCatalog(catalogPath);
  const entry = catalog.resolve('test.world', '1.0.0');
  assert.equal(entry.sha256, digest(artifactBytes));
  assert.throws(() => catalog.resolve('test.world', '2.0.0'), (error) => error.code === 'WORLD_PACK_NOT_TRUSTED');

  const store = new SQLiteStore(':memory:');
  t.after(() => store.close());
  const engine = new LogicEngine(store, { worldPackCatalog: catalog });
  const created = engine.createWorld({
    world_id: 'trusted-catalog-world',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    game_time: '2026-01-01T00:00:00Z',
  });
  assert.equal(created.world_pack_digest, digest(artifactBytes));
  const audit = engine.getAudit('trusted-catalog-world');
  assert.equal(audit[0].payload.world_pack_digest, digest(artifactBytes));
});

test('world creation rolls back the world row when the creation audit cannot be written', (t) => {
  const { catalogPath } = fixture(t);
  const store = new SQLiteStore(':memory:');
  t.after(() => store.close());
  store.db.exec(`
    CREATE TRIGGER fail_world_created_audit
    BEFORE INSERT ON audit_entries
    WHEN NEW.action = 'world.created'
    BEGIN
      SELECT RAISE(ABORT, 'forced audit failure');
    END;
  `);
  const engine = new LogicEngine(store, { worldPackCatalog: loadTrustedWorldPackCatalog(catalogPath) });
  assert.throws(() => engine.createWorld({
    world_id: 'world-audit-rollback',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    game_time: '2026-01-01T00:00:00Z',
  }), /forced audit failure/);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM worlds WHERE world_id = ?')
    .get('world-audit-rollback').count, 0);
});

test('trusted World Pack catalog rejects modified artifact bytes', (t) => {
  const { catalogPath, artifactPath } = fixture(t);
  writeFileSync(artifactPath, readFileSync(artifactPath, 'utf8').replace('catalog-pin-test', 'modified'));
  assert.throws(() => loadTrustedWorldPackCatalog(catalogPath), (error) => error.message === 'WORLD_PACK_ARTIFACT_DIGEST_MISMATCH');
});

test('trusted World Pack catalog rejects an artifact changed after startup validation', (t) => {
  const { catalogPath, artifactPath } = fixture(t);
  const catalog = loadTrustedWorldPackCatalog(catalogPath);
  writeFileSync(artifactPath, readFileSync(artifactPath, 'utf8').replace('catalog-pin-test', 'modified'));
  assert.throws(
    () => catalog.resolve('test.world', '1.0.0'),
    (error) => error.code === 'WORLD_PACK_ARTIFACT_DIGEST_MISMATCH',
  );
});

test('trusted World Pack catalog rejects path traversal and duplicate identities', (t) => {
  const { catalogPath, directory, artifactBytes } = fixture(t);
  const valid = JSON.parse(readFileSync(catalogPath, 'utf8'));
  valid.entries[0].artifact_path = '../outside.json';
  writeFileSync(catalogPath, JSON.stringify(valid));
  assert.throws(() => loadTrustedWorldPackCatalog(catalogPath), (error) => error.code === 'WORLD_PACK_ARTIFACT_PATH_INVALID');

  const artifactPath = join(directory, 'test.world-1.0.0.json');
  const duplicate = {
    schema_version: 1,
    entries: [
      { world_pack_id: 'test.world', version: '1.0.0', artifact_path: 'test.world-1.0.0.json', sha256: digest(artifactBytes) },
      { world_pack_id: 'test.world', version: '1.0.0', artifact_path: 'test.world-1.0.0.json', sha256: digest(artifactBytes) },
    ],
  };
  writeFileSync(catalogPath, JSON.stringify(duplicate));
  assert.throws(() => loadTrustedWorldPackCatalog(catalogPath), (error) => error.message === 'WORLD_PACK_CATALOG_DUPLICATE_ENTRY');
});
