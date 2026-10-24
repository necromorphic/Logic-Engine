import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { createApiServer } from '../src/api/server.js';

const token = 'test-api-token-123456789';
const adminToken = 'test-admin-token-123456789';

const rules = {
  trust: {
    values: ['low', 'neutral', 'high'],
    allowClear: true,
    transitions: [
      { operation: 'set', from: null, to: 'low' },
      { operation: 'set', from: 'low', to: 'high' },
      { operation: 'set', from: null, to: 'neutral' },
      { operation: 'set', from: 'low', to: 'neutral' },
      { operation: 'set', from: 'neutral', to: 'high' },
      { operation: 'clear', from: 'low', to: null },
      { operation: 'clear', from: 'neutral', to: null },
      { operation: 'clear', from: 'high', to: null },
    ],
  },
  affinity: {
    values: ['low', 'high'],
    allowClear: true,
    transitions: [
      { operation: 'set', from: null, to: 'low' },
      { operation: 'set', from: 'low', to: 'high' },
      { operation: 'clear', from: 'low', to: null },
      { operation: 'clear', from: 'high', to: null },
    ],
  },
};

async function fixture(storagePath = ':memory:') {
  const store = new SQLiteStore(storagePath);
  const engine = new LogicEngine(store);
  engine.createWorld({
    world_id: 'world-relationship-test',
    world_pack_id: 'test-pack',
    world_pack_version: '1.0.0',
    game_time: '2005-12-29T12:00:00.000Z',
  });
  const seed = engine.commitEvent('world-relationship-test', {
    idempotency_key: 'seed-entities',
    turn_id: 'seed-entities',
    event_type: 'entity.create',
    expected_revision: 0,
    effects: [
      { kind: 'entity.create', entity_id: 'A', entity_type: 'character' },
      { kind: 'entity.create', entity_id: 'B', entity_type: 'character' },
    ],
  });
  engine.registerRuleModuleManifest({
    module_id: 'relationship-rules',
    version: '1.0.0',
    contract_version: '1.0.0',
    capabilities: [],
    operations: ['validate_transition'],
    input_schema: {},
    output_schema: {},
    failure_policy: 'fail_closed',
    compatibility: { core_contract_versions: ['1.0.0'] },
    metadata: {
      relationship_domain: {
        world_pack_id: 'test-pack',
        world_pack_version: '1.0.0',
        dimensions: rules,
      },
    },
  });
  return { store, engine, seed };
}

function transitionRequest(seed, overrides = {}) {
  return {
    subject_id: 'A',
    target_id: 'B',
    rule_module_id: 'relationship-rules',
    rule_module_version: '1.0.0',
    patch: { trust: 'low' },
    evidence_refs: ['event:' + seed.event_id],
    expected_revision: 1,
    expected_commit_sequence: 1,
    idempotency_key: 'relationship-write-1',
    ...overrides,
  };
}

test('admin-gated typed transition commits directed state, event, revision and audit atomically', async () => {
  const { store, engine, seed } = await fixture();
  try {
    const result = engine.commitRelationshipTransition('world-relationship-test', transitionRequest(seed));
    assert.equal(result.accepted, true);
    assert.equal(result.world_revision, 2);
    assert.equal(result.commit_sequence, 2);
    assert.equal(engine.store.getRelationshipPair('world-relationship-test', 'A', 'B').dimensions.trust, 'low');
    assert.deepEqual(engine.store.getRelationshipPair('world-relationship-test', 'B', 'A').dimensions, {});
    assert.equal(engine.getEvents('world-relationship-test').filter((event) => event.event_type === 'relationship.transition').length, 1);
    assert.ok(engine.getAudit('world-relationship-test').some((entry) => entry.target_id === result.event_id && entry.action === 'event.committed'));
  } finally {
    store.close();
  }
});

test('API rejects ordinary bearer without the separate admin credential and does not mutate state', async () => {
  const { store, engine, seed } = await fixture();
  const server = createApiServer({ engine, token, adminToken });
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const response = await fetch('http://127.0.0.1:' + port + '/v1/worlds/world-relationship-test/relationship-transitions', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify(transitionRequest(seed)),
    });
    assert.equal(response.status, 403);
    assert.equal(engine.store.getRelationshipPair('world-relationship-test', 'A', 'B').dimensions.trust, undefined);
    assert.equal(engine.getState('world-relationship-test').world_revision, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    store.close();
  }
});

