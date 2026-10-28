import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { ActorBindingService } from '../src/application/actor-bindings.js';
import { createApiServer } from '../src/api/server.js';

const TOKEN = 'test-token-long-enough-123456';
const ADMIN = 'admin-token-long-enough-123456';
const ADAPTER = 'adapter-token-long-enough-123456';
const DIGEST = 'a'.repeat(64);

const trustedPolicy = ({ authorized = true, provenanceRef = 'worldpack:test.pack@1', digest = DIGEST, authorizationRef = 'authoring-rule:initial-v1' } = {}) => () => ({
  authorized, provenance_ref: provenanceRef, provenance_digest: digest, authorization_ref: authorizationRef,
});

function seed(policy = trustedPolicy()) {
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store, { initialAcquisitionPolicy: policy });
  engine.createWorld({ world_id: 'w1', world_pack_id: 'test.pack', world_pack_version: '1', game_time: '2026-01-01T00:00:00Z' });
  engine.commitEvent('w1', {
    event_id: 'seed-facts', idempotency_key: 'seed-facts-key', turn_id: 'seed', event_type: 'action.completed', expected_revision: 0,
    effects: [
      { kind: 'entity.create', entity_id: 'npc-a', entity_type: 'character' },
      { kind: 'entity.create', entity_id: 'npc-b', entity_type: 'character' },
      { kind: 'fact.set', fact_id: 'fact-a', predicate: 'knows', value: 'secret-x' },
    ],
  });
  engine.createWorld({ world_id: 'w2', world_pack_id: 'other.pack', world_pack_version: '1', game_time: '2026-01-01T00:00:00Z' });
  engine.commitEvent('w2', { event_id: 'seed-other-world', idempotency_key: 'seed-other-world', turn_id: 'seed', event_type: 'action.completed', expected_revision: 0,
    effects: [{ kind: 'entity.create', entity_id: 'npc-c', entity_type: 'character' }, { kind: 'fact.set', fact_id: 'fact-b', predicate: 'knows', value: 'other-world' }] });
  const bindings = new ActorBindingService(engine);
  bindings.bind('w1', 'adapter-a', 'npc-a');
  return { store, engine, bindings };
}

const input = (overrides = {}) => ({
  world_id: 'w1', adapter_id: 'adapter-a', subject_id: 'npc-a', fact_id: 'fact-a',
  acquisition_kind: 'author_initial', idempotency_key: 'acq-key-1', expected_revision: 1,
  expected_commit_sequence: 1, ...overrides,
});

test('trusted Core assignment creates author_initial/imported projection and preserves provenance', () => {
  const { store, engine } = seed((context) => trustedPolicy({
    provenanceRef: context.acquisition_kind === 'imported' ? 'import:bundle-4' : 'worldpack:test.pack@1',
  })());
  try {
    const result = engine.recordInitialAcquisition(input());
    assert.equal(result.accepted, true);
    let rows = store.db.prepare('SELECT * FROM knowledge_acquisitions WHERE world_id=?').all('w1');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].subject_id, 'npc-a');
    assert.equal(rows[0].fact_id, 'fact-a');
    assert.equal(rows[0].acquisition_kind, 'author_initial');
    assert.equal(rows[0].provenance_ref, 'worldpack:test.pack@1');
    assert.equal(rows[0].provenance_digest, DIGEST);
    const imported = engine.recordInitialAcquisition(input({
      acquisition_kind: 'imported', idempotency_key: 'acq-key-2', expected_revision: 2, expected_commit_sequence: 2,
    }));
    assert.equal(imported.accepted, true);
    rows = store.db.prepare('SELECT acquisition_kind,provenance_ref FROM knowledge_acquisitions WHERE world_id=? ORDER BY acquisition_id').all('w1');
    assert.deepEqual(new Set(rows.map((row) => row.acquisition_kind)), new Set(['author_initial', 'imported']));
    assert.ok(rows.some((row) => row.provenance_ref === 'import:bundle-4'));
  } finally { store.close(); }
});

test('missing/denied or malformed trusted provenance cannot create an acquisition', () => {
  for (const policy of [trustedPolicy({ authorized: false }), trustedPolicy({ digest: 'not-a-digest' })]) {
    const { store, engine } = seed(policy);
    try {
      assert.throws(() => engine.recordInitialAcquisition(input()), { code: 'KNOWLEDGE_AUTHORITY_DENIED' });
      assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM knowledge_acquisitions').get().n, 0);
    } finally { store.close(); }
  }
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  try {
    assert.throws(() => engine.recordInitialAcquisition(input()), { code: 'KNOWLEDGE_AUTHORITY_REQUIRED' });
  } finally { store.close(); }
});

test('unknown/unbound subject, cross-world source, and unsupported acquisition kind fail closed', () => {
  const { store, engine } = seed();
  try {
    assert.throws(() => engine.recordInitialAcquisition(input({ subject_id: 'missing' })), { code: 'ACTOR_NOT_AUTHORIZED' });
    assert.throws(() => engine.recordInitialAcquisition(input({ adapter_id: 'unbound-adapter' })), { code: 'ACTOR_NOT_AUTHORIZED' });
    assert.throws(() => engine.recordInitialAcquisition(input({ fact_id: 'fact-b' })), { code: 'ACQUISITION_SOURCE_NOT_ELIGIBLE' });
    assert.throws(() => engine.recordInitialAcquisition(input({ world_id: 'w2' })), { code: 'ACTOR_NOT_AUTHORIZED' });
    assert.throws(() => engine.recordInitialAcquisition(input({ acquisition_kind: 'observed' })), { code: 'UNSUPPORTED_ACQUISITION_KIND' });
  } finally { store.close(); }
});

