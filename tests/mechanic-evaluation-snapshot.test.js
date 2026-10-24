import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';

function setup(t, worldId = 'mechanic-snapshot-world') {
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  engine.createWorld({
    world_id: worldId,
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    game_time: '2005-12-29T10:00:00Z',
  });
  t.after(() => store.close());
  return { store, engine, worldId };
}

function template(templateId = 'test.mechanic', overrides = {}) {
  return {
    template_id: templateId,
    version: '1.0.0',
    schema_version: 'core-1',
    display_name: 'Snapshot fixture',
    required_capabilities: [],
    applicability: [],
    actions: [],
    conflict_policy: { mode: 'manual' },
    lifecycle_policy: { on_disable: 'require_author_decision' },
    unknown_policy: 'mark_unknown',
    ...overrides,
  };
}

function moduleManifest() {
  return {
    module_id: 'test.reader',
    version: '1.0.0',
    contract_version: 'core-1',
    capabilities: ['facts.read'],
    operations: ['evaluate_predicate'],
    input_schema: { type: 'object' },
    output_schema: { type: 'object' },
    failure_policy: 'fail_closed',
    compatibility: { core_contract_versions: ['core-1'] },
  };
}

function commit(engine, worldId, eventId, expectedRevision, effects, causedBy = []) {
  return engine.commitEvent(worldId, {
    event_id: eventId,
    idempotency_key: eventId,
    turn_id: eventId + '-turn',
    event_type: 'action.completed',
    expected_revision: expectedRevision,
    effects,
    caused_by: causedBy,
    depends_on: [],
    read_set: [],
    causal_links: [],
  });
}

test('mechanic evaluation snapshot captures instances and exact pinned definitions in the same result', (t) => {
  const { engine, worldId } = setup(t);
  engine.registerRuleModuleManifest(moduleManifest());
  engine.registerMechanicTemplate(template('test.enabled', {
    rule_modules: [{ module_id: 'test.reader', version: '1.0.0', required_capabilities: ['facts.read'] }],
  }));
  engine.registerMechanicTemplate(template('test.disabled'));

  commit(engine, worldId, 'create-enabled', 0, [
    { kind: 'mechanic.instance.create', instance_id: 'instance.enabled', template_id: 'test.enabled', template_version: '1.0.0' },
  ]);
  commit(engine, worldId, 'enable-enabled', 1, [
    { kind: 'mechanic.instance.enable', instance_id: 'instance.enabled' },
  ], ['create-enabled']);
  commit(engine, worldId, 'create-disabled', 2, [
    { kind: 'mechanic.instance.create', instance_id: 'instance.disabled', template_id: 'test.disabled', template_version: '1.0.0' },
  ]);

  const snapshot = engine.getSnapshot(worldId, { includeMechanicEvaluationState: true });
  assert.equal(snapshot.world_revision, 3);
  assert.equal(snapshot.commit_sequence, 3);
  assert.deepEqual(snapshot.mechanic_evaluation_snapshot.instances.map((instance) => [instance.instance_id, instance.status]), [
    ['instance.disabled', 'disabled'],
    ['instance.enabled', 'enabled'],
  ]);
  assert.deepEqual(snapshot.mechanic_evaluation_snapshot.templates.map(({ template: value }) => value.template_id), ['test.enabled']);
  assert.deepEqual(snapshot.mechanic_evaluation_snapshot.modules.map(({ manifest }) => manifest.module_id), ['test.reader']);
  assert.equal(snapshot.mechanic_evaluation_snapshot.templates[0].template.version, '1.0.0');
  assert.equal(snapshot.mechanic_evaluation_snapshot.modules[0].manifest.version, '1.0.0');
  assert.equal(Object.hasOwn(snapshot, 'mechanic_evaluation_snapshot'), true);
});

