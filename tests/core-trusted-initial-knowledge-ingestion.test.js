import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';

const sourceBytes = (assignments = [{ subject_id: 'npc-a', fact_id: 'fact-a' }]) => JSON.stringify({
  schema_version: 1,
  world_pack_id: 'test.world',
  world_pack_version: '1.0.0',
  source_kind: 'author_initial',
  source_ref: 'authoring:test.world@1.0.0',
  authorization_ref: 'rule:initial-knowledge-v1',
  assignments,
});

const trustedRegistry = (bytes) => {
  const source = JSON.parse(bytes);
  return [{
    world_pack_id: source.world_pack_id,
    world_pack_version: source.world_pack_version,
    source_kind: source.source_kind,
    source_ref: source.source_ref,
    authorization_ref: source.authorization_ref,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }];
};

function setup(t, assignments) {
  const store = new SQLiteStore(':memory:');
  t.after(() => store.close());
  const bytes = sourceBytes(assignments);
  const engine = new LogicEngine(store, { trustedInitialKnowledgeSources: trustedRegistry(bytes) });
  engine.createWorld({
    world_id: 'world-a',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    game_time: '2026-01-01T00:00:00Z',
  });
  engine.commitEvent('world-a', {
    event_id: 'author-seed',
    idempotency_key: 'author-seed-key',
    turn_id: 'author-seed',
    event_type: 'action.completed',
    expected_revision: 0,
    effects: [
      { kind: 'entity.create', entity_id: 'npc-a', entity_type: 'character' },
      { kind: 'entity.create', entity_id: 'npc-b', entity_type: 'character' },
      { kind: 'fact.set', fact_id: 'fact-a', predicate: 'secret', value: 'source-backed-value' },
    ],
  });
  return { store, engine, bytes };
}

