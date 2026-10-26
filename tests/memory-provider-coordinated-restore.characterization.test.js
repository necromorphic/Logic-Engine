import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { SQLiteMemoryProvider } from '../src/application/sqlite-memory-provider.js';

test('characterizes coordinated Core+Provider database restore as undetectable by current snapshot markers alone', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'logic-coordinated-restore-'));
  const corePath = join(dir, 'core.sqlite');
  const providerPath = join(dir, 'provider.sqlite');
  const coordinatorPath = join(dir, 'coordinator.sqlite');
  const coreBackup = join(dir, 'core-before-change.sqlite');
  const providerBackup = join(dir, 'provider-before-change.sqlite');
  const previousCoordinatorPath = process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH;
  process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH = coordinatorPath;

  let store;
  let engine;
  let provider;

  const open = () => {
    store = new SQLiteStore(corePath);
    engine = new LogicEngine(store);
    provider = new SQLiteMemoryProvider({
      path: providerPath,
      coordinatorPath,
      getSnapshot: async (worldId) => {
        const snapshot = engine.getSnapshot(worldId);
        return { world_revision: snapshot.world_revision, commit_sequence: snapshot.commit_sequence };
      },
      // Test-only mapping: this deliberately proves only that a restored Core
      // entity and restored Provider record can agree with each other again.
      validateSourceVersion: async (record) => {
        try {
          const snapshot = engine.getSnapshot(record.world_id, { entityIds: [record.source_entity_id] });
          const entity = snapshot.entities[0];
          return Boolean(entity
            && entity.status === 'active'
            && Number.isSafeInteger(entity.updated_revision)
            && entity.updated_revision >= 0
            && record.source_version === String(entity.updated_revision));
        } catch {
          return false;
        }
      },
      // Test fixture only; this is not authoritative Host inventory evidence.
      validateInventory: async () => true,
    });
  };

  const close = () => {
    provider?.close();
    provider = null;
    store?.close();
    store = null;
    engine = null;
  };

  try {
    open();
    engine.createWorld({
      world_id: 'restore-world',
      world_pack_id: 'test.restore',
      world_pack_version: '1',
      game_time: '2026-01-01T00:00:00.000Z',
    });
    engine.commitEvent('restore-world', {
      event_id: 'restore-seed',
      idempotency_key: 'restore-seed',
      turn_id: 'restore-seed',
      event_type: 'action.completed',
      expected_revision: 0,
      effects: [{
        kind: 'entity.create',
        entity_id: 'source-entity',
        entity_type: 'character',
        attributes: { public_note: 'before' },
      }],
    });

    const initial = engine.getSnapshot('restore-world', { entityIds: ['source-entity'] });
    const initialEntity = initial.entities[0];
    const scope = { world_id: 'restore-world', subject_id: 'npc-restore', purpose: 'npc_decision' };
    const record = {
      ...scope,
      record_ref: 'memory:source-entity',
      record_version: 'record-v1',
      source_kind: 'canonical_entity',
      source_entity_id: 'source-entity',
      source_version: String(initialEntity.updated_revision),
      content_kind: 'claim',
      epistemic_kind: 'acquired_report',
      producer_kind: 'memory-index',
      content_disposition: 'usable',
      evidence_assessment: 'unassessed',
      lineage: [{
        source_kind: 'canonical_entity',
        entity_id: 'source-entity',
        source_version: String(initialEntity.updated_revision),
      }],
    };
    provider.grantQuery(scope, true);
    provider.putRecord(record);
    provider.grantRecord(scope, record.record_ref, record.record_version, true);
    await provider.rebuildIndex('restore-world');
    assert.equal((await provider.reconcile('restore-world')).status, 'current');

    close();
    copyFileSync(corePath, coreBackup);
    copyFileSync(providerPath, providerBackup);

    open();
    const current = engine.getSnapshot('restore-world');
    engine.commitEvent('restore-world', {
      event_id: 'restore-source-change',
      idempotency_key: 'restore-source-change',
      turn_id: 'restore-source-change',
      event_type: 'action.completed',
      expected_revision: current.world_revision,
      causal_links: [{
        relation: 'REQUIRES',
        predicate: { kind: 'entity_exists', entity_id: 'source-entity' },
      }],
      effects: [{
        kind: 'entity.update',
        entity_id: 'source-entity',
        attributes: { public_note: 'after' },
      }],
    });
    assert.equal((await provider.reconcile('restore-world')).status, 'stale',
      'a source-version change must invalidate the old Provider record before restoration');

    close();
    copyFileSync(coreBackup, corePath);
    copyFileSync(providerBackup, providerPath);

    open();
    const restored = engine.getSnapshot('restore-world', { entityIds: ['source-entity'] });
    assert.equal(restored.entities[0].attributes.public_note, 'before');
    assert.equal(restored.entities[0].updated_revision, initialEntity.updated_revision);

    const result = await provider.reconcile('restore-world');
    assert.equal(result.status, 'current',
      'the current snapshot/version checks cannot distinguish a coordinated restore from the original matching state');
    assert.equal(result.snapshot.world_revision, initial.world_revision);
    assert.equal(result.snapshot.commit_sequence, initial.commit_sequence);
  } finally {
    close();
    if (previousCoordinatorPath === undefined) delete process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH;
    else process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH = previousCoordinatorPath;
    rmSync(dir, { recursive: true, force: true });
  }
});