test('mechanic evaluation snapshot is opt-in and world-scoped', (t) => {
  const { engine, worldId } = setup(t, 'world-a');
  engine.createWorld({
    world_id: 'world-b',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    game_time: '2005-12-29T10:00:00Z',
  });
  engine.registerMechanicTemplate(template());
  commit(engine, 'world-a', 'create-a', 0, [
    { kind: 'mechanic.instance.create', instance_id: 'instance.a', template_id: 'test.mechanic', template_version: '1.0.0' },
  ]);
  commit(engine, 'world-b', 'create-b', 0, [
    { kind: 'mechanic.instance.create', instance_id: 'instance.b', template_id: 'test.mechanic', template_version: '1.0.0' },
  ]);

  const ordinary = engine.getSnapshot(worldId);
  assert.equal(Object.hasOwn(ordinary, 'mechanic_evaluation_snapshot'), false);
  assert.deepEqual(engine.getSnapshot(worldId, { includeMechanicEvaluationState: true })
    .mechanic_evaluation_snapshot.instances.map((instance) => instance.instance_id), ['instance.a']);
  assert.deepEqual(engine.getSnapshot('world-b', { includeMechanicEvaluationState: true })
    .mechanic_evaluation_snapshot.instances.map((instance) => instance.instance_id), ['instance.b']);
});

test('canonical snapshot includes exact world-scoped context manifests and distinguishes missing IDs', (t) => {
  const { engine, worldId } = setup(t, 'manifest-world-a');
  engine.createWorld({
    world_id: 'manifest-world-b',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    game_time: '2005-12-29T10:00:00Z',
  });
  const registered = engine.registerContextManifest(worldId, {
    generation_id: 'generation-a',
    base_commit_sequence: 0,
    base_world_revision: 0,
    items: [],
  });
  const snapshot = engine.getSnapshot(worldId, {
    contextManifestIds: [registered.manifest_id, 'missing-manifest'],
  });
  assert.equal(snapshot.context_manifests.length, 1);
  assert.equal(snapshot.context_manifests[0].manifest_id, registered.manifest_id);
  assert.equal(snapshot.context_manifests[0].world_id, worldId);
  assert.equal(snapshot.context_manifests[0].generation_id, 'generation-a');
  assert.equal(snapshot.context_manifests[0].base_commit_sequence, 0);
  assert.equal(snapshot.context_manifests[0].base_world_revision, 0);
  assert.deepEqual(snapshot.context_manifests[0].items, []);
  assert.deepEqual(snapshot.missing_context_manifest_ids, ['missing-manifest']);

  const isolated = engine.getSnapshot('manifest-world-b', {
    contextManifestIds: [registered.manifest_id],
  });
  assert.deepEqual(isolated.context_manifests, []);
  assert.deepEqual(isolated.missing_context_manifest_ids, [registered.manifest_id]);

  assert.throws(
    () => engine.getSnapshot(worldId, { contextManifestIds: ['same', 'same'] }),
    (error) => error.code === 'INVALID_SNAPSHOT_REQUEST',
  );
  assert.throws(
    () => engine.getSnapshot(worldId, { contextManifestIds: 'not-an-array' }),
    (error) => error.code === 'INVALID_SNAPSHOT_REQUEST',
  );
});

test('current context manifests expand referenced canonical rows, while stale manifests do not', (t) => {
  const { engine, worldId } = setup(t, 'manifest-expansion-world');
  commit(engine, worldId, 'seed-event', 0, [
    { kind: 'entity.create', entity_id: 'entity.alpha', entity_type: 'character', attributes: { name: 'Alpha' } },
    { kind: 'fact.set', fact_id: 'fact.alpha', predicate: 'known', value: true },
  ]);
  const manifest = engine.registerContextManifest(worldId, {
    generation_id: 'generation-current',
    base_commit_sequence: 1,
    base_world_revision: 1,
    items: [
      { kind: 'entity', target_id: 'entity.alpha' },
      { kind: 'fact', target_id: 'fact.alpha' },
      { kind: 'event', target_id: 'seed-event' },
    ],
  });

  const current = engine.getSnapshot(worldId, { contextManifestIds: [manifest.manifest_id] });
  assert.equal(current.world_revision, 1);
  assert.equal(current.commit_sequence, 1);
  assert.deepEqual(current.entities.map((entity) => entity.entity_id), ['entity.alpha']);
  assert.deepEqual(current.facts.map((fact) => fact.fact_id), ['fact.alpha']);
  assert.deepEqual(current.events.map((event) => event.event_id), ['seed-event']);
  assert.deepEqual(current.missing_context_manifest_ids, []);

  commit(engine, worldId, 'later-event', 1, [
    { kind: 'entity.create', entity_id: 'entity.beta', entity_type: 'character' },
  ]);
  const stale = engine.getSnapshot(worldId, { contextManifestIds: [manifest.manifest_id] });
  assert.equal(stale.world_revision, 2);
  assert.equal(stale.commit_sequence, 2);
  assert.equal(stale.context_manifests[0].base_world_revision, 1);
  assert.deepEqual(stale.entities, []);
  assert.deepEqual(stale.facts, []);
  assert.deepEqual(stale.events, []);
});