test('identical acquisition retry is idempotent; changed payload under the same key conflicts', () => {
  const { store, engine } = seed();
  try {
    const first = engine.recordInitialAcquisition(input());
    const replay = engine.recordInitialAcquisition(input());
    assert.equal(first.accepted, true);
    assert.equal(replay.idempotent_replay, true);
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM world_events WHERE event_type='knowledge.acquisition.initial'").get().n, 1);
    assert.throws(() => engine.recordInitialAcquisition(input({ acquisition_kind: 'imported' })), { code: 'IDEMPOTENCY_KEY_CONFLICT' });
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM knowledge_acquisitions').get().n, 1);
  } finally { store.close(); }
});

test('destroying the subject removes its acquisition from the active projection', () => {
  const { store, engine } = seed();
  try {
    engine.recordInitialAcquisition(input());
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM knowledge_acquisitions').get().n, 1);
    engine.commitEvent('w1', { idempotency_key: 'destroy-subject', turn_id: 'destroy', event_type: 'action.completed', expected_revision: 2,
      effects: [{ kind: 'entity.upsert', entity_id: 'npc-a', entity_type: 'character', status: 'destroyed', attributes: {} }] });
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM knowledge_acquisitions').get().n, 0);
  } finally { store.close(); }
});

test('rolling back the acquisition event revokes the assignment through the canonical lifecycle', () => {
  const { store, engine } = seed();
  try {
    const result = engine.recordInitialAcquisition(input());
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM knowledge_acquisitions').get().n, 1);
    const rollback = engine.rollbackEvent('w1', { root_event_id: result.event_id, idempotency_key: 'revoke-acquisition' });
    assert.equal(rollback.accepted, true);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM knowledge_acquisitions').get().n, 0);
  } finally { store.close(); }
});

test('rollback of source support removes the acquisition projection and rebuild does not restore it', () => {
  const { store, engine } = seed();
  try {
    engine.recordInitialAcquisition(input());
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM knowledge_acquisitions').get().n, 1);
    const rollback = engine.rollbackEvent('w1', { root_event_id: 'seed-facts', idempotency_key: 'rollback-seed' });
    assert.equal(rollback.accepted, true);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM knowledge_acquisitions').get().n, 0);
    store.rebuild('w1', store.world('w1').world_revision);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM knowledge_acquisitions').get().n, 0);
  } finally { store.close(); }
});

test('acquisition projection recovers from the canonical event log after store restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-acquisition-'));
  const database = join(directory, 'core.sqlite');
  try {
    let store = new SQLiteStore(database);
    let engine = new LogicEngine(store, { initialAcquisitionPolicy: trustedPolicy() });
    engine.createWorld({ world_id: 'w1', world_pack_id: 'test.pack', world_pack_version: '1', game_time: '2026-01-01T00:00:00Z' });
    engine.commitEvent('w1', { event_id: 'seed', idempotency_key: 'seed', turn_id: 'seed', event_type: 'action.completed', expected_revision: 0,
      effects: [{ kind: 'entity.create', entity_id: 'npc-a', entity_type: 'character' }, { kind: 'fact.set', fact_id: 'fact-a', predicate: 'knows', value: true }] });
    new ActorBindingService(engine).bind('w1', 'adapter-a', 'npc-a');
    engine.recordInitialAcquisition(input());
    store.close();

    store = new SQLiteStore(database);
    engine = new LogicEngine(store, { initialAcquisitionPolicy: trustedPolicy() });
    store.rebuild('w1', store.world('w1').world_revision);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM knowledge_acquisitions WHERE world_id=?').get('w1').n, 1);
    store.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('revoked actor binding blocks acquisition and no public acquisition-read route returns data', async (t) => {
  const { store, engine, bindings } = seed();
  try {
    bindings.revoke('w1', 'adapter-a', 'npc-a');
    assert.throws(() => engine.recordInitialAcquisition(input({ expected_revision: 2, expected_commit_sequence: 1 })), { code: 'ACTOR_NOT_AUTHORIZED' });
    const server = createApiServer({ engine, token: TOKEN, adminToken: ADMIN, adapterTokens: { 'adapter-a': ADAPTER } });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => { server.closeAllConnections(); server.close(); });
    const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/worlds/w1/knowledge-acquisitions`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.notEqual(response.status, 200);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM knowledge_acquisitions').get().n, 0);
  } finally { store.close(); }
});

test('generic HTTP event cannot forge a Core-authorized acquisition', async (t) => {
  const { store, engine } = seed();
  const server = createApiServer({ engine, token: TOKEN, adminToken: ADMIN, adapterTokens: { 'adapter-a': ADAPTER } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); store.close(); });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/worlds/w1/events`, {
    method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ idempotency_key: 'forged-acq', turn_id: 'x', event_type: 'action.completed', expected_revision: 1,
      effects: [{ kind: 'knowledge.acquire', acquisition_id: 'forged', subject_id: 'npc-a', fact_id: 'fact-a', acquisition_kind: 'author_initial', provenance_ref: 'forged', provenance_digest: DIGEST, authorization_ref: 'forged' }] }),
  });
  assert.equal(response.status, 403);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM knowledge_acquisitions').get().n, 0);
});
