import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { InitialKnowledgeAcquisitionService } from '../src/application/initial-knowledge-acquisition.js';

function setup(t) {
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  engine.createWorld({
    world_id: 'knowledge-world',
    world_pack_id: 'test.world',
    world_pack_version: '1',
    game_time: '2026-01-01T00:00:00Z',
  });
  engine.commitEvent('knowledge-world', {
    event_id: 'source-event',
    idempotency_key: 'seed-knowledge-world',
    turn_id: 'seed',
    event_type: 'action.completed',
    expected_revision: 0,
    effects: [
      { kind: 'entity.create', entity_id: 'npc-a', entity_type: 'character', attributes: {} },
      { kind: 'entity.create', entity_id: 'npc-b', entity_type: 'character', attributes: {} },
      { kind: 'fact.set', fact_id: 'fact-secret-location', predicate: 'location', subject_ref: 'place-1', value: 'north warehouse' },
    ],
  });
  t.after(() => store.close());
  return { store, engine, service: new InitialKnowledgeAcquisitionService(engine) };
}

function request(overrides = {}) {
  return {
    world_id: 'knowledge-world',
    subject_entity_id: 'npc-a',
    source_fact_id: 'fact-secret-location',
    source_event_id: 'source-event',
    acquisition_kind: 'author_initial',
    expected_revision: 1,
    expected_commit_sequence: 1,
    idempotency_key: 'assign-npc-a-location',
    ...overrides,
  };
}

function acquisitions(store) {
  return store.db.prepare('SELECT * FROM knowledge_acquisitions WHERE world_id=? ORDER BY acquisition_id').all('knowledge-world');
}

test('Core records author_initial acquisition with subject, exact source claim, provenance and snapshot cursor', (t) => {
  const { store, service, engine } = setup(t);
  const result = service.assign(request());
  assert.equal(result.accepted, true);
  assert.equal(result.idempotent_replay, false);
  assert.equal(engine.getState('knowledge-world').world_revision, 2);
  const rows = acquisitions(store);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.subject_entity_id, 'npc-a');
  assert.equal(row.source_fact_id, 'fact-secret-location');
  assert.equal(row.source_event_id, 'source-event');
  assert.equal(row.source_predicate, 'location');
  assert.equal(JSON.parse(row.source_value_json), 'north warehouse');
  assert.equal(row.acquisition_kind, 'author_initial');
  assert.equal(row.observed_world_revision, 1);
  assert.equal(row.observed_commit_sequence, 1);
  assert.equal(row.status, 'active');
  assert.equal(row.visibility_status, 'unclassified');
  const provenance = JSON.parse(row.provenance_json);
  assert.equal(provenance.issuer, 'core_trusted_authoring');
  assert.equal(provenance.source_event_id, 'source-event');
  assert.match(provenance.source_claim_sha256, /^[a-f0-9]{64}$/);
  assert.equal(provenance.import, undefined);
});

test('imported acquisition fails closed until a trusted Core import-source resolver exists', (t) => {
  const { store, service } = setup(t);
  assert.throws(() => service.assign(request({
    acquisition_kind: 'imported',
    import_id: 'worldpack-yakuza',
    import_version: '2005.12',
    import_sha256: 'a'.repeat(64),
    idempotency_key: 'import-npc-a-location',
  })), (error) => error.code === 'UNSUPPORTED_TRUSTED_IMPORT_SOURCE' && error.status === 409);
  assert.equal(acquisitions(store).length, 0);
});

test('exact idempotency replay returns original acquisition without a second event', (t) => {
  const { store, service, engine } = setup(t);
  const first = service.assign(request());
  const second = service.assign(request());
  assert.equal(second.idempotent_replay, true);
  assert.equal(second.event_id, first.event_id);
  assert.equal(store.events('knowledge-world', true).length, 2);
  assert.equal(acquisitions(store).length, 1);
  assert.equal(engine.getState('knowledge-world').world_revision, 2);
});

test('same acquisition identity cannot be duplicated under a different idempotency key', (t) => {
  const { service } = setup(t);
  service.assign(request());
  assert.throws(() => service.assign(request({ idempotency_key: 'different-key' })),
    (error) => error.code === 'INITIAL_ACQUISITION_ALREADY_EXISTS' && error.status === 409);
});

