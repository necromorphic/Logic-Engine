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

test('actor binding revoked during field-policy evaluation prevents content return', (t) => {
  let bindingsRef;
  const { service, bindings } = setup(t, (_context, _entity, field) => {
    if (field === 'attributes.name') {
      const revoked = bindingsRef.revoke('read-world', 'adapter-a', 'actor-a');
      assert.equal(revoked.changed, true);
    }
    return field !== 'attributes.secret';
  });
  bindingsRef = bindings;

  assert.throws(
    () => service.readEntityFields(request()),
    (error) => error.code === 'READ_NOT_AVAILABLE' && error.status === 404,
  );
});

test('canonical snapshot mutation during field-policy evaluation prevents stale content return', (t) => {
  let engineRef;
  let mutated = false;
  const { service, engine } = setup(t, (_context, _entity, field) => {
    if (field === 'attributes.name' && !mutated) {
      mutated = true;
      const revision = engineRef.getState('read-world').world_revision;
      const result = engineRef.commitEvent('read-world', {
        idempotency_key: 'mutate-during-authorized-read',
        turn_id: 'mutate-during-authorized-read',
        event_type: 'action.completed',
        expected_revision: revision,
        effects: [{ kind: 'entity.create', entity_id: 'read-race-created', entity_type: 'object' }],
      });
      assert.equal(result.accepted, true);
    }
    return true;
  });
  engineRef = engine;

  assert.throws(
    () => service.readEntityFields(request()),
    (error) => error.code === 'STALE_AUTHORIZED_READ_SNAPSHOT' && error.status === 409,
  );
});

test('mechanic attribute read rechecks actor binding after field-policy evaluation', (t) => {
  let bindingsRef;
  const { service, bindings, engine, store } = setup(t, (_context, _entity, field) => {
    if (field === 'attributes.name') {
      const revoked = bindingsRef.revoke('read-world', 'adapter-a', 'actor-a');
      assert.equal(revoked.changed, true);
    }
    return true;
  });
  bindingsRef = bindings;
  const base = {
    worldId: 'read-world',
    adapterId: 'adapter-a',
    actorEntityId: 'actor-a',
    recipient: 'model',
    purpose: 'npc_decision',
    entityId: 'target-a',
    expectedWorldRevision: engine.getState('read-world').world_revision,
    expectedCommitSequence: store.currentCommitSequence('read-world'),
  };

  assert.throws(
    () => service.readEntityAttributeForMechanic({ ...base, attribute: 'name' }),
    (error) => error.code === 'READ_NOT_AVAILABLE' && error.status === 404,
  );
});

