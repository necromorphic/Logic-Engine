import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { createApiServer } from '../src/api/server.js';

const TOKEN = 'test-token-long-enough-123456';
const ADMIN = 'admin-token-long-enough-123456';
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const headers = { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' };
const json = (body) => JSON.stringify(body);

async function setup(t) {
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  const server = createApiServer({ engine, token: TOKEN, adminToken: ADMIN });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.close(); store.close(); });
  engine.createWorld({
    world_id: 'knowledge-world', world_pack_id: 'test.world',
    world_pack_version: '1', game_time: '2026-01-01T00:00:00Z',
  });
  const seedEvent = engine.commitEvent('knowledge-world', {
    idempotency_key: 'seed-knowledge-world', turn_id: 'seed', event_type: 'action.completed',
    expected_revision: 0,
    effects: [
      { kind: 'entity.create', entity_id: 'npc-a', entity_type: 'character', attributes: { name: 'A' } },
      { kind: 'entity.create', entity_id: 'npc-b', entity_type: 'character', attributes: { name: 'B' } },
      { kind: 'fact.set', fact_id: 'fact-secret', subject_ref: 'npc-a', predicate: 'holds_secret', value: true },
    ],
  });
  return { base: 'http://127.0.0.1:' + server.address().port, engine, seedEventId: seedEvent.event_id };
}

test('initial knowledge assignment is admin-gated and records author/import provenance in Core events', async (t) => {
  const { base, engine } = await setup(t);
  const url = base + '/v1/worlds/knowledge-world/initial-knowledge';
  const body = {
    idempotency_key: 'initial-npc-a-secret',
    expected_revision: 1,
    expected_commit_sequence: 1,
    subject_id: 'npc-a',
    fact_id: 'fact-secret',
    acquisition_kind: 'author_initial',
    source_ref: 'world-pack:characters/npc-a/initial-knowledge',
    source_sha256: SHA_A,
  };

  const denied = await fetch(url, { method: 'POST', headers, body: json(body) });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error.code, 'ADMIN_REQUIRED');

  const response = await fetch(url, {
    method: 'POST', headers: { ...headers, 'x-admin-token': ADMIN }, body: json(body),
  });
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.acquisition.subject_id, 'npc-a');
  assert.equal(result.acquisition.fact_id, 'fact-secret');
  assert.equal(result.acquisition.acquisition_kind, 'author_initial');
  assert.equal(result.acquisition.source_sha256, SHA_A);
  assert.equal(result.acquisition.validity, 'valid');
  assert.equal(result.idempotent_replay, false);

  const events = engine.getEvents('knowledge-world', true);
  const stored = events.find((event) => event.event_id === result.acquisition.event_id);
  assert.ok(stored);
  assert.equal(stored.validity, 'valid');
  assert.deepEqual(stored.effects, [{
    kind: 'knowledge.acquire',
    subject_id: 'npc-a',
    fact_id: 'fact-secret',
    acquisition_kind: 'author_initial',
    source_ref: 'world-pack:characters/npc-a/initial-knowledge',
    source_sha256: SHA_A,
    authority: 'admin_credential',
  }]);

  const replay = await fetch(url, {
    method: 'POST', headers: { ...headers, 'x-admin-token': ADMIN }, body: json(body),
  });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).idempotent_replay, true);
  assert.equal(engine.getEvents('knowledge-world', true).filter((event) =>
    event.effects.some((effect) => effect.kind === 'knowledge.acquire')).length, 1);
});

test('imported knowledge is a separate, explicitly sourced acquisition and exact duplicates are rejected', async (t) => {
  const { base, engine } = await setup(t);
  const url = base + '/v1/worlds/knowledge-world/initial-knowledge';
  const body = {
    idempotency_key: 'import-npc-a-secret',
    expected_revision: 1,
    expected_commit_sequence: 1,
    subject_id: 'npc-a',
    fact_id: 'fact-secret',
    acquisition_kind: 'imported',
    source_ref: 'import:campaign-bundle/characters/npc-a/knowledge.json',
    source_sha256: SHA_B,
  };
  const first = await fetch(url, {
    method: 'POST', headers: { ...headers, 'x-admin-token': ADMIN }, body: json(body),
  });
  assert.equal(first.status, 201);
  assert.equal((await first.json()).acquisition.acquisition_kind, 'imported');

  const duplicate = await fetch(url, {
    method: 'POST',
    headers: { ...headers, 'x-admin-token': ADMIN },
    body: json({ ...body, idempotency_key: 'different-key', expected_revision: 2, expected_commit_sequence: 2 }),
  });
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).error.code, 'KNOWLEDGE_ACQUISITION_ALREADY_EXISTS');
  assert.equal(engine.getEvents('knowledge-world', true).filter((event) =>
    event.effects.some((effect) => effect.kind === 'knowledge.acquire')).length, 1);
});