test('Relationship transition route rejects missing, wrong, or standalone admin credentials without mutation', async () => {
  const { store, engine, seed } = await fixture();
  const server = createApiServer({ engine, token, adminToken });
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const url = 'http://127.0.0.1:' + port + '/v1/worlds/world-relationship-test/relationship-transitions';
    const body = JSON.stringify(transitionRequest(seed));
    const attempts = [
      { headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, expected: 403 },
      { headers: { authorization: 'Bearer ' + token, 'x-admin-token': 'wrong-admin-token', 'content-type': 'application/json' }, expected: 403 },
      { headers: { 'x-admin-token': adminToken, 'content-type': 'application/json' }, expected: 401 },
    ];
    for (const attempt of attempts) {
      const response = await fetch(url, { method: 'POST', headers: attempt.headers, body });
      assert.equal(response.status, attempt.expected);
      const payload = await response.json();
      assert.ok(payload.error);
      assert.equal(JSON.stringify(payload).includes('trust'), false);
      assert.equal(JSON.stringify(payload).includes('relationship'), false);
    }
    assert.equal(engine.getState('world-relationship-test').world_revision, 1);
    assert.deepEqual(engine.store.getRelationshipPair('world-relationship-test', 'A', 'B').dimensions, {});
    assert.equal(engine.getEvents('world-relationship-test').length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    store.close();
  }
});

test('HTTP idempotent retry returns the established transition without a second event', async () => {
  const { store, engine, seed } = await fixture();
  const server = createApiServer({ engine, token, adminToken });
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = 'http://127.0.0.1:' + server.address().port + '/v1/worlds/world-relationship-test/relationship-transitions';
    const request = {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + token,
        'x-admin-token': adminToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify(transitionRequest(seed)),
    };
    const first = await fetch(url, request);
    assert.equal(first.status, 201);
    const firstPayload = await first.json();
    assert.equal(firstPayload.commit_result.accepted, true);
    assert.equal(firstPayload.relationship.dimensions.trust, 'low');

    const retry = await fetch(url, request);
    assert.equal(retry.status, 200);
    const retryPayload = await retry.json();
    assert.equal(retryPayload.commit_result.idempotent_replay, true);
    assert.equal(retryPayload.commit_result.event_id, firstPayload.commit_result.event_id);
    assert.equal(engine.getEvents('world-relationship-test').length, 2);
    assert.equal(engine.getState('world-relationship-test').world_revision, 2);
    assert.equal(engine.getAudit('world-relationship-test').filter((entry) => entry.target_id === firstPayload.commit_result.event_id && entry.action === 'event.committed').length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    store.close();
  }
});

test('HTTP Relationship route rejects caller-supplied executor and provenance labels', async () => {
  const { store, engine, seed } = await fixture();
  const server = createApiServer({ engine, token, adminToken });
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = 'http://127.0.0.1:' + server.address().port + '/v1/worlds/world-relationship-test/relationship-transitions';
    const initialAuditCount = engine.getAudit('world-relationship-test').length;
    for (const extra of [
      { executor_type: 'admin_credential' },
      { origin: 'trusted_host' },
      { actor_id: 'administrator' },
      { provenance: 'verified' },
    ]) {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + token,
          'x-admin-token': adminToken,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ ...transitionRequest(seed), ...extra }),
      });
      assert.equal(response.status, 400);
      const payload = await response.json();
      assert.equal(payload.error.code, 'UNSUPPORTED_RELATIONSHIP_TRANSITION_FIELD');
      assert.equal(engine.getState('world-relationship-test').world_revision, 1);
      assert.deepEqual(store.getRelationshipPair('world-relationship-test', 'A', 'B').dimensions, {});
    }
    assert.equal(engine.getEvents('world-relationship-test').length, 1);
    assert.equal(engine.getAudit('world-relationship-test').length, initialAuditCount);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    store.close();
  }
});