test('mechanic attribute read rejects canonical mutation during field-policy evaluation', (t) => {
  let engineRef;
  let mutated = false;
  const { service, engine, store } = setup(t, (_context, _entity, field) => {
    if (field === 'attributes.name' && !mutated) {
      mutated = true;
      const revision = engineRef.getState('read-world').world_revision;
      const result = engineRef.commitEvent('read-world', {
        idempotency_key: 'mutate-during-mechanic-read',
        turn_id: 'mutate-during-mechanic-read',
        event_type: 'action.completed',
        expected_revision: revision,
        effects: [{ kind: 'entity.create', entity_id: 'mechanic-read-race-created', entity_type: 'object' }],
      });
      assert.equal(result.accepted, true);
    }
    return true;
  });
  engineRef = engine;
  const requestSnapshot = {
    worldId: 'read-world',
    adapterId: 'adapter-a',
    actorEntityId: 'actor-a',
    recipient: 'model',
    purpose: 'npc_decision',
    entityId: 'target-a',
    attribute: 'name',
    expectedWorldRevision: engine.getState('read-world').world_revision,
    expectedCommitSequence: store.currentCommitSequence('read-world'),
  };

  assert.throws(
    () => service.readEntityAttributeForMechanic(requestSnapshot),
    (error) => error.code === 'STALE_AUTHORIZED_READ_SNAPSHOT' && error.status === 409,
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

test('internal mechanic attribute reads distinguish authorized absence from denied reads and pin the snapshot', (t) => {
  const { service, engine, store } = setup(t, (context, entity, field) =>
    context.actor.entity_id === 'actor-a'
      && context.recipient === 'model'
      && context.purpose === 'npc_decision'
      && field !== 'attributes.secret');
  const cursor = {
    expectedWorldRevision: engine.getState('read-world').world_revision,
    expectedCommitSequence: store.currentCommitSequence('read-world'),
  };
  const base = {
    worldId: 'read-world',
    adapterId: 'adapter-a',
    actorEntityId: 'actor-a',
    recipient: 'model',
    purpose: 'npc_decision',
    entityId: 'target-a',
    ...cursor,
  };

  assert.throws(
    () => service.readEntityAttributeForMechanic({ ...base, attribute: 'secret' }),
    (error) => error.code === 'READ_NOT_AVAILABLE' && error.status === 404,
  );
  const absent = service.readEntityAttributeForMechanic({ ...base, attribute: 'not_present' });
  assert.equal(absent.present, false);
  assert.equal(Object.hasOwn(absent, 'value'), false);
  assert.equal(absent.world_revision, cursor.expectedWorldRevision);
  assert.equal(absent.commit_sequence, cursor.expectedCommitSequence);

  assert.throws(
    () => service.readEntityAttributeForMechanic({
      ...base,
      attribute: 'name',
      expectedWorldRevision: cursor.expectedWorldRevision - 1,
    }),
    (error) => error.code === 'STALE_AUTHORIZED_READ_SNAPSHOT' && error.status === 409,
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


test('authorized read returns the current composite snapshot after rollback changes revision without sequence growth', (t) => {
  const { service, engine, store } = setup(t, (context, entity, field) =>
    entity.entity_id === 'actor-a' && ['entity_id', 'entity_type', 'status'].includes(field));

  engine.commitEvent('read-world', {
    event_id: 'temporary-target',
    idempotency_key: 'temporary-target',
    turn_id: 'temporary-target-turn',
    event_type: 'action.completed',
    expected_revision: 1,
    effects: [{ kind: 'entity.create', entity_id: 'temporary-target', entity_type: 'character' }],
  });

  const before = service.readEntityFields(request({
    entityIds: ['actor-a'],
    fields: ['entity_id', 'entity_type', 'status'],
  }));
  const rollback = engine.rollbackEvent('read-world', {
    root_event_id: 'temporary-target',
    idempotency_key: 'rollback-temporary-target',
  });
  assert.deepEqual(rollback.invalidated_event_ids, ['temporary-target']);

  const after = service.readEntityFields(request({
    entityIds: ['actor-a'],
    fields: ['entity_id', 'entity_type', 'status'],
  }));
  assert.equal(after.world_revision, before.world_revision + 1);
  assert.equal(after.commit_sequence, before.commit_sequence);
  assert.deepEqual(after.entities, before.entities);
  assert.equal(store.currentCommitSequence('read-world'), before.commit_sequence);
});

test('mechanic authorized read rejects the R2 cursor after rollback restores R1 without commit-sequence growth', (t) => {
  const { service, engine, store } = setup(t, (_context, entity, field) =>
    entity.entity_id === 'target-a' && field === 'attributes.name');

  const initial = engine.getSnapshot('read-world', { entityIds: ['target-a'] });
  const r1 = initial.entities.find((entity) => entity.entity_id === 'target-a');
  assert.equal(r1.attributes.name, 'Target');

  const update = engine.commitEvent('read-world', {
    event_id: 'target-a-update-r2',
    idempotency_key: 'target-a-update-r2',
    turn_id: 'target-a-update-r2',
    event_type: 'action.completed',
    expected_revision: initial.world_revision,
    causal_links: [{ relation: 'REQUIRES', predicate: { kind: 'entity_exists', entity_id: 'target-a' } }],
    effects: [{ kind: 'entity.update', entity_id: 'target-a', attributes: { name: 'Target R2' } }],
  });
  assert.equal(update.accepted, true);

  const r2Snapshot = engine.getSnapshot('read-world', { entityIds: ['target-a'] });
  const r2 = r2Snapshot.entities.find((entity) => entity.entity_id === 'target-a');
  assert.equal(r2.attributes.name, 'Target R2');
  const r2Request = {
    worldId: 'read-world',
    adapterId: 'adapter-a',
    actorEntityId: 'actor-a',
    recipient: 'model',
    purpose: 'npc_decision',
    entityId: 'target-a',
    attribute: 'name',
    expectedWorldRevision: r2Snapshot.world_revision,
    expectedCommitSequence: r2Snapshot.commit_sequence,
  };

  const rollback = engine.rollbackEvent('read-world', {
    root_event_id: 'target-a-update-r2',
    idempotency_key: 'rollback-target-a-update-r2',
  });
  assert.deepEqual(rollback.invalidated_event_ids, ['target-a-update-r2']);

  const restoredSnapshot = engine.getSnapshot('read-world', { entityIds: ['target-a'] });
  const restored = restoredSnapshot.entities.find((entity) => entity.entity_id === 'target-a');
  assert.equal(restored.attributes.name, 'Target');
  assert.equal(restored.updated_revision, r1.updated_revision);
  assert.equal(restoredSnapshot.commit_sequence, r2Snapshot.commit_sequence);
  assert.ok(restoredSnapshot.world_revision > r2Snapshot.world_revision);
  assert.equal(store.currentCommitSequence('read-world'), r2Snapshot.commit_sequence);

  assert.throws(
    () => service.readEntityAttributeForMechanic(r2Request),
    (error) => error.code === 'STALE_AUTHORIZED_READ_SNAPSHOT' && error.status === 409,
  );

  const current = service.readEntityAttributeForMechanic({
    ...r2Request,
    expectedWorldRevision: restoredSnapshot.world_revision,
    expectedCommitSequence: restoredSnapshot.commit_sequence,
  });
  assert.equal(current.value, 'Target');
  assert.equal(current.world_revision, restoredSnapshot.world_revision);
  assert.equal(current.commit_sequence, restoredSnapshot.commit_sequence);
});


test('mechanic authorized read rejects a deleted-source cursor and rollback restores the prior active entity', (t) => {
  const { service, engine, store } = setup(t, (_context, entity, field) =>
    entity.entity_id === 'target-a' && field === 'attributes.name');

  const r1Snapshot = engine.getSnapshot('read-world', { entityIds: ['target-a'] });
  const r1 = r1Snapshot.entities[0];
  assert.equal(r1.status, 'active');
  assert.equal(r1.attributes.name, 'Target');

  const deletion = engine.commitEvent('read-world', {
    event_id: 'target-a-delete-r2',
    idempotency_key: 'target-a-delete-r2',
    turn_id: 'target-a-delete-r2',
    event_type: 'action.completed',
    expected_revision: r1Snapshot.world_revision,
    causal_links: [{ relation: 'REQUIRES', predicate: { kind: 'entity_exists', entity_id: 'target-a' } }],
    effects: [{ kind: 'entity.delete', entity_id: 'target-a' }],
  });
  assert.equal(deletion.accepted, true);

  const r2Snapshot = engine.getSnapshot('read-world', { entityIds: ['target-a'] });
  const r2 = r2Snapshot.entities[0];
  assert.equal(r2.status, 'destroyed');
  const r2Request = {
    worldId: 'read-world',
    adapterId: 'adapter-a',
    actorEntityId: 'actor-a',
    recipient: 'model',
    purpose: 'npc_decision',
    entityId: 'target-a',
    attribute: 'name',
    expectedWorldRevision: r2Snapshot.world_revision,
    expectedCommitSequence: r2Snapshot.commit_sequence,
  };
  assert.throws(
    () => service.readEntityAttributeForMechanic(r2Request),
    (error) => error.code === 'READ_NOT_AVAILABLE' && error.status === 404,
  );

  const rollback = engine.rollbackEvent('read-world', {
    root_event_id: 'target-a-delete-r2',
    idempotency_key: 'rollback-target-a-delete-r2',
  });
  assert.deepEqual(rollback.invalidated_event_ids, ['target-a-delete-r2']);

  const restoredSnapshot = engine.getSnapshot('read-world', { entityIds: ['target-a'] });
  const restored = restoredSnapshot.entities[0];
  assert.equal(restored.status, 'active');
  assert.equal(restored.attributes.name, 'Target');
  assert.equal(restored.updated_revision, r1.updated_revision);
  assert.equal(restoredSnapshot.commit_sequence, r2Snapshot.commit_sequence);
  assert.ok(restoredSnapshot.world_revision > r2Snapshot.world_revision);
  assert.equal(store.currentCommitSequence('read-world'), r2Snapshot.commit_sequence);

  assert.throws(
    () => service.readEntityAttributeForMechanic(r2Request),
    (error) => error.code === 'STALE_AUTHORIZED_READ_SNAPSHOT' && error.status === 409,
  );
  const current = service.readEntityAttributeForMechanic({
    ...r2Request,
    expectedWorldRevision: restoredSnapshot.world_revision,
    expectedCommitSequence: restoredSnapshot.commit_sequence,
  });
  assert.equal(current.value, 'Target');
});
