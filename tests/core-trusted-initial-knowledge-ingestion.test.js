import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

test('imported assignments remain unsupported until a real importer is connected', (t) => {
  const bytes = sourceBytes();
  const importedBytes = bytes.replace('"author_initial"', '"imported"');
  const { store } = setup(t);
  const engine = new LogicEngine(store, { trustedInitialKnowledgeSources: trustedRegistry(importedBytes) });
  assert.throws(() => engine.recordTrustedInitialKnowledgeSource({
    world_id: 'world-a', source_bytes: importedBytes, idempotency_key: 'imported-source',
    expected_revision: 1, expected_commit_sequence: 1,
  }), { code: 'UNSUPPORTED_TRUSTED_SOURCE_KIND' });
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM knowledge_acquisitions').get().n, 0);
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