test('admin route commits through the canonical event lifecycle and returns the current directed projection', async () => {
  const { store, engine, seed } = await fixture();
  const server = createApiServer({ engine, token, adminToken });
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const response = await fetch('http://127.0.0.1:' + port + '/v1/worlds/world-relationship-test/relationship-transitions', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + token,
        'x-admin-token': adminToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify(transitionRequest(seed)),
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.commit_result.accepted, true);
    assert.equal(body.relationship.dimensions.trust, 'low');
    assert.equal(body.relationship.subject_id, 'A');
    assert.equal(body.relationship.target_id, 'B');
    const event = engine.getEvents('world-relationship-test').find((item) => item.event_id === body.commit_result.event_id);
    assert.equal(event.effects[0].executor_type, 'admin_credential');
    assert.deepEqual(event.effects[0].evidence_refs, ['event:' + seed.event_id]);
    assert.equal(event.effects[0].rule_module_id, 'relationship-rules');
    assert.equal(event.effects[0].rule_module_version, '1.0.0');
    const audit = engine.getAudit('world-relationship-test').find((entry) => entry.target_id === body.commit_result.event_id && entry.action === 'event.committed');
    assert.equal(audit.payload.effects[0].executor_type, 'admin_credential');
    assert.deepEqual(audit.payload.effects[0].evidence_refs, ['event:' + seed.event_id]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    store.close();
  }
});

test('generic event preparation cannot smuggle a Relationship effect', async () => {
  const { store, engine, seed } = await fixture();
  try {
    assert.throws(
      () => engine.prepareEvent({
        idempotency_key: 'generic-relationship-attempt',
        turn_id: 'generic-relationship-attempt',
        event_type: 'relationship.transition',
        effects: [{
          kind: 'relationship.transition',
          subject_id: 'A',
          target_id: 'B',
          rule_module_id: 'relationship-rules',
          rule_module_version: '1.0.0',
          patch: { trust: 'low' },
          evidence_refs: ['event:' + seed.event_id],
          executor_type: 'admin_credential',
        }],
      }),
      (error) => error.code === 'UNSUPPORTED_EFFECT',
    );
  } finally {
    store.close();
  }
});

test('stale composite cursor and spoofed executor are rejected without mutation', async () => {
  const { store, engine, seed } = await fixture();
  try {
    assert.throws(
      () => engine.commitRelationshipTransition('world-relationship-test', transitionRequest(seed, { expected_commit_sequence: 0 })),
      (error) => error.code === 'COMMIT_SEQUENCE_CONFLICT' || error.code === 'REVISION_CONFLICT',
    );
    assert.throws(
      () => engine.commitRelationshipTransition('world-relationship-test', transitionRequest(seed, { executor_type: 'admin_credential' })),
      (error) => error.code === 'UNSUPPORTED_RELATIONSHIP_TRANSITION_FIELD',
    );
    assert.throws(
      () => engine.commitRelationshipTransition('world-relationship-test', transitionRequest(seed, { evidence_status: 'supported' })),
      (error) => error.code === 'UNSUPPORTED_RELATIONSHIP_TRANSITION_FIELD',
    );
    assert.deepEqual(engine.store.getRelationshipPair('world-relationship-test', 'A', 'B').dimensions, {});
    assert.equal(engine.getState('world-relationship-test').world_revision, 1);
  } finally {
    store.close();
  }
});

test('reusing a Relationship idempotency key with a different payload is rejected', async () => {
  const { store, engine, seed } = await fixture();
  try {
    const first = engine.commitRelationshipTransition('world-relationship-test', transitionRequest(seed, {
      idempotency_key: 'relationship-key-payload-bound',
    }));
    assert.equal(first.accepted, true);
    assert.throws(
      () => engine.commitRelationshipTransition('world-relationship-test', transitionRequest(seed, {
        patch: { trust: 'high' },
        idempotency_key: 'relationship-key-payload-bound',
      })),
      (error) => error.code === 'IDEMPOTENCY_KEY_CONFLICT',
    );
    assert.equal(engine.getEvents('world-relationship-test').filter((event) => event.event_type === 'relationship.transition').length, 1);
    assert.equal(engine.getState('world-relationship-test').world_revision, 2);
    assert.equal(store.getRelationshipPair('world-relationship-test', 'A', 'B').dimensions.trust, 'low');
  } finally {
    store.close();
  }
});