test('unknown/destroyed subjects and unknown or invalid source claims fail closed', (t) => {
  const { service, engine } = setup(t);
  assert.throws(() => service.assign(request({ subject_entity_id: 'missing-npc' })),
    (error) => error.code === 'INITIAL_ACQUISITION_SUBJECT_NOT_ELIGIBLE');
  engine.commitEvent('knowledge-world', {
    idempotency_key: 'destroy-npc-b', turn_id: 'destroy-npc-b', event_type: 'action.completed',
    expected_revision: 1,
    effects: [{ kind: 'entity.upsert', entity_id: 'npc-b', entity_type: 'character', status: 'destroyed', attributes: {} }],
  });
  assert.throws(() => service.assign(request({ subject_entity_id: 'npc-b', expected_revision: 2, expected_commit_sequence: 2 })),
    (error) => error.code === 'INITIAL_ACQUISITION_SUBJECT_NOT_ELIGIBLE');
  assert.throws(() => service.assign(request({ source_fact_id: 'missing-fact', expected_revision: 2, expected_commit_sequence: 2 })),
    (error) => error.code === 'INITIAL_ACQUISITION_SOURCE_NOT_ELIGIBLE');
  assert.throws(() => service.assign(request({ source_event_id: 'missing-event', expected_revision: 2, expected_commit_sequence: 2 })),
    (error) => error.code === 'INITIAL_ACQUISITION_SOURCE_NOT_ELIGIBLE');
});

test('stale revision or commit sequence rejects assignment before recording an event', (t) => {
  const { service, store, engine } = setup(t);
  assert.throws(() => service.assign(request({ expected_commit_sequence: 0 })),
    (error) => error.code === 'INITIAL_ACQUISITION_SNAPSHOT_STALE');
  assert.throws(() => service.assign(request({ expected_revision: 0 })),
    (error) => error.code === 'INITIAL_ACQUISITION_SNAPSHOT_STALE');
  assert.equal(engine.getState('knowledge-world').world_revision, 1);
  assert.equal(store.events('knowledge-world', true).length, 1);
  assert.equal(acquisitions(store).length, 0);
});

test('ordinary event preparation cannot grant knowledge or forge provenance', (t) => {
  const { engine, store } = setup(t);
  assert.throws(() => engine.commitEvent('knowledge-world', {
    idempotency_key: 'forged-knowledge', turn_id: 'forged', event_type: 'knowledge.initial_acquisition',
    expected_revision: 1,
    effects: [{
      kind: 'knowledge.acquire', acquisition_id: 'acq_' + '0'.repeat(64),
      subject_entity_id: 'npc-a', source_fact_id: 'fact-secret-location', source_event_id: 'source-event',
      source_predicate: 'location', source_value: 'north warehouse', acquisition_kind: 'author_initial',
      provenance: { issuer: 'model', acquisition_kind: 'author_initial', source_fact_id: 'fact-secret-location',
        source_event_id: 'source-event', source_claim_sha256: '0'.repeat(64) },
      observed_world_revision: 1, observed_commit_sequence: 1, visibility_status: 'unclassified',
    }],
  }), (error) => error.code === 'UNSUPPORTED_EFFECT' && error.status === 403);
  assert.equal(store.events('knowledge-world', true).length, 1);
  assert.equal(acquisitions(store).length, 0);
});

test('rolling back the exact source event invalidates the acquisition event and rebuilds projection empty', (t) => {
  const { store, service, engine } = setup(t);
  const acquired = service.assign(request());
  const rollback = engine.rollbackEvent('knowledge-world', {
    root_event_id: 'source-event', idempotency_key: 'rollback-source-event',
  });
  assert.equal(rollback.accepted, true);
  assert.ok(rollback.invalidated_event_ids.includes('source-event'));
  assert.ok(rollback.invalidated_event_ids.includes(acquired.event_id));
  assert.equal(acquisitions(store).length, 0);
  const events = store.events('knowledge-world', true);
  assert.equal(events.find((event) => event.event_id === acquired.event_id).validity, 'invalidated');
});

test('rolling back acquisition removes its active projection but preserves event history', (t) => {
  const { store, service, engine } = setup(t);
  const acquired = service.assign(request());
  const rollback = engine.rollbackEvent('knowledge-world', {
    root_event_id: acquired.event_id, idempotency_key: 'rollback-acquisition',
  });
  assert.equal(rollback.accepted, true);
  assert.equal(acquisitions(store).length, 0);
  assert.equal(store.events('knowledge-world', true).find((event) => event.event_id === acquired.event_id).validity, 'retracted');
});

test('destroyed subject remains historical but is not an active acquisition target', (t) => {
  const { store, service, engine } = setup(t);
  service.assign(request());
  engine.commitEvent('knowledge-world', {
    idempotency_key: 'destroy-subject-after-acquisition', turn_id: 'destroy-subject',
    event_type: 'action.completed', expected_revision: 2,
    effects: [{ kind: 'entity.upsert', entity_id: 'npc-a', entity_type: 'character', status: 'destroyed', attributes: {} }],
  });
  const rows = acquisitions(store);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'subject_unavailable');
});