test('mechanic evaluation snapshot fails closed on a non-event-backed review reason', (t) => {
  const { store, engine, worldId } = setup(t, 'review-state-world');
  engine.registerMechanicTemplate(template());
  commit(engine, worldId, 'create-review-instance', 0, [
    { kind: 'mechanic.instance.create', instance_id: 'instance.review', template_id: 'test.mechanic', template_version: '1.0.0' },
  ]);
  // Simulate a legacy/corrupt projection state that no canonical event can currently produce.
  store.db.prepare('UPDATE mechanic_instances SET needs_review_reason=? WHERE world_id=? AND instance_id=?')
    .run('review required', worldId, 'instance.review');
  assert.throws(
    () => engine.getSnapshot(worldId, { includeMechanicEvaluationState: true }),
    (error) => error.code === 'MECHANIC_INSTANCE_REVIEW_STATE_UNSUPPORTED' && error.status === 409,
  );
});

test('context-manifest expansion refuses more than the bounded per-kind snapshot limit', (t) => {
  const { engine, worldId } = setup(t, 'manifest-overflow-world');
  const firstBatch = Array.from({ length: 200 }, (_, index) => ({
    kind: 'entity.create',
    entity_id: 'entity.' + String(index).padStart(3, '0'),
    entity_type: 'character',
  }));
  commit(engine, worldId, 'create-entities-a', 0, firstBatch);
  commit(engine, worldId, 'create-entities-b', 1, [
    { kind: 'entity.create', entity_id: 'entity.200', entity_type: 'character' },
  ]);
  const items = Array.from({ length: 201 }, (_, index) => ({
    kind: 'entity',
    target_id: 'entity.' + String(index).padStart(3, '0'),
  }));
  const manifest = engine.registerContextManifest(worldId, {
    generation_id: 'generation-overflow',
    base_commit_sequence: 2,
    base_world_revision: 2,
    items,
  });
  assert.throws(
    () => engine.getSnapshot(worldId, { contextManifestIds: [manifest.manifest_id] }),
    (error) => error.code === 'SNAPSHOT_TOO_LARGE' && error.status === 409,
  );
});

test('mechanic evaluation snapshot rejects malformed options and refuses a truncated active set', (t) => {
  const { engine, worldId } = setup(t);
  assert.throws(
    () => engine.getSnapshot(worldId, { includeMechanicEvaluationState: 'yes' }),
    (error) => error.code === 'INVALID_SNAPSHOT_REQUEST',
  );
  engine.registerMechanicTemplate(template());
  const firstBatch = Array.from({ length: 200 }, (_, index) => ({
    kind: 'mechanic.instance.create',
    instance_id: 'instance.' + String(index).padStart(3, '0'),
    template_id: 'test.mechanic',
    template_version: '1.0.0',
  }));
  commit(engine, worldId, 'create-batch', 0, firstBatch);
  commit(engine, worldId, 'create-overflow', 1, [
    { kind: 'mechanic.instance.create', instance_id: 'instance.200', template_id: 'test.mechanic', template_version: '1.0.0' },
  ]);
  assert.throws(
    () => engine.getSnapshot(worldId, { includeMechanicEvaluationState: true }),
    (error) => error.code === 'MECHANIC_SNAPSHOT_TOO_LARGE' && error.status === 409,
  );
});