test('partial dimension patch preserves other dimensions and mixed invalid patch is atomic', async () => {
  const { store, engine, seed } = await fixture();
  try {
    engine.commitRelationshipTransition('world-relationship-test', transitionRequest(seed, {
      patch: { trust: 'low', affinity: 'low' },
      idempotency_key: 'relationship-two-dimensions',
    }));
    const updated = engine.commitRelationshipTransition('world-relationship-test', transitionRequest(seed, {
      patch: { trust: 'high' },
      expected_revision: 2,
      expected_commit_sequence: 2,
      idempotency_key: 'relationship-partial-trust-update',
    }));
    assert.equal(updated.accepted, true);
    assert.equal(store.getRelationshipPair('world-relationship-test', 'A', 'B').dimensions.trust, 'high');
    assert.equal(store.getRelationshipPair('world-relationship-test', 'A', 'B').dimensions.affinity, 'low');

    assert.throws(
      () => engine.commitRelationshipTransition('world-relationship-test', transitionRequest(seed, {
        patch: { trust: 'unsupported-value', affinity: 'high' },
        expected_revision: 3,
        expected_commit_sequence: 3,
        idempotency_key: 'relationship-mixed-invalid-patch',
      })),
      (error) => error.code === 'RELATIONSHIP_TRANSITION_REJECTED',
    );
    assert.equal(store.getRelationshipPair('world-relationship-test', 'A', 'B').dimensions.trust, 'high');
    assert.equal(store.getRelationshipPair('world-relationship-test', 'A', 'B').dimensions.affinity, 'low');
    assert.equal(engine.getState('world-relationship-test').world_revision, 3);
    assert.equal(store.currentCommitSequence('world-relationship-test'), 3);
  } finally {
    store.close();
  }
});

test('invalid mixed patch commits nothing and idempotent retry does not duplicate a transition', async () => {
  const { store, engine, seed } = await fixture();
  try {
    assert.throws(
      () => engine.commitRelationshipTransition('world-relationship-test', transitionRequest(seed, { patch: { trust: 'low', unsupported_dimension: 'yes' } })),
      (error) => error.code === 'RELATIONSHIP_TRANSITION_REJECTED',
    );
    assert.deepEqual(engine.store.getRelationshipPair('world-relationship-test', 'A', 'B').dimensions, {});
    assert.equal(engine.getState('world-relationship-test').world_revision, 1);

    const request = transitionRequest(seed);
    const first = engine.commitRelationshipTransition('world-relationship-test', request);
    const retry = engine.commitRelationshipTransition('world-relationship-test', request);
    assert.equal(retry.idempotent_replay, true);
    assert.equal(retry.event_id, first.event_id);
    assert.equal(engine.getEvents('world-relationship-test').filter((event) => event.event_type === 'relationship.transition').length, 1);
  } finally {
    store.close();
  }
});

test('source rollback invalidates a Relationship transition that cites the source', async () => {
  const { store, engine } = await fixture();
  try {
    const source = engine.commitEvent('world-relationship-test', { idempotency_key: 'source-event', turn_id: 'source-event', event_type: 'evidence.note', expected_revision: 1, effects: [] });
    const write = engine.commitRelationshipTransition('world-relationship-test', transitionRequest(source, { expected_revision: 2, expected_commit_sequence: 2, idempotency_key: 'relationship-from-source' }));
    const result = engine.rollbackEvent('world-relationship-test', { root_event_id: source.event_id, idempotency_key: 'rollback-source' });
    assert.ok(result.invalidated_event_ids.includes(write.event_id));
    assert.deepEqual(store.getRelationshipPair('world-relationship-test', 'A', 'B').dimensions, {});
  } finally { store.close(); }
});

test('explicit neutral, cleared and unset remain distinct across replay', async () => {
  const { store, engine, seed } = await fixture();
  try {
    assert.deepEqual(store.getRelationshipPair('world-relationship-test', 'A', 'B').dimensions, {});
    const neutral = engine.commitRelationshipTransition('world-relationship-test', transitionRequest(seed, {
      patch: { trust: 'neutral' },
      idempotency_key: 'relationship-explicit-neutral',
    }));
    assert.equal(store.getRelationshipPair('world-relationship-test', 'A', 'B').dimensions.trust, 'neutral');
    assert.deepEqual(store.getRelationshipPair('world-relationship-test', 'B', 'A').dimensions, {});

    const clear = engine.commitRelationshipTransition('world-relationship-test', transitionRequest(seed, {
      patch: { trust: { operation: 'clear' } },
      expected_revision: 2,
      expected_commit_sequence: 2,
      idempotency_key: 'relationship-neutral-clear',
    }));
    assert.deepEqual(store.getRelationshipPair('world-relationship-test', 'A', 'B').dimensions.trust, { status: 'cleared' });

    engine.rollbackEvent('world-relationship-test', {
      root_event_id: clear.event_id,
      idempotency_key: 'rollback-neutral-clear',
    });
    assert.equal(store.getRelationshipPair('world-relationship-test', 'A', 'B').dimensions.trust, 'neutral');

    engine.rollbackEvent('world-relationship-test', {
      root_event_id: neutral.event_id,
      idempotency_key: 'rollback-neutral-set',
    });
    assert.deepEqual(store.getRelationshipPair('world-relationship-test', 'A', 'B').dimensions, {});
    assert.deepEqual(store.getRelationshipPair('world-relationship-test', 'B', 'A').dimensions, {});
  } finally {
    store.close();
  }
});

