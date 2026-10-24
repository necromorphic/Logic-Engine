import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { ActorBindingService } from '../src/application/actor-bindings.js';
import { AuthorizedReadService } from '../src/application/authorized-read-service.js';

function setup(t, fieldPolicy) {
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  const bindings = new ActorBindingService(engine);
  engine.createWorld({
    world_id: 'read-world',
    world_pack_id: 'test.world',
    world_pack_version: '1',
    game_time: '2026-01-01T00:00:00Z',
  });
  engine.commitEvent('read-world', {
    idempotency_key: 'seed-read-world',
    turn_id: 'seed-read-world',
    event_type: 'action.completed',
    expected_revision: 0,
    effects: [
      { kind: 'entity.create', entity_id: 'actor-a', entity_type: 'character', attributes: { name: 'Actor', secret: 'private' } },
      { kind: 'entity.create', entity_id: 'target-a', entity_type: 'character', attributes: { name: 'Target', secret: 'classified' } },
    ],
  });
  bindings.bind('read-world', 'adapter-a', 'actor-a');
  t.after(() => store.close());
  return {
    store,
    engine,
    bindings,
    service: new AuthorizedReadService(engine, bindings, fieldPolicy),
  };
}

const request = (overrides = {}) => ({
  worldId: 'read-world',
  adapterId: 'adapter-a',
  actorEntityId: 'actor-a',
  recipient: 'model',
  purpose: 'npc_decision',
  entityIds: ['target-a'],
  fields: ['entity_id', 'entity_type', 'attributes.name', 'attributes.secret'],
  ...overrides,
});

test('authorized read emits only fields explicitly allowed by trusted policy and preserves snapshot cursor', (t) => {
  const { service, engine, store } = setup(t, (context, entity, field) =>
    context.worldId === 'read-world'
      && context.actor.entity_id === 'actor-a'
      && context.recipient === 'model'
      && context.purpose === 'npc_decision'
      && field !== 'attributes.secret');
  const before = {
    revision: engine.getState('read-world').world_revision,
    sequence: store.currentCommitSequence('read-world'),
    events: store.events('read-world', true).length,
    audit: store.audit('read-world').length,
  };

  const result = service.readEntityFields(request());
  assert.equal(result.world_id, 'read-world');
  assert.equal(result.world_revision, before.revision);
  assert.equal(result.commit_sequence, before.sequence);
  assert.deepEqual(result.entities, [{
    entity_id: 'target-a',
    entity_type: 'character',
    'attributes.name': 'Target',
  }]);
  assert.equal(JSON.stringify(result).includes('classified'), false);
  assert.equal(engine.getState('read-world').world_revision, before.revision);
  assert.equal(store.currentCommitSequence('read-world'), before.sequence);
  assert.equal(store.events('read-world', true).length, before.events);
  assert.equal(store.audit('read-world').length, before.audit);
});

test('unknown, throwing, or non-true field-policy decisions fail closed', (t) => {
  const { service } = setup(t, () => { throw new Error('policy unavailable'); });
  assert.throws(
    () => service.readEntityFields(request()),
    (error) => error.code === 'READ_NOT_AVAILABLE' && error.status === 404,
  );
});

test('missing and fully withheld targets have the same externally safe error', (t) => {
  const { service } = setup(t, () => false);
  const denied = (() => {
    try { service.readEntityFields(request()); } catch (error) { return { code: error.code, status: error.status, message: error.message }; }
    return null;
  })();
  const missing = (() => {
    try { service.readEntityFields(request({ entityIds: ['not-present'] })); } catch (error) { return { code: error.code, status: error.status, message: error.message }; }
    return null;
  })();
  assert.deepEqual(denied, missing);
});

test('mixed visible and missing or withheld targets fail closed without returning a partial target set', (t) => {
  const { service } = setup(t, (context, entity, field) =>
    entity.entity_id === 'target-a' && field === 'entity_id');

  const capture = (overrides) => {
    try {
      return { result: service.readEntityFields(request(overrides)) };
    } catch (error) {
      return { error: { code: error.code, status: error.status, message: error.message } };
    }
  };

  const missingOnly = capture({ entityIds: ['not-present'] });
  const mixedMissing = capture({ entityIds: ['target-a', 'not-present'] });
  assert.deepEqual(mixedMissing, missingOnly);
  assert.equal(mixedMissing.result, undefined);

  const fullyWithheld = capture({ entityIds: ['actor-a'] });
  const mixedWithheld = capture({ entityIds: ['target-a', 'actor-a'] });
  assert.deepEqual(mixedWithheld, fullyWithheld);
  assert.equal(mixedWithheld.result, undefined);
});

test('actor binding is required and caller-supplied actor cannot replace the authenticated binding', (t) => {
  const { service } = setup(t, () => true);
  assert.throws(
    () => service.readEntityFields(request({ adapterId: 'adapter-b' })),
    (error) => error.code === 'ACTOR_NOT_AUTHORIZED',
  );
  assert.throws(
    () => service.readEntityFields(request({ actorEntityId: 'target-a' })),
    (error) => error.code === 'ACTOR_NOT_AUTHORIZED',
  );
});

test('unknown purpose and malformed target/field sets are rejected before reading', (t) => {
  const { service } = setup(t, () => true);
  assert.throws(() => service.readEntityFields(request({ purpose: 'anything-goes' })),
    (error) => error.code === 'INVALID_READ_PURPOSE');
  assert.throws(() => service.readEntityFields(request({ entityIds: ['target-a', 'target-a'] })),
    (error) => error.code === 'INVALID_READ_TARGETS');
  assert.throws(() => service.readEntityFields(request({ fields: ['attributes.secret\nleak'] })),
    (error) => error.code === 'INVALID_READ_FIELDS');
});
