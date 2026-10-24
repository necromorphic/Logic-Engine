import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { createApiServer } from '../src/api/server.js';

const token = 'test-api-token-123456789';
const adminToken = 'test-admin-token-123456789';

const rules = {
  trust: {
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

async function fixture() {
  const store = new SQLiteStore(':memory:');
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
    assert.deepEqual(engine.store.getRelationshipPair('world-relationship-test', 'A', 'B').dimensions, {});
    assert.equal(engine.getState('world-relationship-test').world_revision, 1);
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
      (error) => error.code === 'RELATIONSHIP_EVIDENCE_NOT_ELIGIBLE',
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