test('clear remains distinct from unset and rollback restores the previous surviving value', async () => {
  const { store, engine, seed } = await fixture();
  try {
    const first = engine.commitRelationshipTransition('world-relationship-test', transitionRequest(seed));
    const clear = engine.commitRelationshipTransition('world-relationship-test', transitionRequest(seed, {
      patch: { trust: { operation: 'clear' } },
      expected_revision: 2,
      expected_commit_sequence: 2,
      idempotency_key: 'relationship-clear-1',
    }));
    assert.equal(engine.store.getRelationshipPair('world-relationship-test', 'A', 'B').dimensions.trust.status, 'cleared');
    const rollback = engine.rollbackEvent('world-relationship-test', {
      root_event_id: clear.event_id,
      idempotency_key: 'rollback-relationship-clear',
    });
    assert.deepEqual(rollback.invalidated_event_ids, [clear.event_id]);
    assert.equal(engine.store.getRelationshipPair('world-relationship-test', 'A', 'B').dimensions.trust, 'low');
    assert.ok(first.event_id);
  } finally {
    store.close();
  }
});

test('rejects unavailable rule versions, cross-world participants, and invalid evidence before mutation', async () => {
  const { store, engine, seed } = await fixture();
  try {
    assert.throws(
      () => engine.commitRelationshipTransition('world-relationship-test', transitionRequest(seed, { rule_module_version: '9.9.9' })),
      (error) => error.code === 'RELATIONSHIP_RULE_VERSION_NOT_FOUND',
    );
    engine.registerRuleModuleManifest({
      module_id: 'relationship-rules-wrong-pack',
      version: '1.0.0',
      contract_version: '1.0.0',
      capabilities: [],
      operations: ['validate_transition'],
      input_schema: {},
      output_schema: {},
      failure_policy: 'fail_closed',
      compatibility: { core_contract_versions: ['1.0.0'] },
      metadata: {
        relationship_domain: {
          world_pack_id: 'test-pack',
          world_pack_version: '9.9.9',
          dimensions: rules,
        },
      },
    });
    assert.throws(
      () => engine.commitRelationshipTransition('world-relationship-test', transitionRequest(seed, {
        rule_module_id: 'relationship-rules-wrong-pack',
      })),
      (error) => error.code === 'RELATIONSHIP_RULE_VERSION_INCOMPATIBLE',
    );

    engine.registerRuleModuleManifest({
      module_id: 'relationship-rules-alternative-support',
      version: '1.0.0',
      contract_version: '1.0.0',
      capabilities: [],
      operations: ['validate_transition'],
      input_schema: {},
      output_schema: {},
      failure_policy: 'fail_closed',
      compatibility: { core_contract_versions: ['1.0.0'] },
      metadata: {
        relationship_domain: {
          world_pack_id: 'test-pack',
          world_pack_version: '1.0.0',
          dimensions: rules,
          alternative_supports: { mode: 'independent' },
        },
      },
    });
    assert.throws(
      () => engine.commitRelationshipTransition('world-relationship-test', transitionRequest(seed, {
        rule_module_id: 'relationship-rules-alternative-support',
      })),
      (error) => error.code === 'RELATIONSHIP_RULE_VERSION_INCOMPATIBLE',
    );

    engine.createWorld({
      world_id: 'world-relationship-other',
      world_pack_id: 'test-pack',
      world_pack_version: '1.0.0',
      game_time: '2005-12-29T12:00:00.000Z',
    });
    engine.commitEvent('world-relationship-other', {
      idempotency_key: 'other-world-entity',
      turn_id: 'other-world-entity',
      event_type: 'entity.create',
      expected_revision: 0,
      effects: [{ kind: 'entity.create', entity_id: 'C', entity_type: 'character' }],
    });
    assert.throws(
      () => engine.commitRelationshipTransition('world-relationship-test', transitionRequest(seed, { target_id: 'C' })),
      (error) => ['RELATIONSHIP_PARTICIPANT_NOT_ELIGIBLE', 'INVALID_READ_SET_REFERENCE'].includes(error.code),
    );

    const evidence = engine.commitEvent('world-relationship-test', {
      idempotency_key: 'relationship-evidence-event',
      turn_id: 'relationship-evidence-event',
      event_type: 'evidence.note',
      expected_revision: 1,
      effects: [],
    });
    engine.rollbackEvent('world-relationship-test', {
      root_event_id: evidence.event_id,
      idempotency_key: 'rollback-evidence-event',
    });
    assert.throws(
      () => engine.commitRelationshipTransition('world-relationship-test', transitionRequest(seed, {
        expected_revision: 3,
        expected_commit_sequence: 2,
        evidence_refs: ['event:' + evidence.event_id],
      })),
      (error) => ['RELATIONSHIP_EVIDENCE_NOT_ELIGIBLE', 'INVALID_CAUSAL_REFERENCE'].includes(error.code),
    );
    assert.deepEqual(engine.store.getRelationshipPair('world-relationship-test', 'A', 'B').dimensions, {});
    assert.equal(engine.getState('world-relationship-test').world_revision, 3);
  } finally {
    store.close();
  }
});