test('generic event and proposal-shaped calls cannot forge a knowledge acquisition', async (t) => {
  const { base, engine } = await setup(t);
  assert.throws(() => engine.prepareEvent({
    idempotency_key: 'forged-knowledge', turn_id: 'model-turn', event_type: 'action.completed',
    effects: [{
      kind: 'knowledge.acquire', subject_id: 'npc-a', fact_id: 'fact-secret',
      acquisition_kind: 'author_initial', source_ref: 'claimed-source', source_sha256: SHA_A,
      authority: 'admin_credential',
    }],
  }), (error) => error.code === 'UNSUPPORTED_EFFECT');

  const response = await fetch(base + '/v1/worlds/knowledge-world/initial-knowledge', {
    method: 'POST', headers, body: json({
      idempotency_key: 'forged-knowledge', subject_id: 'npc-a', fact_id: 'fact-secret',
      acquisition_kind: 'author_initial', source_ref: 'claimed-source', source_sha256: SHA_A,
    }),
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'ADMIN_REQUIRED');
  assert.equal(engine.getEvents('knowledge-world', true).every((event) =>
    !event.effects.some((effect) => effect.kind === 'knowledge.acquire')), true);
});

test('assignment rejects unknown subject, cross-world source and malformed provenance', async (t) => {
  const { base, engine } = await setup(t);
  const url = base + '/v1/worlds/knowledge-world/initial-knowledge';
  const good = {
    idempotency_key: 'bad-subject', expected_revision: 1, expected_commit_sequence: 1,
    subject_id: 'missing-actor', fact_id: 'fact-secret', acquisition_kind: 'author_initial',
    source_ref: 'world-pack:initial', source_sha256: SHA_A,
  };
  const missingSubject = await fetch(url, {
    method: 'POST', headers: { ...headers, 'x-admin-token': ADMIN }, body: json(good),
  });
  assert.equal(missingSubject.status, 409);
  assert.equal((await missingSubject.json()).error.code, 'KNOWLEDGE_SUBJECT_NOT_ELIGIBLE');

  engine.createWorld({
    world_id: 'other-knowledge-world', world_pack_id: 'test.world',
    world_pack_version: '1', game_time: '2026-01-01T00:00:00Z',
  });
  engine.commitEvent('other-knowledge-world', {
    idempotency_key: 'seed-other-world-fact', turn_id: 'other-seed', event_type: 'action.completed',
    expected_revision: 0,
    effects: [{ kind: 'fact.set', fact_id: 'fact-only-in-other-world', predicate: 'imported_claim', value: true }],
  });
  const missingFact = await fetch(url, {
    method: 'POST', headers: { ...headers, 'x-admin-token': ADMIN },
    body: json({ ...good, idempotency_key: 'bad-fact', subject_id: 'npc-a', fact_id: 'fact-only-in-other-world' }),
  });
  assert.equal(missingFact.status, 404);
  assert.equal((await missingFact.json()).error.code, 'KNOWLEDGE_SOURCE_NOT_FOUND');

  const malformedDigest = await fetch(url, {
    method: 'POST', headers: { ...headers, 'x-admin-token': ADMIN },
    body: json({ ...good, idempotency_key: 'bad-digest', subject_id: 'npc-a', source_sha256: 'not-a-digest' }),
  });
  assert.equal(malformedDigest.status, 400);
  assert.equal((await malformedDigest.json()).error.code, 'INVALID_KNOWLEDGE_PROVENANCE');
  assert.equal(engine.getEvents('knowledge-world', true).every((event) =>
    !event.effects.some((effect) => effect.kind === 'knowledge.acquire')), true);
});

test('source rollback invalidates dependent initial acquisition through the existing Core lifecycle', async (t) => {
  const { base, engine, seedEventId } = await setup(t);
  const response = await fetch(base + '/v1/worlds/knowledge-world/initial-knowledge', {
    method: 'POST',
    headers: { ...headers, 'x-admin-token': ADMIN },
    body: json({
      idempotency_key: 'initial-before-source-rollback',
      expected_revision: 1,
      expected_commit_sequence: 1,
      subject_id: 'npc-a',
      fact_id: 'fact-secret',
      acquisition_kind: 'author_initial',
      source_ref: 'world-pack:characters/npc-a/initial-knowledge',
      source_sha256: SHA_A,
    }),
  });
  assert.equal(response.status, 201);
  const result = await response.json();
  const rollback = engine.rollbackEvent('knowledge-world', {
    root_event_id: seedEventId,
    idempotency_key: 'rollback-knowledge-source',
  });
  assert.ok(rollback);
  const events = engine.getEvents('knowledge-world', true);
  const acquisitionEvent = events.find((event) => event.event_id === result.acquisition.event_id);
  assert.ok(acquisitionEvent);
  assert.notEqual(acquisitionEvent.validity, 'valid');
});

test('rolling back an assignment event revokes that acquisition without deleting its audit history', async (t) => {
  const { base, engine } = await setup(t);
  const response = await fetch(base + '/v1/worlds/knowledge-world/initial-knowledge', {
    method: 'POST',
    headers: { ...headers, 'x-admin-token': ADMIN },
    body: json({
      idempotency_key: 'initial-before-assignment-rollback',
      expected_revision: 1,
      expected_commit_sequence: 1,
      subject_id: 'npc-a',
      fact_id: 'fact-secret',
      acquisition_kind: 'author_initial',
      source_ref: 'world-pack:characters/npc-a/initial-knowledge',
      source_sha256: SHA_A,
    }),
  });
  assert.equal(response.status, 201);
  const result = await response.json();
  const rollback = engine.rollbackEvent('knowledge-world', {
    root_event_id: result.acquisition.event_id,
    idempotency_key: 'rollback-initial-assignment',
  });
  assert.ok(rollback);
  const historical = engine.getEvents('knowledge-world', true)
    .find((event) => event.event_id === result.acquisition.event_id);
  assert.ok(historical);
  assert.notEqual(historical.validity, 'valid');
});
