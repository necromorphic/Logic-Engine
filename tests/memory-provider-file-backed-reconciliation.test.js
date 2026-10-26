import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { SQLiteMemoryProvider } from '../src/application/sqlite-memory-provider.js';

function makeProviderOptions(engine, path) {
  return {
    path,
    getSnapshot: async (worldId) => {
      const snapshot = engine.getSnapshot(worldId);
      return { world_revision: snapshot.world_revision, commit_sequence: snapshot.commit_sequence };
    },
    // Approved mapping for direct canonical_entity only: source_version must
    // equal the canonical decimal encoding of Core's current updated_revision.
    // Missing, destroyed, unknown, wrong-world, mismatched, and unavailable
    // entities fail closed. This callback reads Core; it does not infer authority
    // from Provider metadata or from the composite world snapshot cursor.
    validateSourceVersion: async (record) => {
      if (record.source_kind !== 'canonical_entity'
        || typeof record.source_entity_id !== 'string'
        || typeof record.source_version !== 'string') return false;
      try {
        const snapshot = engine.getSnapshot(record.world_id, { entityIds: [record.source_entity_id] });
        if (snapshot.entities.length !== 1) return false;
        const entity = snapshot.entities[0];
        return entity.entity_id === record.source_entity_id
          && entity.status !== 'destroyed'
          && Number.isSafeInteger(entity.updated_revision)
          && record.source_version === String(entity.updated_revision);
      } catch {
        return false;
      }
    },
    // Test-only positive callback. It does NOT prove Host inventory completeness.
    validateInventory: async () => true,
  };
}

function recordFor(scope, sourceId, sourceVersion, recordRef = 'memory:direct-source') {
  return {
    ...scope,
    record_ref: recordRef,
    record_version: 'record-v1',
    source_kind: 'canonical_entity',
    source_entity_id: sourceId,
    source_version: String(sourceVersion),
    content_kind: 'claim',
    epistemic_kind: 'acquired_report',
    producer_kind: 'provider-file-backed-integration-test',
    content_disposition: 'usable',
    evidence_assessment: 'unassessed',
    lineage: [{ source_kind: 'canonical_entity', entity_id: sourceId, source_version: String(sourceVersion) }],
  };
}