test('event insert and audit failures roll back the entire Relationship transition', async () => {
  const { store, engine, seed } = await fixture();
  try {
    const request = transitionRequest(seed);
    store.db.exec(`CREATE TRIGGER fail_relationship_event_insert BEFORE INSERT ON world_events
      WHEN NEW.event_type='relationship.transition'
      BEGIN SELECT RAISE(ABORT, 'injected relationship event insert failure'); END;`);
    assert.throws(() => engine.commitRelationshipTransition('world-relationship-test', request), /injected relationship event insert failure/);
    store.db.exec('DROP TRIGGER fail_relationship_event_insert');
    assert.equal(engine.getEvents('world-relationship-test').length, 1);
    assert.equal(engine.getState('world-relationship-test').world_revision, 1);
    assert.deepEqual(store.getRelationshipPair('world-relationship-test', 'A', 'B').dimensions, {});

    store.db.exec(`CREATE TRIGGER fail_relationship_event_audit BEFORE INSERT ON audit_entries
      WHEN NEW.action='event.committed'
      BEGIN SELECT RAISE(ABORT, 'injected relationship audit failure'); END;`);
    assert.throws(() => engine.commitRelationshipTransition('world-relationship-test', request), /injected relationship audit failure/);
    store.db.exec('DROP TRIGGER fail_relationship_event_audit');
    assert.equal(engine.getEvents('world-relationship-test').length, 1);
    assert.equal(engine.getState('world-relationship-test').world_revision, 1);
    assert.deepEqual(store.getRelationshipPair('world-relationship-test', 'A', 'B').dimensions, {});

    const result = engine.commitRelationshipTransition('world-relationship-test', request);
    assert.equal(result.accepted, true);
    assert.equal(engine.getEvents('world-relationship-test').length, 2);
    assert.equal(engine.getState('world-relationship-test').world_revision, 2);
  } finally {
    store.close();
  }
});

