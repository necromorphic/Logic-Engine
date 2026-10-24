import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { createApiServer } from '../src/api/server.js';
import { ProposalService } from '../src/application/proposals.js';
import { translateMechanicEffectIntents } from '../src/core/mechanic-effect-translator.js';

const TOKEN = 'test-token-long-enough-123456';
const ADAPTER = 'adapter-a-token-long-enough-123456';
const headers = {
  authorization: 'Bearer ' + TOKEN,
  'content-type': 'application/json',
  'x-adapter-id': 'adapter-a',
  'x-adapter-token': ADAPTER,
};
const json = (value) => JSON.stringify(value);

async function setup(t) {
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  const server = createApiServer({
    engine,
    token: TOKEN,
    adapterTokens: { 'adapter-a': ADAPTER },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.close(); store.close(); });
  return { base: 'http://127.0.0.1:' + server.address().port, store, engine };
}

async function createWorld(base, worldId) {
  return fetch(base + '/v1/worlds', {
    method: 'POST',
    headers,
    body: json({
      world_id: worldId,
      world_pack_id: 'test.world',
      world_pack_version: '1.0.0',
      game_time: '2026-01-01T00:00:00Z',
    }),
  });
}

test('mechanic intent API reports envelope errors before translation and rejects duplicate or empty batches without writes', async (t) => {
  const { base, store } = await setup(t);
  assert.equal((await createWorld(base, 'intent-audit-world')).status, 201);
  const beforeProposals = store.db.prepare('SELECT COUNT(*) AS n FROM event_proposals').get().n;
  const beforeAudit = store.db.prepare('SELECT COUNT(*) AS n FROM audit_entries').get().n;
  const url = base + '/v1/worlds/intent-audit-world/proposals';

  const post = (event, key) => fetch(url, {
    method: 'POST',
    headers,
    body: json({
      idempotency_key: key,
      source_text: 'Test mechanic intent validation.',
      event,
    }),
  });
  const intent = { effect_id: 'same-id', kind: 'create_entity', target_ref: 'mira', payload: { entity_type: 'character' } };

  const missingTurn = await post({
    event_type: 'action.completed',
    effect_intents: [{ ...intent, kind: 'unsupported_kind' }],
  }, 'missing-turn');
  assert.equal(missingTurn.status, 400);
  assert.equal((await missingTurn.json()).error.code, 'TURN_ID_REQUIRED');

  const missingType = await post({
    turn_id: 'turn-1',
    effect_intents: [{ ...intent, kind: 'unsupported_kind' }],
  }, 'missing-type');
  assert.equal(missingType.status, 400);
  assert.equal((await missingType.json()).error.code, 'EVENT_TYPE_REQUIRED');

  const duplicate = await post({
    turn_id: 'turn-2',
    event_type: 'action.completed',
    effect_intents: [intent, { ...intent, target_ref: 'other' }],
  }, 'duplicate-effect-id');
  assert.equal(duplicate.status, 400);
  assert.equal((await duplicate.json()).error.code, 'DUPLICATE_MECHANIC_EFFECT_ID');

  const empty = await post({
    turn_id: 'turn-3',
    event_type: 'action.completed',
    effect_intents: [],
  }, 'empty-intent-batch');
  assert.equal(empty.status, 400);
  assert.equal((await empty.json()).error.code, 'INVALID_MECHANIC_EFFECT_INTENT');

  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM event_proposals').get().n, beforeProposals);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM audit_entries').get().n, beforeAudit);
  assert.equal(store.world('intent-audit-world').world_revision, 0);
  assert.deepEqual(store.events('intent-audit-world', true), []);
});

test('persisted proposal event payload contains canonical effects and never raw mechanic intents', (t) => {
  const store = new SQLiteStore(':memory:');
  t.after(() => store.close());
  const engine = new LogicEngine(store);
  engine.createWorld({
    world_id: 'intent-persistence-world',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    game_time: '2026-01-01T00:00:00Z',
  });
  const proposals = new ProposalService(engine);
  const result = proposals.create('intent-persistence-world', {
    idempotency_key: 'persist-intent',
    source_text: 'Create Mira.',
    event: {
      turn_id: 'persist-turn',
      event_type: 'action.completed',
      effect_intents: [{
        effect_id: 'persist-effect',
        kind: 'create_entity',
        target_ref: 'mira',
        payload: { entity_type: 'character', attributes: { name: 'Mira' } },
      }],
    },
  }, 'adapter-a');

  const row = store.db.prepare('SELECT event_payload_json FROM event_proposals WHERE proposal_id=?').get(result.proposal_id);
  assert.ok(row);
  const persistedEvent = JSON.parse(row.event_payload_json);
  assert.equal(Object.hasOwn(persistedEvent, 'effect_intents'), false);
  assert.deepEqual(persistedEvent.effects, [{
    kind: 'entity.create',
    entity_id: 'mira',
    entity_type: 'character',
    attributes: { name: 'Mira' },
  }]);
});