function setup(t) {
  const directory = mkdtempSync(join(tmpdir(), 'logic-provider-core-reconcile-'));
  const providerPath = join(directory, 'provider.sqlite');
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  const worldId = 'provider-file-world';
  const scope = { world_id: worldId, subject_id: 'npc-file-test', purpose: 'npc_decision' };
  engine.createWorld({
    world_id: worldId, world_pack_id: 'test.provider-file-backed', world_pack_version: '1',
    game_time: '2026-01-01T00:00:00Z',
  });
  const seed = engine.commitEvent(worldId, {
    event_id: 'provider-file-seed', idempotency_key: 'provider-file-seed',
    turn_id: 'provider-file-seed', event_type: 'action.completed', expected_revision: 0,
    effects: [
      { kind: 'entity.create', entity_id: scope.subject_id, entity_type: 'character', attributes: { name: 'NPC' } },
      { kind: 'entity.create', entity_id: 'source-a', entity_type: 'character', attributes: { public_note: 'R1' } },
    ],
  });
  assert.equal(seed.accepted, true);
  let provider = new SQLiteMemoryProvider(makeProviderOptions(engine, providerPath));
  t.after(() => {
    try { provider?.close(); } catch {}
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    engine, scope, providerPath,
    get provider() { return provider; },
    replaceProvider() {
      provider.close();
      provider = new SQLiteMemoryProvider(makeProviderOptions(engine, providerPath));
    },
  };
}

test('file-backed Provider restart/rebuild preserves current direct source and does not restore revoked grant', async (t) => {
  const s = setup(t);
  const source = s.engine.getSnapshot(s.scope.world_id, { entityIds: ['source-a'] }).entities[0];
  assert.equal(source.status, 'active');
  assert.ok(Number.isSafeInteger(source.updated_revision));
  const record = recordFor(s.scope, 'source-a', source.updated_revision);
  s.provider.grantQuery(s.scope, true);
  s.provider.grantRecord(s.scope, record.record_ref, record.record_version, true);
  assert.equal(s.provider.putRecord(record).status, 'stored');
  assert.deepEqual(await s.provider.rebuildIndex(s.scope.world_id), { status: 'rebuilt', count: 1 });
  assert.equal((await s.provider.reconcile(s.scope.world_id)).status, 'current');

  s.replaceProvider();
  assert.deepEqual(await s.provider.rebuildIndex(s.scope.world_id), { status: 'rebuilt', count: 1 });
  assert.equal((await s.provider.reconcile(s.scope.world_id)).status, 'current');
  const allowed = await s.provider.retrieveCandidates(s.scope);
  assert.equal(allowed.completeness, 'complete');
  assert.equal(allowed.candidates.length, 1);
  assert.equal(allowed.candidates[0].source.entity_id, 'source-a');

  s.provider.revokeRecord(s.scope, record.record_ref, record.record_version);
  s.replaceProvider();
  assert.deepEqual(await s.provider.rebuildIndex(s.scope.world_id), { status: 'rebuilt', count: 1 });
  assert.equal((await s.provider.reconcile(s.scope.world_id)).status, 'current');
  await assert.rejects(() => s.provider.retrieveCandidates(s.scope), /MEMORY_RECORDS_WITHHELD/);
});

test('file-backed Provider rejects a pinned R2 source after Core rolls the entity back to R1', async (t) => {
  const s = setup(t);
  const beforeUpdate = s.engine.getSnapshot(s.scope.world_id);
  const r1Entity = s.engine.getSnapshot(s.scope.world_id, { entityIds: ['source-a'] }).entities[0];
  const r1 = String(r1Entity.updated_revision);
  const update = s.engine.commitEvent(s.scope.world_id, {
    event_id: 'provider-file-source-update-r2',
    idempotency_key: 'provider-file-source-update-r2',
    turn_id: 'provider-file-source-update-r2',
    event_type: 'action.completed',
    expected_revision: beforeUpdate.world_revision,
    causal_links: [{ relation: 'REQUIRES', predicate: { kind: 'entity_exists', entity_id: 'source-a' } }],
    effects: [{ kind: 'entity.update', entity_id: 'source-a', attributes: { public_note: 'R2' } }],
  });
  assert.equal(update.accepted, true);
  const r2Entity = s.engine.getSnapshot(s.scope.world_id, { entityIds: ['source-a'] }).entities[0];
  const r2 = String(r2Entity.updated_revision);
  assert.notEqual(r2, r1, 'Core entity revision must change on the update');

  const record = recordFor(s.scope, 'source-a', r2, 'memory:source-pinned-r2');
  s.provider.grantQuery(s.scope, true);
  s.provider.grantRecord(s.scope, record.record_ref, record.record_version, true);
  s.provider.putRecord(record);
  assert.deepEqual(await s.provider.rebuildIndex(s.scope.world_id), { status: 'rebuilt', count: 1 });
  assert.equal((await s.provider.reconcile(s.scope.world_id)).status, 'current');
  s.replaceProvider();
  assert.deepEqual(await s.provider.rebuildIndex(s.scope.world_id), { status: 'rebuilt', count: 1 });
  assert.equal((await s.provider.reconcile(s.scope.world_id)).status, 'current');

  const beforeRollback = s.engine.getSnapshot(s.scope.world_id);
  const rollback = s.engine.rollbackEvent(s.scope.world_id, {
    root_event_id: 'provider-file-source-update-r2',
    idempotency_key: 'provider-file-source-rollback-r2',
  });
  assert.equal(rollback.accepted, true);
  const afterRollback = s.engine.getSnapshot(s.scope.world_id);
  let restoredEntity = null;
  try {
    restoredEntity = s.engine.getSnapshot(s.scope.world_id, { entityIds: ['source-a'] }).entities[0] ?? null;
  } catch {
    // Core may represent the rollback by removing the entity from the current snapshot.
  }
  assert.ok(!restoredEntity || restoredEntity.status === 'destroyed'
    || String(restoredEntity.updated_revision) === r1,
  'rollback must restore R1 or make the source absent/destroyed; it must not leave R2 current');
  assert.equal(afterRollback.world_revision, beforeRollback.world_revision + 1);
  assert.equal(afterRollback.commit_sequence, beforeRollback.commit_sequence);

  assert.equal((await s.provider.reconcile(s.scope.world_id)).status, 'stale');
  await assert.rejects(() => s.provider.retrieveCandidates(s.scope), /MEMORY_INDEX_NOT_READY/);
  assert.equal(s.provider.getIndexStatusForDiagnostics(s.scope.world_id).source_reconciliation, 'stale');
});