test('projection and idempotency persistence failures roll back Relationship event, state, revision and audit', async () => {
  const { store, engine, seed } = await fixture();
  try {
    const request = transitionRequest(seed);
    const originalRebuild = store.rebuild;
    store.rebuild = () => { throw new Error('injected relationship projection failure'); };
    assert.throws(() => engine.commitRelationshipTransition('world-relationship-test', request), /injected relationship projection failure/);
    store.rebuild = originalRebuild;
    assert.equal(engine.getEvents('world-relationship-test').length, 1);
    assert.equal(engine.getState('world-relationship-test').world_revision, 1);
    assert.deepEqual(store.getRelationshipPair('world-relationship-test', 'A', 'B').dimensions, {});

    const originalSaveReplay = store.saveReplay;
    store.saveReplay = () => { throw new Error('injected relationship idempotency persistence failure'); };
    assert.throws(() => engine.commitRelationshipTransition('world-relationship-test', request), /injected relationship idempotency persistence failure/);
    store.saveReplay = originalSaveReplay;
    assert.equal(engine.getEvents('world-relationship-test').length, 1);
    assert.equal(engine.getState('world-relationship-test').world_revision, 1);
    assert.deepEqual(store.getRelationshipPair('world-relationship-test', 'A', 'B').dimensions, {});

    const result = engine.commitRelationshipTransition('world-relationship-test', request);
    assert.equal(result.accepted, true);
    assert.equal(engine.getEvents('world-relationship-test').length, 2);
    assert.equal(engine.getState('world-relationship-test').world_revision, 2);
    assert.equal(engine.getAudit('world-relationship-test').filter((entry) => entry.target_id === result.event_id && entry.action === 'event.committed').length, 1);
  } finally {
    store.close();
  }
});