test('mechanic intent translation rejects unsafe object keys in nested attributes and fact values', () => {
  const unsafeAttributes = JSON.parse('[{"effect_id":"unsafe-1","kind":"create_entity","target_ref":"mira","payload":{"entity_type":"character","attributes":{"__proto__":{"polluted":true}}}}]');
  assert.throws(
    () => translateMechanicEffectIntents(unsafeAttributes),
    (error) => error.code === 'INVALID_MECHANIC_EFFECT_INTENT',
  );

  const unsafeFactValue = JSON.parse('[{"effect_id":"unsafe-2","kind":"assert_fact","target_ref":"fact-1","payload":{"predicate":"status","value":{"nested":{"constructor":{"prototype":{"polluted":true}}}}}}]');
  assert.throws(
    () => translateMechanicEffectIntents(unsafeFactValue),
    (error) => error.code === 'INVALID_MECHANIC_EFFECT_INTENT',
  );
});

test('proposal allowlist preserves duration_proposal for Core TimePolicy validation', (t) => {
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  t.after(() => store.close());
  engine.createWorld({
    world_id: 'duration-proposal-allowlist-world',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    game_time: '2026-01-01T00:00:00Z',
  });
  const proposals = new ProposalService(engine);
  const beforeAudit = store.audit('duration-proposal-allowlist-world');

  assert.throws(() => proposals.create('duration-proposal-allowlist-world', {
    idempotency_key: 'duration-proposal-allowlist',
    source_text: 'Travel to the next district.',
    event: {
      turn_id: 'duration-proposal-allowlist-turn',
      event_type: 'travel.completed',
      duration_proposal: { category: 'walking' },
      effects: [],
    },
  }, 'adapter-a'), (error) => error.code === 'TIME_POLICY_REQUIRED');

  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM event_proposals').get().n, 0);
  assert.deepEqual(store.events('duration-proposal-allowlist-world', true), []);
  assert.deepEqual(store.audit('duration-proposal-allowlist-world'), beforeAudit);
  assert.equal(store.world('duration-proposal-allowlist-world').world_revision, 0);
});

test('proposal commit audit failure rolls back proposal, canonical event, markers, idempotency and audit atomically', (t) => {
  const store = new SQLiteStore(':memory:');
  t.after(() => store.close());
  const engine = new LogicEngine(store);
  engine.createWorld({
    world_id: 'proposal-commit-audit-rollback-world',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    game_time: '2026-01-01T00:00:00Z',
  });
  const proposals = new ProposalService(engine);
  const created = proposals.create('proposal-commit-audit-rollback-world', {
    idempotency_key: 'commit-audit-fault',
    source_text: '',
    event: {
      turn_id: 'commit-audit-fault-turn',
      event_type: 'action.completed',
      effects: [{
        kind: 'entity.create',
        entity_id: 'fault-target',
        entity_type: 'object',
        attributes: { marker: 'must-roll-back' },
      }],
    },
  }, 'adapter-a');
  proposals.approve('proposal-commit-audit-rollback-world', created.proposal_id);

  const beforeWorld = store.world('proposal-commit-audit-rollback-world');
  const beforeEvents = store.events('proposal-commit-audit-rollback-world', true);
  const beforeAudit = store.audit('proposal-commit-audit-rollback-world');
  const beforeProposal = store.db.prepare('SELECT * FROM event_proposals WHERE proposal_id=?').get(created.proposal_id);
  const beforeIdempotency = store.db.prepare('SELECT COUNT(*) AS n FROM idempotency_keys WHERE world_id = ?').get('proposal-commit-audit-rollback-world').n;
  store.db.exec(`
    CREATE TRIGGER fail_proposal_commit_audit
    BEFORE INSERT ON audit_entries
    WHEN NEW.action = 'proposal.committed'
    BEGIN SELECT RAISE(ABORT, 'injected proposal commit audit failure'); END;
  `);

  assert.throws(
    () => proposals.commit('proposal-commit-audit-rollback-world', created.proposal_id),
    /injected proposal commit audit failure/,
  );

  const afterWorld = store.world('proposal-commit-audit-rollback-world');
  const afterEvents = store.events('proposal-commit-audit-rollback-world', true);
  const afterAudit = store.audit('proposal-commit-audit-rollback-world');
  const afterProposal = store.db.prepare('SELECT * FROM event_proposals WHERE proposal_id=?').get(created.proposal_id);
  const afterIdempotency = store.db.prepare('SELECT COUNT(*) AS n FROM idempotency_keys WHERE world_id = ?').get('proposal-commit-audit-rollback-world').n;
  assert.equal(afterWorld.world_revision, beforeWorld.world_revision);
  assert.equal(afterWorld.commit_sequence, beforeWorld.commit_sequence);
  assert.deepEqual(afterEvents, beforeEvents);
  assert.deepEqual(afterAudit, beforeAudit);
  assert.equal(afterProposal.status, 'approved');
  assert.equal(afterProposal.committed_at, null);
  assert.equal(afterProposal.commit_result_json, null);
  assert.equal(afterIdempotency, beforeIdempotency);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM entities WHERE world_id = ? AND entity_id = ?').get('proposal-commit-audit-rollback-world', 'fault-target').n, 0);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM audit_entries WHERE action = ? AND target_id = ?').get('proposal.committed', created.proposal_id).n, 0);
});