test('trusted authoring source commits subject-specific assignments into the canonical event log', (t) => {
  const { store, engine, bytes } = setup(t);
  const result = engine.recordTrustedInitialKnowledgeSource({
    world_id: 'world-a',
    source_bytes: bytes,
    idempotency_key: 'author-source-1',
    expected_revision: 1,
    expected_commit_sequence: 1,
  });
  assert.equal(result.accepted, true);
  const event = store.events('world-a').find((item) => item.event_id === result.event_id);
  assert.equal(event.event_type, 'knowledge.acquisition.initial');
  assert.equal(event.effects.length, 1);
  assert.equal(event.effects[0].kind, 'knowledge.acquire');
  assert.equal(event.effects[0].subject_id, 'npc-a');
  assert.equal(event.effects[0].fact_id, 'fact-a');
  assert.equal(event.effects[0].provenance_digest, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM knowledge_acquisitions WHERE world_id=?').get('world-a').n, 1);
});

test('trusted source ingestion rejects stale cursors, wrong world pack, and unapproved bytes', (t) => {
  const { store, engine, bytes } = setup(t);
  assert.throws(() => engine.recordTrustedInitialKnowledgeSource({
    world_id: 'world-a', source_bytes: bytes, idempotency_key: 'stale-source',
    expected_revision: 0, expected_commit_sequence: 0,
  }), { code: 'REVISION_CONFLICT' });
  assert.throws(() => engine.recordTrustedInitialKnowledgeSource({
    world_id: 'world-a', source_bytes: bytes.replace('fact-a', 'fact-b'), idempotency_key: 'tampered-source',
    expected_revision: 1, expected_commit_sequence: 1,
  }), { code: 'TRUSTED_SOURCE_NOT_APPROVED' });
  engine.createWorld({
    world_id: 'world-b', world_pack_id: 'other.world', world_pack_version: '1.0.0',
    game_time: '2026-01-01T00:00:00Z',
  });
  assert.throws(() => engine.recordTrustedInitialKnowledgeSource({
    world_id: 'world-b', source_bytes: bytes, idempotency_key: 'wrong-pack-source',
    expected_revision: 0, expected_commit_sequence: 0,
  }), { code: 'TRUSTED_SOURCE_WORLD_PACK_MISMATCH' });
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM knowledge_acquisitions').get().n, 0);
});

test('identical trusted source ingestion retries are idempotent', (t) => {
  const { store, engine, bytes } = setup(t);
  const input = {
    world_id: 'world-a', source_bytes: bytes, idempotency_key: 'author-source-idempotent',
    expected_revision: 1, expected_commit_sequence: 1,
  };
  const first = engine.recordTrustedInitialKnowledgeSource(input);
  const replay = engine.recordTrustedInitialKnowledgeSource(input);
  assert.equal(first.accepted, true);
  assert.equal(replay.idempotent_replay, true);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM world_events WHERE event_type='knowledge.acquisition.initial'").get().n, 1);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM knowledge_acquisitions').get().n, 1);
});

test('source rollback invalidates the acquisition and rebuild does not restore it', (t) => {
  const { store, engine, bytes } = setup(t);
  engine.recordTrustedInitialKnowledgeSource({
    world_id: 'world-a', source_bytes: bytes, idempotency_key: 'author-source-before-rollback',
    expected_revision: 1, expected_commit_sequence: 1,
  });
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM knowledge_acquisitions').get().n, 1);
  const rollback = engine.rollbackEvent('world-a', {
    root_event_id: 'author-seed', idempotency_key: 'rollback-author-seed',
  });
  assert.equal(rollback.accepted, true);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM knowledge_acquisitions').get().n, 0);
  store.rebuild('world-a', store.world('world-a').world_revision);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM knowledge_acquisitions').get().n, 0);
});

test('imported assignments load only through the deployment-owned allowlisted file importer', (t) => {
  const { store, bytes } = setup(t);
  const importedBytes = bytes.replace('"author_initial"', '"imported"');
  const dir = mkdtempSync(join(tmpdir(), 'logic-trusted-import-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const sourcePath = join(dir, 'approved-import.json');
  writeFileSync(sourcePath, importedBytes);
  const registry = trustedRegistry(importedBytes).map((entry) => ({ ...entry, source_path: sourcePath }));
  const engine = new LogicEngine(store, { trustedInitialKnowledgeSources: registry });

  assert.throws(() => engine.recordTrustedInitialKnowledgeSource({
    world_id: 'world-a', source_bytes: importedBytes, idempotency_key: 'imported-direct-bytes',
    expected_revision: 1, expected_commit_sequence: 1,
  }), { code: 'UNSUPPORTED_TRUSTED_SOURCE_KIND' });
  const result = engine.recordTrustedImportedKnowledgeSource({
    world_id: 'world-a', source_ref: 'authoring:test.world@1.0.0', idempotency_key: 'imported-source',
    expected_revision: 1, expected_commit_sequence: 1,
  });
  assert.equal(result.accepted, true);
  const acquisition = store.db.prepare('SELECT acquisition_kind,provenance_ref FROM knowledge_acquisitions WHERE world_id=?').get('world-a');
  assert.deepEqual(acquisition, { acquisition_kind: 'imported', provenance_ref: 'authoring:test.world@1.0.0' });
});

test('trusted file importer rejects tampered bytes and caller-selected paths without mutation', (t) => {
  const { store, bytes } = setup(t);
  const importedBytes = bytes.replace('"author_initial"', '"imported"');
  const dir = mkdtempSync(join(tmpdir(), 'logic-trusted-import-tamper-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const sourcePath = join(dir, 'approved-import.json');
  writeFileSync(sourcePath, importedBytes);
  const registry = trustedRegistry(importedBytes).map((entry) => ({ ...entry, source_path: sourcePath }));
  const engine = new LogicEngine(store, { trustedInitialKnowledgeSources: registry });

  assert.throws(() => engine.recordTrustedImportedKnowledgeSource({
    world_id: 'world-a', source_ref: '../approved-import.json', idempotency_key: 'import-path-traversal',
    expected_revision: 1, expected_commit_sequence: 1,
  }), { code: 'TRUSTED_IMPORT_SOURCE_NOT_CONFIGURED' });
  writeFileSync(sourcePath, importedBytes.replace('fact-a', 'fact-b'));
  assert.throws(() => engine.recordTrustedImportedKnowledgeSource({
    world_id: 'world-a', source_ref: 'authoring:test.world@1.0.0', idempotency_key: 'import-tampered-bytes',
    expected_revision: 1, expected_commit_sequence: 1,
  }), { code: 'TRUSTED_SOURCE_NOT_APPROVED' });
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM knowledge_acquisitions WHERE world_id=?').get('world-a').n, 0);
});

test('ordinary event commits cannot forge acquisition effects', (t) => {
  const { store, engine } = setup(t);
  assert.throws(() => engine.commitEvent('world-a', {
    idempotency_key: 'forged-acquisition',
    turn_id: 'forged',
    event_type: 'action.completed',
    expected_revision: 1,
    effects: [{
      kind: 'knowledge.acquire',
      acquisition_id: 'forged-acq',
      subject_id: 'npc-a',
      fact_id: 'fact-a',
      acquisition_kind: 'author_initial',
      provenance_ref: 'forged-source',
      provenance_digest: 'a'.repeat(64),
      authorization_ref: 'forged-rule',
    }],
  }), { code: 'UNSUPPORTED_EFFECT' });
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM knowledge_acquisitions').get().n, 0);
});


test('rolling back the acquisition event itself removes it from the rebuilt projection', (t) => {
  const { store, engine, bytes } = setup(t);
  const acquired = engine.recordTrustedInitialKnowledgeSource({
    world_id: 'world-a',
    source_bytes: bytes,
    idempotency_key: 'rollback-acquisition-event',
    expected_revision: 1,
    expected_commit_sequence: 1,
  });
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM knowledge_acquisitions WHERE world_id=?').get('world-a').n, 1);

  const rollback = engine.rollbackEvent('world-a', {
    root_event_id: acquired.event_id,
    idempotency_key: 'rollback-acquisition-event-root',
  });
  assert.equal(rollback.accepted, true);
  assert.ok(rollback.invalidated_event_ids.includes(acquired.event_id));
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM knowledge_acquisitions WHERE world_id=?').get('world-a').n, 0);

  store.rebuild('world-a', store.world('world-a').world_revision);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM knowledge_acquisitions WHERE world_id=?').get('world-a').n, 0);

  const retry = engine.recordTrustedInitialKnowledgeSource({
    world_id: 'world-a',
    source_bytes: bytes,
    idempotency_key: 'rollback-acquisition-event',
    expected_revision: 1,
    expected_commit_sequence: 1,
  });
  assert.equal(retry.idempotent_replay, true);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM knowledge_acquisitions WHERE world_id=?').get('world-a').n, 0,
    'an idempotent retry must not resurrect an acquisition that was subsequently rolled back');
});

test('rolling back one of two independent acquisitions preserves the other source', (t) => {
  const { store } = setup(t);
  const sourceA = sourceBytes().replace('authoring:test.world@1.0.0', 'authoring:test.world@source-a')
    .replace('rule:initial-knowledge-v1', 'rule:initial-knowledge-source-a');
  const sourceB = sourceBytes().replace('authoring:test.world@1.0.0', 'authoring:test.world@source-b')
    .replace('rule:initial-knowledge-v1', 'rule:initial-knowledge-source-b');
  const engine = new LogicEngine(store, {
    trustedInitialKnowledgeSources: [...trustedRegistry(sourceA), ...trustedRegistry(sourceB)],
  });

  const first = engine.recordTrustedInitialKnowledgeSource({
    world_id: 'world-a', source_bytes: sourceA, idempotency_key: 'independent-source-a',
    expected_revision: 1, expected_commit_sequence: 1,
  });
  const cursor = engine.getSnapshot('world-a');
  const second = engine.recordTrustedInitialKnowledgeSource({
    world_id: 'world-a', source_bytes: sourceB, idempotency_key: 'independent-source-b',
    expected_revision: cursor.world_revision, expected_commit_sequence: cursor.commit_sequence,
  });
  assert.notEqual(first.event_id, second.event_id);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM knowledge_acquisitions WHERE world_id=? AND subject_id=? AND fact_id=?')
    .get('world-a', 'npc-a', 'fact-a').n, 2);

  const rollback = engine.rollbackEvent('world-a', {
    root_event_id: first.event_id,
    idempotency_key: 'rollback-only-source-a',
  });
  assert.equal(rollback.accepted, true);
  assert.ok(rollback.invalidated_event_ids.includes(first.event_id));
  assert.ok(!rollback.invalidated_event_ids.includes(second.event_id));

  const remaining = store.db.prepare('SELECT acquisition_id,event_id,provenance_ref FROM knowledge_acquisitions WHERE world_id=? AND subject_id=? AND fact_id=?')
    .all('world-a', 'npc-a', 'fact-a');
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].event_id, second.event_id);
  assert.equal(remaining[0].provenance_ref, 'authoring:test.world@source-b');

  store.rebuild('world-a', store.world('world-a').world_revision);
  const recovered = store.db.prepare('SELECT acquisition_id,event_id,provenance_ref FROM knowledge_acquisitions WHERE world_id=? AND subject_id=? AND fact_id=?')
    .all('world-a', 'npc-a', 'fact-a');
  assert.deepEqual(recovered, remaining);
});


test('acquisition rollback survives database restart and projection recovery', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'logic-acquisition-recovery-'));
  const dbPath = join(dir, 'core.sqlite');
  let store = new SQLiteStore(dbPath);
  t.after(() => {
    store?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const bytes = sourceBytes();
  const engine = new LogicEngine(store, { trustedInitialKnowledgeSources: trustedRegistry(bytes) });
  engine.createWorld({
    world_id: 'world-recovery',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    game_time: '2026-01-01T00:00:00Z',
  });
  engine.commitEvent('world-recovery', {
    event_id: 'recovery-seed',
    idempotency_key: 'recovery-seed',
    turn_id: 'recovery-seed',
    event_type: 'action.completed',
    expected_revision: 0,
    effects: [
      { kind: 'entity.create', entity_id: 'npc-a', entity_type: 'character' },
      { kind: 'fact.set', fact_id: 'fact-a', predicate: 'secret', value: 'source-backed-value' },
    ],
  });
  const acquired = engine.recordTrustedInitialKnowledgeSource({
    world_id: 'world-recovery', source_bytes: bytes, idempotency_key: 'recovery-acquire',
    expected_revision: 1, expected_commit_sequence: 1,
  });
  const rollback = engine.rollbackEvent('world-recovery', {
    root_event_id: acquired.event_id, idempotency_key: 'recovery-rollback-acquisition',
  });
  assert.equal(rollback.accepted, true);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM knowledge_acquisitions WHERE world_id=?').get('world-recovery').n, 0);

  store.close();
  store = new SQLiteStore(dbPath);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM knowledge_acquisitions WHERE world_id=?').get('world-recovery').n, 0);
  store.rebuild('world-recovery', store.world('world-recovery').world_revision);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM knowledge_acquisitions WHERE world_id=?').get('world-recovery').n, 0);
});