test('unsupported acquisition kinds and unverified import paths are rejected', (t) => {
  const { service, store } = setup(t);
  assert.throws(() => service.assign(request({ acquisition_kind: 'rumor' })),
    (error) => error.code === 'UNSUPPORTED_ACQUISITION_KIND');
  assert.throws(() => service.assign(request({
    acquisition_kind: 'imported', import_id: 'pack', import_version: '1', import_sha256: 'bad',
  })), (error) => error.code === 'UNSUPPORTED_TRUSTED_IMPORT_SOURCE');
  assert.equal(acquisitions(store).length, 0);
});

test('cross-world source references cannot be used for an acquisition', (t) => {
  const { service, engine, store } = setup(t);
  engine.createWorld({
    world_id: 'foreign-world', world_pack_id: 'test.world', world_pack_version: '1',
    game_time: '2026-01-01T00:00:00Z',
  });
  engine.commitEvent('foreign-world', {
    event_id: 'foreign-source-event', idempotency_key: 'foreign-seed', turn_id: 'foreign-seed',
    event_type: 'action.completed', expected_revision: 0,
    effects: [{ kind: 'fact.set', fact_id: 'foreign-fact', predicate: 'claim', value: 'foreign' }],
  });
  assert.throws(() => service.assign(request({
    source_fact_id: 'foreign-fact',
    source_event_id: 'foreign-source-event',
  })), (error) => error.code === 'INITIAL_ACQUISITION_SOURCE_NOT_ELIGIBLE');
  assert.equal(acquisitions(store).length, 0);
});

test('Core commit independently rejects a forged source digest even through the privileged internal path', (t) => {
  const { store, engine } = setup(t);
  const effect = {
    kind: 'knowledge.acquire',
    acquisition_id: 'acq_' + 'b'.repeat(64),
    subject_entity_id: 'npc-a',
    source_fact_id: 'fact-secret-location',
    source_event_id: 'source-event',
    source_predicate: 'location',
    source_value: 'north warehouse',
    acquisition_kind: 'author_initial',
    provenance: {
      issuer: 'core_trusted_authoring',
      acquisition_kind: 'author_initial',
      source_fact_id: 'fact-secret-location',
      source_event_id: 'source-event',
      source_claim_sha256: '0'.repeat(64),
    },
    observed_world_revision: 1,
    observed_commit_sequence: 1,
    visibility_status: 'unclassified',
  };
  const prepared = engine.prepareEvent({
    idempotency_key: 'forged-digest',
    turn_id: 'forged-digest',
    event_type: 'knowledge.initial_acquisition',
    expected_revision: 1,
    expected_commit_sequence: 1,
    caused_by: ['source-event'],
    depends_on: ['source-event'],
    read_set: ['entity:npc-a', 'fact:fact-secret-location'],
    causal_links: [
      { relation: 'READS_ENTITY', target_id: 'npc-a' },
      { relation: 'READS_CLAIM', target_id: 'fact-secret-location' },
    ],
    effects: [effect],
  }, { allowKnowledgeAcquisition: true });
  assert.throws(() => store.commit('knowledge-world', prepared, { allowKnowledgeAcquisition: true }),
    (error) => error.code === 'INVALID_INITIAL_ACQUISITION_PROVENANCE');
  assert.equal(acquisitions(store).length, 0);
  assert.equal(engine.getState('knowledge-world').world_revision, 1);
});

test('acquisition projection persists across Core database reopen', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-engine-acquisition-'));
  const path = join(directory, 'core.sqlite');
  let store;
  t.after(() => {
    try { store?.close(); } catch {}
    rmSync(directory, { recursive: true, force: true });
  });
  store = new SQLiteStore(path);
  const engine = new LogicEngine(store);
  engine.createWorld({
    world_id: 'knowledge-world',
    world_pack_id: 'test.world',
    world_pack_version: '1',
    game_time: '2026-01-01T00:00:00Z',
  });
  engine.commitEvent('knowledge-world', {
    event_id: 'source-event', idempotency_key: 'seed-knowledge-world', turn_id: 'seed',
    event_type: 'action.completed', expected_revision: 0,
    effects: [
      { kind: 'entity.create', entity_id: 'npc-a', entity_type: 'character', attributes: {} },
      { kind: 'fact.set', fact_id: 'fact-secret-location', predicate: 'location', subject_ref: 'place-1', value: 'north warehouse' },
    ],
  });
  const service = new InitialKnowledgeAcquisitionService(engine);
  service.assign(request());
  store.close();
  store = new SQLiteStore(path);
  const rows = store.db.prepare('SELECT acquisition_id,subject_entity_id,source_event_id,status,visibility_status FROM knowledge_acquisitions WHERE world_id=?')
    .all('knowledge-world');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].subject_entity_id, 'npc-a');
  assert.equal(rows[0].source_event_id, 'source-event');
  assert.equal(rows[0].status, 'active');
  assert.equal(rows[0].visibility_status, 'unclassified');
});