test('Relationship projection survives store restart and deterministic rebuild from valid events', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-relationship-replay-'));
  const databasePath = join(directory, 'core.sqlite');
  let store;
  try {
    const fixtureState = await fixture(databasePath);
    store = fixtureState.store;
    const { engine, seed } = fixtureState;
    const result = engine.commitRelationshipTransition('world-relationship-test', transitionRequest(seed));
    assert.equal(result.accepted, true);
    store.close();
    store = null;

    const reopened = new SQLiteStore(databasePath);
    store = reopened;
    assert.equal(reopened.getRelationshipPair('world-relationship-test', 'A', 'B').dimensions.trust, 'low');
    assert.deepEqual(reopened.getRelationshipPair('world-relationship-test', 'B', 'A').dimensions, {});

    reopened.tx(() => reopened.rebuild('world-relationship-test', 2));
    assert.equal(reopened.getRelationshipPair('world-relationship-test', 'A', 'B').dimensions.trust, 'low');
    assert.deepEqual(reopened.getRelationshipPair('world-relationship-test', 'B', 'A').dimensions, {});
    assert.equal(reopened.db.prepare("SELECT COUNT(*) AS count FROM world_events WHERE world_id=? AND event_type='relationship.transition' AND validity='valid'").get('world-relationship-test').count, 1);
  } finally {
    if (store) store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('trusted state read pins world, entities and composite cursor across a concurrent writer', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-state-snapshot-race-'));
  const databasePath = join(directory, 'core.sqlite');
  let store;
  let concurrentStore;
  try {
    const fixtureState = await fixture(databasePath);
    store = fixtureState.store;
    store.db.exec('PRAGMA journal_mode=WAL');
    concurrentStore = new SQLiteStore(databasePath);
    const concurrentEngine = new LogicEngine(concurrentStore);
    const originalWorld = store.world.bind(store);
    let concurrentCommitDone = false;
    store.world = (worldId) => {
      const snapshotWorld = originalWorld(worldId);
      if (!concurrentCommitDone) {
        concurrentCommitDone = true;
        concurrentEngine.commitEvent(worldId, {
          idempotency_key: 'concurrent-state-snapshot-writer',
          turn_id: 'concurrent-state-snapshot-writer',
          event_type: 'entity.upsert',
          expected_revision: 1,
          expected_commit_sequence: 1,
          effects: [{ kind: 'entity.upsert', entity_id: 'A', entity_type: 'character', attributes: { concurrent_write: true } }],
        });
      }
      return snapshotWorld;
    };

    const snapshot = store.state('world-relationship-test');
    assert.equal(snapshot.world_revision, 1);
    assert.equal(snapshot.commit_sequence, 1);
    assert.equal(snapshot.entities.find((entity) => entity.entity_id === 'A').attributes.concurrent_write, undefined);

    store.world = originalWorld;
    const latest = store.state('world-relationship-test');
    assert.equal(latest.world_revision, 2);
    assert.equal(latest.commit_sequence, 2);
    assert.equal(latest.entities.find((entity) => entity.entity_id === 'A').attributes.concurrent_write, true);
  } finally {
    if (concurrentStore) concurrentStore.close();
    if (store) store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('trusted state read returns one composite freshness marker across rollback', async () => {
  const { store, engine, seed } = await fixture();
  try {
    const initial = engine.getState('world-relationship-test');
    assert.equal(initial.world_revision, 1);
    assert.equal(initial.commit_sequence, 1);
    const transition = engine.commitRelationshipTransition('world-relationship-test', transitionRequest(seed));
    const committed = engine.getState('world-relationship-test');
    assert.equal(committed.world_revision, 2);
    assert.equal(committed.commit_sequence, 2);
    assert.deepEqual(committed.entities.map((entity) => entity.entity_id), ['A', 'B']);
    engine.rollbackEvent('world-relationship-test', {
      root_event_id: transition.event_id,
      idempotency_key: 'rollback-state-snapshot-transition',
    });
    const rolledBack = engine.getState('world-relationship-test');
    assert.equal(rolledBack.world_revision, 3);
    assert.equal(rolledBack.commit_sequence, 2);
    assert.deepEqual(rolledBack.entities.map((entity) => entity.entity_id), ['A', 'B']);
  } finally {
    store.close();
  }
});

test('rollback invalidates later transition dependent on the same directed pair and rebuilds surviving state', async () => {
  const { store, engine, seed } = await fixture();
  try {
    const first = engine.commitRelationshipTransition('world-relationship-test', transitionRequest(seed));
    const second = engine.commitRelationshipTransition('world-relationship-test', transitionRequest(seed, {
      patch: { trust: 'high' },
      expected_revision: 2,
      expected_commit_sequence: 2,
      idempotency_key: 'relationship-write-2',
    }));
    assert.equal(engine.store.getRelationshipPair('world-relationship-test', 'A', 'B').dimensions.trust, 'high');
    const rollback = engine.rollbackEvent('world-relationship-test', {
      root_event_id: first.event_id,
      idempotency_key: 'rollback-relationship-first',
    });
    assert.ok(rollback.invalidated_event_ids.includes(first.event_id));
    assert.ok(rollback.invalidated_event_ids.includes(second.event_id));
    assert.deepEqual(engine.store.getRelationshipPair('world-relationship-test', 'A', 'B').dimensions, {});
    assert.equal(engine.getState('world-relationship-test').world_revision, 4);
    assert.equal(engine.store.currentCommitSequence('world-relationship-test'), 3);
  } finally {
    store.close();
  }
});


test('projection rebuild preserves the exact historical rule-version pin when its module is unavailable', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-engine-relationship-version-pin-'));
  const storagePath = join(directory, 'state.sqlite');
  let store;
  try {
    const fixtureResult = await fixture(storagePath);
    store = fixtureResult.store;
    const { engine, seed } = fixtureResult;
    const committed = engine.commitRelationshipTransition('world-relationship-test', transitionRequest(seed));
    assert.equal(committed.accepted, true);

    const committedEvent = engine.getEvents('world-relationship-test')
      .find((event) => event.event_id === committed.event_id);
    assert.equal(committedEvent.effects[0].rule_module_id, 'relationship-rules');
    assert.equal(committedEvent.effects[0].rule_module_version, '1.0.0');
    store.close();
    store = null;

    const reopenedStore = new SQLiteStore(storagePath);
    store = reopenedStore;
    const reopenedEngine = new LogicEngine(reopenedStore);

    // Projection-only rebuild consumes the already-committed effect. It must
    // preserve the historical pin, not resolve the current/latest module.
    reopenedStore.db.prepare(
      'DELETE FROM rule_module_manifests WHERE module_id=? AND version=?',
    ).run('relationship-rules', '1.0.0');
    reopenedStore.rebuild('world-relationship-test', 2);

    const eventAfterRestart = reopenedEngine.getEvents('world-relationship-test')
      .find((event) => event.event_id === committed.event_id);
    assert.equal(eventAfterRestart.effects[0].rule_module_id, 'relationship-rules');
    assert.equal(eventAfterRestart.effects[0].rule_module_version, '1.0.0');

    const projectionPin = reopenedStore.db.prepare(
      'SELECT rule_module_id, rule_module_version, last_event_id FROM relationships WHERE world_id=? AND subject_id=? AND target_id=? AND dimension=?',
    ).get('world-relationship-test', 'A', 'B', 'trust');
    assert.deepEqual(projectionPin, {
      rule_module_id: 'relationship-rules',
      rule_module_version: '1.0.0',
      last_event_id: committed.event_id,
    });
    assert.equal(reopenedStore.getRelationshipPair('world-relationship-test', 'A', 'B').dimensions.trust, 'low');
  } finally {
    store?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
