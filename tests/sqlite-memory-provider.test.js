import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { SQLiteMemoryProvider } from '../src/application/sqlite-memory-provider.js';

function setup(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'logic-memory-provider-'));
  const path = join(directory, 'memory-provider.sqlite');
  let snapshot = { world_revision: 4, commit_sequence: 2 };
  let sourceVersion = 'source-v1';
  const providerOptions = {
    path,
    coordinatorPath: join(directory, 'coordinator.sqlite'),
    getSnapshot: async () => ({ ...snapshot }),
    validateSourceVersion: async (record) => record.source_version === sourceVersion
      && record.source_entity_id === 'entity-source-a',
    validateInventory: async () => true,
    ...options,
  };
  let provider = new SQLiteMemoryProvider(providerOptions);
  let observerDb = null;
  const scope = { world_id: 'world-a', subject_id: 'npc-a', purpose: 'npc_decision' };
  const record = {
    ...scope, record_ref: 'memory:record-a', record_version: 'record-v1',
    source_kind: 'canonical_entity', source_entity_id: 'entity-source-a', source_version: 'source-v1',
    content_kind: 'claim', epistemic_kind: 'acquired_report', producer_kind: 'memory-index',
    content_disposition: 'usable', evidence_assessment: 'unassessed',
    lineage: [{ source_kind: 'canonical_entity', entity_id: 'entity-source-a', source_version: 'source-v1' }],
  };
  t.after(() => {
    try { observerDb?.close(); } catch {}
    try { provider?.close(); } catch {}
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    path, scope, record,
    get db() {
      // Separate test-only connection for observation and fault injection.
      // Production callers receive no handle to either Provider-owned DB.
      if (!observerDb) {
        observerDb = new DatabaseSync(path);
        observerDb.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
      }
      return observerDb;
    },
    get provider() { return provider; },
    reopen() { provider.close(); provider = new SQLiteMemoryProvider(providerOptions); },
    setSnapshot(value) { snapshot = value; },
    setSourceVersion(value) { sourceVersion = value; },
  };
}

test('file-backed Provider rejects coordinator DB path alias before opening the database', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-memory-provider-alias-'));
  const path = join(directory, 'provider.sqlite');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  assert.throws(() => new SQLiteMemoryProvider({
    path,
    coordinatorPath: path,
    getSnapshot: async () => ({ world_revision: 1, commit_sequence: 1 }),
    validateSourceVersion: async () => true,
    validateInventory: async () => true,
  }), /Coordinator DB must be separate from the Memory Provider DB/);
  assert.equal(existsSync(path), false);
});

test('file-backed Provider detects coordinator alias through a symlinked parent before opening either DB', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-memory-provider-parent-alias-'));
  const realDirectory = join(directory, 'real');
  const aliasDirectory = join(directory, 'alias');
  mkdirSync(realDirectory);
  symlinkSync(realDirectory, aliasDirectory, 'dir');
  const providerPath = join(aliasDirectory, 'provider.sqlite');
  const coordinatorPath = join(realDirectory, 'provider.sqlite');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  assert.throws(() => new SQLiteMemoryProvider({
    path: providerPath,
    coordinatorPath,
    getSnapshot: async () => ({ world_revision: 1, commit_sequence: 1 }),
    validateSourceVersion: async () => true,
    validateInventory: async () => true,
  }), /Coordinator DB must be separate from the Memory Provider DB/);
  assert.equal(existsSync(coordinatorPath), false);
});

test('Provider does not expose writable SQLite handles', (t) => {
  const s = setup(t);
  assert.equal(s.provider.db, undefined);
  assert.equal(s.provider.coordinatorDb, undefined);
  assert.equal(Object.hasOwn(s.provider, 'db'), false);
  assert.equal(Object.hasOwn(s.provider, 'coordinatorDb'), false);
});

test('in-memory Provider does not open the process coordinator database', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-memory-provider-memory-'));
  const coordinatorPath = join(directory, 'coordinator.sqlite');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const provider = new SQLiteMemoryProvider({
    path: ':memory:',
    coordinatorPath,
    getSnapshot: async () => ({ world_revision: 1, commit_sequence: 1 }),
    validateSourceVersion: async () => true,
    validateInventory: async () => true,
  });
  t.after(() => provider.close());
  assert.equal(provider.coordinatorDb, undefined);
  assert.equal(provider.db, undefined);
  assert.equal(Object.hasOwn(provider, 'coordinatorDb'), false);
  assert.equal(Object.hasOwn(provider, 'db'), false);
  assert.equal(existsSync(coordinatorPath), false);
});

test('failed coordinator open does not create or leak a Provider database handle', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-memory-provider-startup-'));
  const path = join(directory, 'provider.sqlite');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  assert.throws(() => new SQLiteMemoryProvider({
    path,
    coordinatorPath: directory,
    getSnapshot: async () => ({ world_revision: 1, commit_sequence: 1 }),
    validateSourceVersion: async () => true,
    validateInventory: async () => true,
  }));
  assert.equal(existsSync(path), false);
});

test('Provider record ingestion rejects Proxy/accessor-backed input before reading or persisting it', (t) => {
  const s = setup(t);
  const proxyRecord = new Proxy(s.record, { get() { throw new Error('Record Proxy getter must not execute'); } });
  assert.throws(() => s.provider.putRecord(proxyRecord), /Invalid direct-source Memory record/);

  const accessorRecord = { ...s.record };
  Object.defineProperty(accessorRecord, 'source_version', {
    enumerable: true, get() { throw new Error('Record getter must not execute'); }
  });
  assert.throws(() => s.provider.putRecord(accessorRecord), /Invalid direct-source Memory record/);

  const accessorLineage = [{ ...s.record.lineage[0] }];
  Object.defineProperty(accessorLineage[0], 'source_version', {
    enumerable: true, get() { throw new Error('Lineage getter must not execute'); }
  });
  assert.throws(() => s.provider.putRecord({ ...s.record, lineage: accessorLineage }),
    /Invalid direct-source Memory record/);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS count FROM memory_records').get().count, 0);
});

test('Provider scope operations reject Proxy/accessor-backed scopes before field reads', async (t) => {
  const s = setup(t);
  let getterCalls = 0;
  const target = { ...s.scope };
  const proxyScope = new Proxy(target, {
    get() {
      getterCalls += 1;
      throw new Error('scope Proxy getter must not execute');
    },
  });
  assert.throws(() => s.provider.grantQuery(proxyScope, true), /Invalid Memory scope/);
  assert.throws(() => s.provider.grantRecord(proxyScope, 'memory:record-a', 'record-v1', true), /Invalid Memory scope/);
  assert.throws(() => s.provider.authorizeQuery(proxyScope), /Invalid Memory scope/);
  await assert.rejects(() => s.provider.retrieveCandidates(proxyScope), /Invalid Memory scope/);

  const accessorScope = { ...s.scope };
  Object.defineProperty(accessorScope, 'subject_id', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('scope accessor must not execute');
    },
  });
  assert.throws(() => s.provider.grantQuery(accessorScope, true), /Invalid Memory scope/);
  assert.throws(() => s.provider.grantRecord(accessorScope, 'memory:record-a', 'record-v1', true), /Invalid Memory scope/);
  assert.throws(() => s.provider.authorizeQuery(accessorScope), /Invalid Memory scope/);
  await assert.rejects(() => s.provider.retrieveCandidates(accessorScope), /Invalid Memory scope/);

  assert.equal(getterCalls, 0);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS count FROM memory_query_grants').get().count, 0);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS count FROM memory_record_grants').get().count, 0);
});

test('raw lifecycle targets reject Proxy/accessor-backed input before field reads or mutation', (t) => {
  const s = setup(t);
  let getterCalls = 0;
  const target = {
    world_id: 'world-a',
    conversation_id: 'chat-a',
    message_id: 'message-a',
    version_id: 'version-a',
  };
  const proxyTarget = new Proxy(target, {
    get() {
      getterCalls += 1;
      throw new Error('raw lifecycle Proxy getter must not execute');
    },
  });
  assert.throws(() => s.provider.markRawSourceDeleted(proxyTarget), /Invalid raw Memory deletion target/);
  assert.throws(() => s.provider.purgeRawSource(proxyTarget), /Invalid raw Memory purge target/);

  const accessorTarget = { ...target };
  Object.defineProperty(accessorTarget, 'version_id', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('raw lifecycle accessor must not execute');
    },
  });
  assert.throws(() => s.provider.markRawSourceDeleted(accessorTarget), /Invalid raw Memory deletion target/);
  assert.throws(() => s.provider.purgeRawSource(accessorTarget), /Invalid raw Memory purge target/);

  assert.equal(getterCalls, 0);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS count FROM memory_raw_captures').get().count, 0);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS count FROM memory_raw_derived_copies').get().count, 0);
});

test('raw tombstone and purge update provider-local lifecycle rows atomically', (t) => {
  const s = setup(t);
  const key = ['world-a', 'chat-a', 'message-a', 'version-a'];
  s.db.prepare(`INSERT INTO memory_raw_captures
    (world_id,conversation_id,message_id,version_id,role,content_text,content_sha256,
     metadata_json,captured_at,deleted_at)
    VALUES(?,?,?,?,?,?,?,?,?,NULL)`)
    .run(...key, 'assistant', 'raw text', 'raw-digest', '{}', '2026-01-01T00:00:00.000Z');
  s.db.prepare(`INSERT INTO memory_raw_active_versions
    (world_id,conversation_id,message_id,version_id,selected_at) VALUES(?,?,?,?,?)`)
    .run(...key, '2026-01-01T00:00:00.000Z');
  s.db.prepare(`INSERT INTO memory_raw_derived_copies
    (world_id,conversation_id,message_id,source_version_id,copy_ref,copy_version,copy_kind,
     content_text,content_sha256,status,created_at,invalidated_at)
    VALUES(?,?,?,?,?,?,?,?,?,'current',?,NULL)`)
    .run(...key.slice(0, 3), key[3], 'copy:summary-a', 'copy-v1', 'summary',
      'derived text', 'copy-digest', '2026-01-01T00:00:00.000Z');

  s.db.exec(`CREATE TRIGGER fail_raw_purge BEFORE DELETE ON memory_raw_captures
    BEGIN SELECT RAISE(ABORT, 'injected raw purge failure'); END;`);
  assert.throws(() => s.provider.purgeRawSource({
    world_id: key[0], conversation_id: key[1], message_id: key[2], version_id: key[3],
  }), /injected raw purge failure/);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS count FROM memory_raw_captures').get().count, 1);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS count FROM memory_raw_active_versions').get().count, 1);
  assert.equal(s.db.prepare(`SELECT status FROM memory_raw_derived_copies
    WHERE world_id=? AND conversation_id=? AND message_id=? AND source_version_id=?`).get(...key).status, 'current');
  s.db.exec('DROP TRIGGER fail_raw_purge');

  s.db.exec(`CREATE TRIGGER fail_raw_copy_invalidation BEFORE UPDATE ON memory_raw_derived_copies
    BEGIN SELECT RAISE(ABORT, 'injected raw invalidation failure'); END;`);
  assert.throws(() => s.provider.markRawSourceDeleted({
    world_id: key[0], conversation_id: key[1], message_id: key[2], version_id: key[3],
  }), /injected raw invalidation failure/);
  assert.equal(s.db.prepare(`SELECT deleted_at FROM memory_raw_captures
    WHERE world_id=? AND conversation_id=? AND message_id=? AND version_id=?`).get(...key).deleted_at, null);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS count FROM memory_raw_active_versions').get().count, 1);
  assert.equal(s.db.prepare(`SELECT status FROM memory_raw_derived_copies
    WHERE world_id=? AND conversation_id=? AND message_id=? AND source_version_id=?`).get(...key).status, 'current');
  s.db.exec('DROP TRIGGER fail_raw_copy_invalidation');

  assert.deepEqual(s.provider.markRawSourceDeleted({
    world_id: key[0], conversation_id: key[1], message_id: key[2], version_id: key[3],
  }), { status: 'deleted', invalidated_copies: 1 });
  assert.equal(s.db.prepare(`SELECT deleted_at FROM memory_raw_captures
    WHERE world_id=? AND conversation_id=? AND message_id=? AND version_id=?`).get(...key).deleted_at !== null, true);
  assert.equal(s.db.prepare(`SELECT COUNT(*) AS count FROM memory_raw_active_versions
    WHERE world_id=? AND conversation_id=? AND message_id=? AND version_id=?`).get(...key).count, 0);
  const invalidatedCopy = s.db.prepare(`SELECT status, invalidated_at FROM memory_raw_derived_copies
    WHERE world_id=? AND conversation_id=? AND message_id=? AND source_version_id=?`).get(...key);
  assert.equal(invalidatedCopy.status, 'invalidated');
  assert.equal(typeof invalidatedCopy.invalidated_at, 'string');
  assert.notEqual(invalidatedCopy.invalidated_at.length, 0);
  assert.deepEqual(s.provider.markRawSourceDeleted({
    world_id: key[0], conversation_id: key[1], message_id: key[2], version_id: key[3],
  }), { status: 'deleted', invalidated_copies: 0 });

  assert.deepEqual(s.provider.purgeRawSource({
    world_id: key[0], conversation_id: key[1], message_id: key[2], version_id: key[3],
  }), { status: 'purged', purged_copies: 1 });
  assert.equal(s.db.prepare('SELECT COUNT(*) AS count FROM memory_raw_captures').get().count, 0);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS count FROM memory_raw_active_versions').get().count, 0);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS count FROM memory_raw_derived_copies').get().count, 0);
  assert.deepEqual(s.provider.purgeRawSource({
    world_id: key[0], conversation_id: key[1], message_id: key[2], version_id: key[3],
  }), { status: 'missing', purged_copies: 0 });
});

test('malformed Core snapshots cannot publish a ready Provider state', async (t) => {
  const invalidSnapshots = [
    { world_revision: Number.NaN, commit_sequence: 2 },
    { world_revision: 4, commit_sequence: Number.POSITIVE_INFINITY },
    { world_revision: '   ', commit_sequence: 2 },
    { world_revision: 4, commit_sequence: '\t' },
  ];

  for (const snapshot of invalidSnapshots) {
    const s = setup(t, { getSnapshot: async () => snapshot });
    s.provider.putRecord(s.record);
    await s.provider.rebuildIndex(s.scope.world_id);
    assert.deepEqual(await s.provider.reconcile(s.scope.world_id), {
      status: 'unavailable',
      reason: 'CORE_SNAPSHOT_UNAVAILABLE',
    });
    assert.deepEqual(s.provider.getIndexStatusForDiagnostics(s.scope.world_id), {
      index_health: 'unavailable',
      source_reconciliation: 'stale',
      snapshot: null,
      failure_code: 'CORE_SNAPSHOT_UNAVAILABLE',
    });
    s.provider.grantQuery(s.scope, true);
    await assert.rejects(() => s.provider.retrieveCandidates(s.scope), /MEMORY_INDEX_NOT_READY/);
  }
});

test('Provider constructor rejects non-string paths before coercing caller objects', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-memory-provider-path-types-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let coercions = 0;
  const hostilePath = {
    [Symbol.toPrimitive]() {
      coercions += 1;
      throw new Error('path coercion must not execute');
    },
  };
  const base = {
    getSnapshot: async () => ({ world_revision: 1, commit_sequence: 1 }),
    validateSourceVersion: async () => true,
    validateInventory: async () => true,
  };

  assert.throws(
    () => new SQLiteMemoryProvider({ ...base, path: hostilePath, coordinatorPath: join(directory, 'coordinator.sqlite') }),
    /path must be a non-empty string/,
  );
  assert.throws(
    () => new SQLiteMemoryProvider({ ...base, path: join(directory, 'provider.sqlite'), coordinatorPath: hostilePath }),
    /coordinatorPath must be a string or null/,
  );
  assert.equal(coercions, 0);
  assert.equal(existsSync(join(directory, 'provider.sqlite')), false);
  assert.equal(existsSync(join(directory, 'coordinator.sqlite')), false);
});

test('Provider constructor rejects Proxy-backed options before destructuring them', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-memory-provider-proxy-options-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const options = new Proxy({
    path: join(directory, 'provider.sqlite'),
    coordinatorPath: join(directory, 'coordinator.sqlite'),
    getSnapshot: async () => ({ world_revision: 1, commit_sequence: 1 }),
    validateSourceVersion: async () => true,
    validateInventory: async () => true,
  }, { get() { throw new Error('Options Proxy getter must not execute'); } });
  assert.throws(() => new SQLiteMemoryProvider(options), /requires plain data options/);
  assert.equal(existsSync(join(directory, 'provider.sqlite')), false);
});

test('retrieval snapshots the requested scope before awaiting the Core snapshot', async (t) => {
  let pauseSnapshot = false;
  let enteredResolve;
  let releaseResolve;
  const enteredPromise = new Promise((resolve) => { enteredResolve = resolve; });
  const releasePromise = new Promise((resolve) => { releaseResolve = resolve; });
  const s = setup(t, {
    getSnapshot: async () => {
      if (pauseSnapshot) {
        enteredResolve();
        await releasePromise;
      }
      return { world_revision: 4, commit_sequence: 2 };
    },
  });

  s.provider.grantQuery(s.scope, true);
  s.provider.grantRecord(s.scope, s.record.record_ref, s.record.record_version, true);
  s.provider.putRecord(s.record);
  const otherScope = { ...s.scope, subject_id: 'npc-b' };
  const otherRecord = { ...s.record, subject_id: 'npc-b', record_ref: 'memory:record-b' };
  s.provider.grantQuery(otherScope, true);
  s.provider.grantRecord(otherScope, otherRecord.record_ref, otherRecord.record_version, true);
  s.provider.putRecord(otherRecord);
  await s.provider.rebuildIndex(s.scope.world_id);
  assert.equal((await s.provider.reconcile(s.scope.world_id)).status, 'current');

  pauseSnapshot = true;
  const mutableScope = { ...s.scope };
  const pending = s.provider.retrieveCandidates(mutableScope);
  await enteredPromise;
  mutableScope.subject_id = 'npc-b';
  releaseResolve();
  const result = await pending;

  assert.equal(result.scope.subject_id, s.scope.subject_id);
  assert.deepEqual(result.candidates.map((candidate) => candidate.record.ref), ['memory:record-a']);
});

test('candidate authorization snapshots identity before an awaited source check', async (t) => {
  let pauseValidation = false;
  let enteredResolve;
  let releaseResolve;
  const enteredPromise = new Promise((resolve) => { enteredResolve = resolve; });
  const releasePromise = new Promise((resolve) => { releaseResolve = resolve; });
  const s = setup(t, {
    validateSourceVersion: async (record) => {
      if (pauseValidation && record.record_ref === 'memory:record-a') {
        enteredResolve();
        await releasePromise;
      }
      return record.source_version === 'source-v1' && record.source_entity_id === 'entity-source-a';
    },
  });

  s.provider.grantQuery(s.scope, true);
  s.provider.grantRecord(s.scope, s.record.record_ref, s.record.record_version, true);
  s.provider.putRecord(s.record);
  const otherScope = { ...s.scope, subject_id: 'npc-b' };
  const otherRecord = { ...s.record, subject_id: 'npc-b', record_ref: 'memory:record-b' };
  s.provider.grantQuery(otherScope, true);
  s.provider.grantRecord(otherScope, otherRecord.record_ref, otherRecord.record_version, true);
  s.provider.putRecord(otherRecord);
  await s.provider.rebuildIndex(s.scope.world_id);
  assert.equal((await s.provider.reconcile(s.scope.world_id)).status, 'current');

  pauseValidation = true;
  const mutableInput = {
    ...s.scope,
    record_ref: s.record.record_ref,
    record_version: s.record.record_version,
    source_kind: s.record.source_kind,
    source_entity_id: s.record.source_entity_id,
  };
  const pending = s.provider.authorizeCandidate(mutableInput);
  await enteredPromise;
  mutableInput.record_ref = otherRecord.record_ref;
  s.provider.revokeRecord(otherScope, otherRecord.record_ref, otherRecord.record_version);
  releaseResolve();

  assert.equal(await pending, true, 'the in-flight decision remains bound to the originally validated record A');
});

test('external SQLite writes during source validation invalidate candidate authorization', async (t) => {
  let pauseValidation = false;
  let enteredResolve;
  let releaseResolve;
  const enteredPromise = new Promise((resolve) => { enteredResolve = resolve; });
  const releasePromise = new Promise((resolve) => { releaseResolve = resolve; });
  const s = setup(t, {
    validateSourceVersion: async (record) => {
      if (pauseValidation && record.record_ref === 'memory:record-a') {
        enteredResolve();
        await releasePromise;
      }
      return record.source_version === 'source-v1'
        && record.source_entity_id === 'entity-source-a';
    },
  });

  s.provider.grantQuery(s.scope, true);
  s.provider.grantRecord(s.scope, s.record.record_ref, s.record.record_version, true);
  s.provider.putRecord(s.record);
  await s.provider.rebuildIndex(s.scope.world_id);
  assert.equal((await s.provider.reconcile(s.scope.world_id)).status, 'current');

  pauseValidation = true;
  const pending = s.provider.authorizeCandidate({
    ...s.scope,
    record_ref: s.record.record_ref,
    record_version: s.record.record_version,
    source_kind: s.record.source_kind,
    source_entity_id: s.record.source_entity_id,
  });
  await enteredPromise;

  // This is a separate connection, not a Provider-owned handle. A committed
  // out-of-band write must be observed by the final data_version check.
  s.db.prepare(`UPDATE memory_record_grants SET allowed=0
    WHERE world_id=? AND subject_id=? AND purpose=? AND record_ref=? AND record_version=?`)
    .run(s.scope.world_id, s.scope.subject_id, s.scope.purpose,
      s.record.record_ref, s.record.record_version);
  releaseResolve();

  await assert.rejects(pending, /MEMORY_RECORD_ACCESS_REVOKED/);
});

test('source validators receive immutable nested lineage during reconciliation and candidate authorization', async (t) => {
  let checks = 0;
  const s = setup(t, {
    validateSourceVersion: async (record) => {
      assert.equal(Object.isFrozen(record), true);
      assert.equal(Object.isFrozen(record.lineage), true);
      assert.equal(Object.isFrozen(record.lineage[0]), true);
      checks += 1;
      return record.source_version === 'source-v1'
        && record.lineage[0].entity_id === 'entity-source-a';
    },
  });
  s.provider.putRecord(s.record);
  s.provider.grantQuery(s.scope, true);
  s.provider.grantRecord(s.scope, s.record.record_ref, s.record.record_version, true);
  await s.provider.rebuildIndex(s.scope.world_id);
  assert.equal((await s.provider.reconcile(s.scope.world_id)).status, 'current');
  assert.equal(await s.provider.authorizeCandidate({
    ...s.scope,
    record_ref: s.record.record_ref,
    record_version: s.record.record_version,
    source_kind: s.record.source_kind,
    source_entity_id: s.record.source_entity_id,
  }), true);
  assert.equal(checks, 2, 'both reconciliation and authorization receive the immutable callback snapshot');
});

test('persists raw record identity/version and rebuilds its derived index after restart', async (t) => {
  const s = setup(t);
  s.provider.grantQuery(s.scope, true);
  s.provider.grantRecord(s.scope, s.record.record_ref, s.record.record_version, true);
  assert.equal(s.provider.putRecord(s.record).status, 'stored');
  assert.deepEqual(await s.provider.rebuildIndex('world-a'), { status: 'rebuilt', count: 1 });
  assert.equal((await s.provider.reconcile('world-a')).status, 'current');
  s.reopen();
  const result = await s.provider.retrieveCandidates(s.scope);
  assert.equal(result.completeness, 'complete');
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].record.ref, 'memory:record-a');
  assert.equal(result.candidates[0].record.version, 'record-v1');
  assert.equal(result.candidates[0].source.entity_id, 'entity-source-a');
});

test('durable record survives ingest index-write failure and recovers after restart/rebuild', async (t) => {
  const s = setup(t);
  s.provider.grantQuery(s.scope, true);
  s.provider.grantRecord(s.scope, s.record.record_ref, s.record.record_version, true);
  s.db.exec(`CREATE TRIGGER fail_ingest_index_insert BEFORE INSERT ON memory_index_entries
    BEGIN SELECT RAISE(ABORT, 'injected ingest index failure'); END;`);

  assert.throws(() => s.provider.putRecord(s.record), /injected ingest index failure/);
  assert.equal(s.db.prepare(
    'SELECT COUNT(*) AS count FROM memory_records WHERE world_id=? AND record_ref=?',
  ).get(s.scope.world_id, s.record.record_ref).count, 1,
  'durable source record must survive the separate derived-index failure');
  assert.equal(s.db.prepare(
    'SELECT COUNT(*) AS count FROM memory_index_entries WHERE world_id=? AND record_ref=?',
  ).get(s.scope.world_id, s.record.record_ref).count, 0);
  assert.deepEqual(s.provider.getIndexStatusForDiagnostics(s.scope.world_id), {
    index_health: 'unavailable',
    source_reconciliation: 'stale',
    snapshot: null,
    failure_code: 'INDEX_WRITE_FAILED',
  });

  s.db.exec('DROP TRIGGER fail_ingest_index_insert');
  s.reopen();
  await assert.rejects(() => s.provider.retrieveCandidates(s.scope), /MEMORY_INDEX_NOT_READY/);
  assert.deepEqual(await s.provider.rebuildIndex(s.scope.world_id), { status: 'rebuilt', count: 1 });
  assert.equal((await s.provider.reconcile(s.scope.world_id)).status, 'current');
  const result = await s.provider.retrieveCandidates(s.scope);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].record.ref, s.record.record_ref);
});

test('denies by default and immediately honors record revocation', async (t) => {
  const s = setup(t);
  assert.equal(s.provider.authorizeQuery(s.scope), false);
  s.provider.grantQuery(s.scope, true);
  s.provider.putRecord(s.record);
  s.provider.grantRecord(s.scope, s.record.record_ref, s.record.record_version, true);
  await s.provider.rebuildIndex('world-a');
  assert.equal((await s.provider.reconcile('world-a')).status, 'current');
  assert.equal(await s.provider.authorizeCandidate({
    ...s.scope, record_ref: s.record.record_ref, record_version: s.record.record_version,
    source_kind: 'canonical_entity', source_entity_id: 'entity-source-a',
  }), true);
  s.provider.revokeRecord(s.scope, s.record.record_ref, s.record.record_version);
  assert.equal(await s.provider.authorizeCandidate({
    ...s.scope, record_ref: s.record.record_ref, record_version: s.record.record_version,
    source_kind: 'canonical_entity', source_entity_id: 'entity-source-a',
  }), false);
  await assert.rejects(() => s.provider.retrieveCandidates(s.scope), /MEMORY_RECORDS_WITHHELD/);
});


test('marks provider unavailable when the current Core snapshot cannot be read', async (t) => {
  let snapshotUnavailable = false;
  const s = setup(t, {
    getSnapshot: async () => {
      if (snapshotUnavailable) throw new Error('host snapshot unavailable');
      return { world_revision: 4, commit_sequence: 2 };
    },
  });
  s.provider.grantQuery(s.scope, true);
  s.provider.putRecord(s.record);
  s.provider.grantRecord(s.scope, s.record.record_ref, s.record.record_version, true);
  await s.provider.rebuildIndex('world-a');
  assert.equal((await s.provider.reconcile('world-a')).status, 'current');

  snapshotUnavailable = true;
  await assert.rejects(() => s.provider.retrieveCandidates(s.scope), /MEMORY_SNAPSHOT_UNAVAILABLE/);
  await assert.rejects(() => s.provider.retrieveCandidates(s.scope), /MEMORY_INDEX_NOT_READY/);
});

test('does not report current when Core snapshot changes after reconciliation', async (t) => {
  const s = setup(t);
  s.provider.grantQuery(s.scope, true);
  s.provider.putRecord(s.record);
  s.provider.grantRecord(s.scope, s.record.record_ref, s.record.record_version, true);
  await s.provider.rebuildIndex('world-a');
  assert.equal((await s.provider.reconcile('world-a')).status, 'current');
  s.setSnapshot({ world_revision: 5, commit_sequence: 2 });
  await assert.rejects(() => s.provider.retrieveCandidates(s.scope), /MEMORY_SNAPSHOT_STALE/);
  await assert.rejects(() => s.provider.retrieveCandidates(s.scope), /MEMORY_INDEX_NOT_READY/);
});

test('fails reconciliation closed for stale source versions and conflicting duplicate identities', async (t) => {
  const s = setup(t);
  s.provider.putRecord(s.record);
  await s.provider.rebuildIndex('world-a');
  s.setSourceVersion('source-v2');
  assert.equal((await s.provider.reconcile('world-a')).status, 'stale');
  assert.throws(() => s.provider.putRecord({ ...s.record, source_entity_id: 'entity-other' }), /Invalid direct-source Memory record/);
  assert.throws(() => s.provider.putRecord({ ...s.record, content_kind: 'summary' }), /Invalid direct-source Memory record/);
});

test('does not turn duplicate ingest into a second record or permit identity rebinding', async (t) => {
  const s = setup(t);
  assert.equal(s.provider.putRecord(s.record).status, 'stored');
  assert.equal(s.provider.putRecord(s.record).status, 'duplicate');
  assert.throws(() => s.provider.putRecord({ ...s.record, source_version: 'source-v2',
    lineage: [{ source_kind: 'canonical_entity', entity_id: 'entity-source-a', source_version: 'source-v2' }] }),
  /MEMORY_IDENTITY_CONFLICT/);
});

test('rechecks provider grants after asynchronous source validation', async (t) => {
  let releaseValidation;
  let validationStarted;
  let holdValidation = false;
  const started = new Promise((resolve) => { validationStarted = resolve; });
  const pendingValidation = new Promise((resolve) => { releaseValidation = resolve; });
  const s = setup(t, {
    validateSourceVersion: async (candidate) => {
      if (holdValidation) {
        validationStarted();
        await pendingValidation;
      }
      return candidate.source_version === 'source-v1';
    },
  });
  s.provider.grantQuery(s.scope, true);
  s.provider.putRecord(s.record);
  s.provider.grantRecord(s.scope, s.record.record_ref, s.record.record_version, true);
  await s.provider.rebuildIndex(s.scope.world_id);
  assert.equal((await s.provider.reconcile(s.scope.world_id)).status, 'current');
  holdValidation = true;

  const authorization = s.provider.authorizeCandidate({
    ...s.scope, record_ref: s.record.record_ref, record_version: s.record.record_version,
    source_kind: 'canonical_entity', source_entity_id: 'entity-source-a',
  });
  await started;
  s.provider.revokeRecord(s.scope, s.record.record_ref, s.record.record_version);
  releaseValidation();
  await assert.rejects(authorization, /MEMORY_RECORD_ACCESS_REVOKED/);
});

test('rejects authorization when another Provider connection changes readiness during source validation', async (t) => {
  let releaseValidation;
  let validationStarted;
  let holdValidation = false;
  const started = new Promise((resolve) => { validationStarted = resolve; });
  const pendingValidation = new Promise((resolve) => { releaseValidation = resolve; });
  const s = setup(t, {
    validateSourceVersion: async (candidate) => {
      if (holdValidation) {
        validationStarted();
        await pendingValidation;
      }
      return candidate.source_version === 'source-v1';
    },
  });
  s.provider.grantQuery(s.scope, true);
  s.provider.putRecord(s.record);
  s.provider.grantRecord(s.scope, s.record.record_ref, s.record.record_version, true);
  await s.provider.rebuildIndex(s.scope.world_id);
  assert.equal((await s.provider.reconcile(s.scope.world_id)).status, 'current');
  holdValidation = true;

  const authorization = s.provider.authorizeCandidate({
    ...s.scope, record_ref: s.record.record_ref, record_version: s.record.record_version,
    source_kind: 'canonical_entity', source_entity_id: 'entity-source-a',
  });
  await started;

  const other = new SQLiteMemoryProvider({
    path: s.path,
    coordinatorPath: join(dirname(s.path), 'coordinator.sqlite'),
    getSnapshot: async () => ({ world_revision: 4, commit_sequence: 2 }),
    validateSourceVersion: async (candidate) => candidate.source_version === 'source-v1',
    validateInventory: async () => true,
  });
  try {
    await other.rebuildIndex(s.scope.world_id);
    releaseValidation();
    await assert.rejects(authorization, /MEMORY_AUTHORIZATION_CHANGED/);
  } finally {
    other.close();
  }
});


test('rejects cross-connection query-grant revoke/re-grant ABA during source validation', async (t) => {
  let releaseValidation;
  let validationStarted;
  let holdValidation = false;
  const started = new Promise((resolve) => { validationStarted = resolve; });
  const pendingValidation = new Promise((resolve) => { releaseValidation = resolve; });
  const s = setup(t, {
    validateSourceVersion: async (candidate) => {
      if (holdValidation) {
        validationStarted();
        await pendingValidation;
      }
      return candidate.source_version === 'source-v1';
    },
  });
  s.provider.grantQuery(s.scope, true);
  s.provider.putRecord(s.record);
  s.provider.grantRecord(s.scope, s.record.record_ref, s.record.record_version, true);
  await s.provider.rebuildIndex(s.scope.world_id);
  assert.equal((await s.provider.reconcile(s.scope.world_id)).status, 'current');
  holdValidation = true;

  const authorization = s.provider.authorizeCandidate({
    ...s.scope, record_ref: s.record.record_ref, record_version: s.record.record_version,
    source_kind: 'canonical_entity', source_entity_id: 'entity-source-a',
  });
  await started;

  const other = new SQLiteMemoryProvider({
    path: s.path,
    coordinatorPath: join(dirname(s.path), 'coordinator.sqlite'),
    getSnapshot: async () => ({ world_revision: 4, commit_sequence: 2 }),
    validateSourceVersion: async (candidate) => candidate.source_version === 'source-v1',
    validateInventory: async () => true,
  });
  try {
    other.grantQuery(s.scope, false);
    other.grantQuery(s.scope, true);
  } finally {
    other.close();
  }

  releaseValidation();
  await assert.rejects(authorization, /MEMORY_AUTHORIZATION_CHANGED/);
});

test('rejects cross-connection revoke/re-grant ABA during source validation', async (t) => {
  let releaseValidation;
  let validationStarted;
  let holdValidation = false;
  const started = new Promise((resolve) => { validationStarted = resolve; });
  const pendingValidation = new Promise((resolve) => { releaseValidation = resolve; });
  const s = setup(t, {
    validateSourceVersion: async (candidate) => {
      if (holdValidation) {
        validationStarted();
        await pendingValidation;
      }
      return candidate.source_version === 'source-v1';
    },
  });
  s.provider.grantQuery(s.scope, true);
  s.provider.putRecord(s.record);
  s.provider.grantRecord(s.scope, s.record.record_ref, s.record.record_version, true);
  await s.provider.rebuildIndex(s.scope.world_id);
  assert.equal((await s.provider.reconcile(s.scope.world_id)).status, 'current');
  holdValidation = true;

  const authorization = s.provider.authorizeCandidate({
    ...s.scope, record_ref: s.record.record_ref, record_version: s.record.record_version,
    source_kind: 'canonical_entity', source_entity_id: 'entity-source-a',
  });
  await started;

  const other = new SQLiteMemoryProvider({
    path: s.path,
    coordinatorPath: join(dirname(s.path), 'coordinator.sqlite'),
    getSnapshot: async () => ({ world_revision: 4, commit_sequence: 2 }),
    validateSourceVersion: async (candidate) => candidate.source_version === 'source-v1',
    validateInventory: async () => true,
  });
  try {
    other.revokeRecord(s.scope, s.record.record_ref, s.record.record_version);
    other.grantRecord(s.scope, s.record.record_ref, s.record.record_version, true);
  } finally {
    other.close();
  }

  releaseValidation();
  await assert.rejects(authorization, /MEMORY_AUTHORIZATION_CHANGED/);
});

test('does not publish current when source inventory completeness cannot be confirmed', async (t) => {
  const s = setup(t, { validateInventory: async () => false });
  s.provider.grantQuery(s.scope, true);
  s.provider.putRecord(s.record);
  await s.provider.rebuildIndex('world-a');
  assert.equal((await s.provider.reconcile('world-a')).status, 'stale');
  await assert.rejects(() => s.provider.retrieveCandidates(s.scope), /MEMORY_INDEX_NOT_READY/);
});
test('raw ingest survives a derived-index failure and becomes usable only after rebuild', async (t) => {
  const s = setup(t);
  s.provider.grantQuery(s.scope, true);
  s.db.exec(`CREATE TRIGGER fail_index_insert BEFORE INSERT ON memory_index_entries
    BEGIN SELECT RAISE(ABORT, 'injected index failure'); END;`);
  assert.throws(() => s.provider.putRecord(s.record), /injected index failure/);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS count FROM memory_records WHERE world_id=?')
    .get('world-a').count, 1);
  await assert.rejects(() => s.provider.retrieveCandidates(s.scope), /MEMORY_INDEX_NOT_READY/);
  s.db.exec('DROP TRIGGER fail_index_insert');
  assert.deepEqual(await s.provider.rebuildIndex('world-a'), { status: 'rebuilt', count: 1 });
  assert.equal((await s.provider.reconcile('world-a')).status, 'current');
  await assert.rejects(() => s.provider.retrieveCandidates(s.scope), /MEMORY_RECORDS_WITHHELD/);
});

test('isolates identical record identities and grants across worlds', async (t) => {
  const s = setup(t);
  const otherScope = { world_id: 'world-b', subject_id: 'npc-b', purpose: 'npc_decision' };
  const otherRecord = {
    ...s.record,
    ...otherScope,
  };

  s.provider.grantQuery(s.scope, true);
  s.provider.grantRecord(s.scope, s.record.record_ref, s.record.record_version, true);
  s.provider.grantQuery(otherScope, true);
  s.provider.grantRecord(otherScope, otherRecord.record_ref, otherRecord.record_version, true);
  assert.equal(s.provider.putRecord(s.record).status, 'stored');
  assert.equal(s.provider.putRecord(otherRecord).status, 'stored');

  await s.provider.rebuildIndex('world-a');
  await s.provider.rebuildIndex('world-b');
  assert.equal((await s.provider.reconcile('world-a')).status, 'current');
  assert.equal((await s.provider.reconcile('world-b')).status, 'current');

  const resultA = await s.provider.retrieveCandidates(s.scope);
  const resultB = await s.provider.retrieveCandidates(otherScope);
  assert.deepEqual(resultA.candidates.map((candidate) => candidate.world_id), ['world-a']);
  assert.deepEqual(resultB.candidates.map((candidate) => candidate.world_id), ['world-b']);
  assert.equal(resultA.candidates[0].subject_id, 'npc-a');
  assert.equal(resultB.candidates[0].subject_id, 'npc-b');
});

test('distinguishes authorized complete-empty retrieval from denied query without leaking record details', async (t) => {
  const s = setup(t);
  s.provider.grantQuery(s.scope, true);
  await s.provider.rebuildIndex('world-a');
  assert.equal((await s.provider.reconcile('world-a')).status, 'current');

  const empty = await s.provider.retrieveCandidates(s.scope);
  assert.deepEqual(empty.candidates, []);
  assert.equal(empty.completeness, 'complete');

  const deniedScope = { world_id: 'world-a', subject_id: 'npc-denied', purpose: 'npc_decision' };
  await assert.rejects(
    () => s.provider.retrieveCandidates(deniedScope),
    (error) => error.message === 'MEMORY_QUERY_DENIED',
  );
});

test('returns partial rather than complete when more than 50 authorized candidates exist', async (t) => {
  const s = setup(t);
  s.provider.grantQuery(s.scope, true);
  for (let index = 0; index < 51; index += 1) {
    const record = {
      ...s.record,
      record_ref: `memory:record-${String(index).padStart(2, '0')}`,
      record_version: 'record-v1',
    };
    s.provider.putRecord(record);
    s.provider.grantRecord(s.scope, record.record_ref, record.record_version, true);
  }
  await s.provider.rebuildIndex('world-a');
  assert.equal((await s.provider.reconcile('world-a')).status, 'current');

  const result = await s.provider.retrieveCandidates(s.scope);
  assert.equal(result.candidates.length, 50);
  assert.equal(result.completeness, 'partial');
});

test('interrupted index rebuild remains unavailable after provider restart', async (t) => {
  const s = setup(t);
  s.provider.grantQuery(s.scope, true);
  s.provider.putRecord(s.record);
  s.provider.grantRecord(s.scope, s.record.record_ref, s.record.record_version, true);
  await s.provider.rebuildIndex('world-a');
  assert.equal((await s.provider.reconcile('world-a')).status, 'current');

  s.db.exec(`CREATE TRIGGER fail_rebuild_insert BEFORE INSERT ON memory_index_entries
    BEGIN SELECT RAISE(ABORT, 'injected rebuild failure'); END;`);
  await assert.rejects(() => s.provider.rebuildIndex('world-a'), /injected rebuild failure/);
  s.reopen();

  await assert.rejects(
    () => s.provider.retrieveCandidates(s.scope),
    /MEMORY_INDEX_NOT_READY/,
  );
});

test('source validator outage is not collapsed into ordinary record denial', async (t) => {
  let unavailable = false;
  const s = setup(t, {
    validateSourceVersion: async (record) => {
      if (unavailable) throw new Error('private host validator details');
      return record.source_version === 'source-v1' && record.source_entity_id === 'entity-source-a';
    },
  });
  s.provider.grantQuery(s.scope, true);
  s.provider.putRecord(s.record);
  s.provider.grantRecord(s.scope, s.record.record_ref, s.record.record_version, true);
  await s.provider.rebuildIndex('world-a');
  assert.equal((await s.provider.reconcile('world-a')).status, 'current');

  unavailable = true;
  await assert.rejects(
    () => s.provider.authorizeCandidate({
      ...s.scope, record_ref: s.record.record_ref, record_version: s.record.record_version,
      source_kind: 'canonical_entity', source_entity_id: 'entity-source-a',
    }),
    (error) => error.message === 'MEMORY_SOURCE_VALIDATION_UNAVAILABLE'
      && !error.message.includes('private host'),
  );
});

test('provider rejects derived summaries until lineage-wide authorization is implemented', (t) => {
  const s = setup(t);
  assert.throws(
    () => s.provider.putRecord({
      ...s.record,
      record_ref: 'memory:derived-summary',
      content_kind: 'summary',
      lineage: [{ source_kind: 'canonical_entity', entity_id: 'entity-source-a', source_version: 'source-v1' }],
    }),
    /Invalid direct-source Memory record/,
  );
  assert.equal(s.db.prepare(
    'SELECT COUNT(*) AS count FROM memory_records WHERE world_id=? AND record_ref=?',
  ).get(s.scope.world_id, 'memory:derived-summary').count, 0);
});

test('source version becoming unverifiable at candidate authorization is not filtered as ordinary denial', async (t) => {
  let sourceCurrent = true;
  const s = setup(t, {
    validateSourceVersion: async (record) => sourceCurrent
      && record.source_version === 'source-v1'
      && record.source_entity_id === 'entity-source-a',
  });
  s.provider.grantQuery(s.scope, true);
  s.provider.putRecord(s.record);
  s.provider.grantRecord(s.scope, s.record.record_ref, s.record.record_version, true);
  await s.provider.rebuildIndex('world-a');
  assert.equal((await s.provider.reconcile('world-a')).status, 'current');

  sourceCurrent = false;
  await assert.rejects(
    () => s.provider.authorizeCandidate({
      ...s.scope, record_ref: s.record.record_ref, record_version: s.record.record_version,
      source_kind: 'canonical_entity', source_entity_id: 'entity-source-a',
    }),
    (error) => error.message === 'MEMORY_SOURCE_VERSION_UNVERIFIABLE',
  );
});

test('distinguishes indexed but ungranted records from authorized complete-empty', async (t) => {
  const s = setup(t);
  s.provider.grantQuery(s.scope, true);
  s.provider.putRecord(s.record);
  await s.provider.rebuildIndex(s.scope.world_id);
  assert.equal((await s.provider.reconcile(s.scope.world_id)).status, 'current');

  await assert.rejects(
    () => s.provider.retrieveCandidates(s.scope),
    (error) => error.message === 'MEMORY_RECORDS_WITHHELD',
  );
  assert.equal(JSON.stringify(s.provider.getIndexStatusForDiagnostics(s.scope.world_id))
    .includes(s.record.record_ref), false);
});


test('validator outage during reconciliation persists non-ready state across restart', async (t) => {
  let unavailable = false;
  const s = setup(t, {
    validateSourceVersion: async (record) => {
      if (unavailable) throw new Error('private validator outage details');
      return record.source_version === 'source-v1'
        && record.source_entity_id === 'entity-source-a';
    },
  });
  s.provider.grantQuery(s.scope, true);
  s.provider.grantRecord(s.scope, s.record.record_ref, s.record.record_version, true);
  s.provider.putRecord(s.record);
  await s.provider.rebuildIndex(s.scope.world_id);
  assert.equal((await s.provider.reconcile(s.scope.world_id)).status, 'current');

  unavailable = true;
  assert.deepEqual(await s.provider.reconcile(s.scope.world_id), {
    status: 'stale',
    reason: 'SOURCE_VALIDATION_FAILED',
  });
  assert.deepEqual(s.provider.getIndexStatusForDiagnostics(s.scope.world_id), {
    index_health: 'stale',
    source_reconciliation: 'stale',
    snapshot: null,
    failure_code: 'SOURCE_VALIDATION_FAILED',
  });

  s.reopen();
  assert.deepEqual(s.provider.getIndexStatusForDiagnostics(s.scope.world_id), {
    index_health: 'stale',
    source_reconciliation: 'stale',
    snapshot: null,
    failure_code: 'SOURCE_VALIDATION_FAILED',
  });
  await assert.rejects(
    () => s.provider.retrieveCandidates(s.scope),
    (error) => error.message === 'MEMORY_INDEX_NOT_READY',
  );
});


test('record revocation survives Provider restart and index rebuild cannot restore access', async (t) => {
  const s = setup(t);
  s.provider.grantQuery(s.scope, true);
  s.provider.grantRecord(s.scope, s.record.record_ref, s.record.record_version, true);
  s.provider.putRecord(s.record);
  await s.provider.rebuildIndex(s.scope.world_id);
  assert.equal((await s.provider.reconcile(s.scope.world_id)).status, 'current');
  assert.equal((await s.provider.retrieveCandidates(s.scope)).candidates.length, 1);

  s.provider.revokeRecord(s.scope, s.record.record_ref, s.record.record_version);
  s.reopen();

  assert.equal(await s.provider.authorizeCandidate({
    ...s.scope,
    record_ref: s.record.record_ref,
    record_version: s.record.record_version,
    source_kind: 'canonical_entity',
    source_entity_id: s.record.source_entity_id,
  }), false, 'revoked record grant must remain revoked after restart');
  await s.provider.rebuildIndex(s.scope.world_id);
  assert.equal((await s.provider.reconcile(s.scope.world_id)).status, 'current');
  await assert.rejects(() => s.provider.retrieveCandidates(s.scope), /MEMORY_RECORDS_WITHHELD/);
});


test('Provider input snapshot rejects Object.prototype pollution before inherited getters run', (t) => {
  const s = setup(t);
  const incomplete = { ...s.record };
  delete incomplete.lineage;
  const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'lineage');
  let getterCalls = 0;

  Object.defineProperty(Object.prototype, 'lineage', {
    configurable: true,
    get() {
      getterCalls += 1;
      throw new Error('inherited lineage getter must not execute');
    },
  });

  try {
    assert.throws(
      () => s.provider.putRecord(incomplete),
      /Invalid direct-source Memory record/,
    );
  } finally {
    if (descriptor) Object.defineProperty(Object.prototype, 'lineage', descriptor);
    else delete Object.prototype.lineage;
  }

  assert.equal(getterCalls, 0);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS count FROM memory_records').get().count, 0);
});

test('Provider trust callbacks and authorization epochs cannot be shadowed through public properties', async (t) => {
  const s = setup(t);
  for (const name of [
    'getSnapshot', 'validateSourceVersion', 'validateInventory', 'authorizeRawRead',
    'reconcileGeneration', 'transactionDepth', 'coordinatorDepth', 'stateGeneration',
    'queryAuthorizationGeneration', 'recordAuthorizationGeneration',
  ]) {
    assert.equal(s.provider[name], undefined, `Provider must not expose ${name}`);
  }

  // A caller cannot shadow public methods or attach state to this capability.
  for (const name of [
    'getSnapshot', 'validateSourceVersion', 'validateInventory', 'authorizeRawRead',
    'transactionDepth', 'coordinatorDepth', 'queryAuthorizationGeneration',
    'recordAuthorizationGeneration', 'authorizeQuery', 'authorizeCandidate',
    'retrieveCandidates', 'grantRecord', 'revokeRecord',
  ]) {
    assert.equal(Reflect.set(s.provider, name, () => true), false, `must not shadow ${name}`);
    assert.equal(Object.hasOwn(s.provider, name), false);
  }
  s.setSourceVersion('source-v2');

  s.provider.putRecord(s.record);
  s.provider.grantQuery(s.scope, true);
  const result = await s.provider.reconcile(s.scope.world_id);
  assert.equal(result.status, 'stale');
  assert.match(result.reason, /SOURCE|LINEAGE|INVENTORY|VALIDATION/);
});


test('untrusted Core snapshot objects with accessors or proxies fail closed without executing getters', async (t) => {
  let getterCalls = 0;
  const s = setup(t, {
    getSnapshot: async () => Object.defineProperty({}, 'world_revision', {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error('snapshot getter must not execute');
      },
    }),
  });

  assert.deepEqual(await s.provider.reconcile(s.scope.world_id), {
    status: 'unavailable',
    reason: 'CORE_SNAPSHOT_UNAVAILABLE',
  });
  assert.equal(getterCalls, 0);

  const proxied = setup(t, {
    getSnapshot: async () => new Proxy(
      { world_revision: 4, commit_sequence: 2 },
      { get(target, key, receiver) {
        // Async callback resolution probes "then"; allow that protocol lookup
        // without counting it as snapshot field access.
        if (key === 'then') return undefined;
        getterCalls += 1;
        throw new Error('snapshot proxy trap must not execute');
      } },
    ),
  });
  assert.deepEqual(await proxied.provider.reconcile(proxied.scope.world_id), {
    status: 'unavailable',
    reason: 'CORE_SNAPSHOT_UNAVAILABLE',
  });
  assert.equal(getterCalls, 0);
});


test('identical duplicate ingest repairs a missing index entry after raw-first failure', async (t) => {
  const s = setup(t);
  s.db.exec(`CREATE TRIGGER fail_ingest_index_insert BEFORE INSERT ON memory_index_entries
    BEGIN SELECT RAISE(ABORT, 'injected duplicate repair index failure'); END;`);

  assert.throws(() => s.provider.putRecord(s.record), /injected duplicate repair index failure/);
  assert.equal(s.db.prepare(
    'SELECT COUNT(*) AS count FROM memory_records WHERE world_id=? AND record_ref=? AND record_version=?',
  ).get(s.scope.world_id, s.record.record_ref, s.record.record_version).count, 1);
  assert.equal(s.db.prepare(
    'SELECT COUNT(*) AS count FROM memory_index_entries WHERE world_id=? AND record_ref=? AND record_version=?',
  ).get(s.scope.world_id, s.record.record_ref, s.record.record_version).count, 0);

  s.db.exec('DROP TRIGGER fail_ingest_index_insert');
  s.db.exec(`CREATE TRIGGER fail_duplicate_repair BEFORE INSERT ON memory_index_entries
    BEGIN SELECT RAISE(ABORT, 'injected duplicate repair index failure'); END;`);
  assert.throws(() => s.provider.putRecord(s.record), /injected duplicate repair index failure/);
  assert.deepEqual(s.provider.getIndexStatusForDiagnostics(s.scope.world_id), {
    index_health: 'unavailable',
    source_reconciliation: 'stale',
    snapshot: null,
    failure_code: 'INDEX_WRITE_FAILED',
  });

  s.db.exec('DROP TRIGGER fail_duplicate_repair');
  assert.deepEqual(s.provider.putRecord(s.record), {
    status: 'duplicate',
    record_ref: s.record.record_ref,
    record_version: s.record.record_version,
    index_repaired: true,
    reconciliation_required: true,
  });
  assert.equal(s.db.prepare(
    'SELECT COUNT(*) AS count FROM memory_records WHERE world_id=? AND record_ref=? AND record_version=?',
  ).get(s.scope.world_id, s.record.record_ref, s.record.record_version).count, 1);
  assert.equal(s.db.prepare(
    'SELECT COUNT(*) AS count FROM memory_index_entries WHERE world_id=? AND record_ref=? AND record_version=?',
  ).get(s.scope.world_id, s.record.record_ref, s.record.record_version).count, 1);
  assert.equal(s.provider.getIndexStatusForDiagnostics(s.scope.world_id).failure_code, 'INDEX_ENTRY_MISSING');
  s.provider.grantQuery(s.scope, true);
  await assert.rejects(() => s.provider.retrieveCandidates(s.scope), /MEMORY_INDEX_NOT_READY/);
  assert.equal((await s.provider.reconcile(s.scope.world_id)).status, 'current');
});

test('raw-record write failure publishes unavailable typed state and persists no partial record', (t) => {
  const s = setup(t);
  s.db.exec(`CREATE TRIGGER fail_raw_record_insert BEFORE INSERT ON memory_records
    BEGIN SELECT RAISE(ABORT, 'injected raw record write failure'); END;`);

  assert.throws(() => s.provider.putRecord(s.record), /injected raw record write failure/);
  assert.equal(s.db.prepare(
    'SELECT COUNT(*) AS count FROM memory_records WHERE world_id=? AND record_ref=? AND record_version=?',
  ).get(s.scope.world_id, s.record.record_ref, s.record.record_version).count, 0);
  assert.equal(s.db.prepare(
    'SELECT COUNT(*) AS count FROM memory_index_entries WHERE world_id=? AND record_ref=? AND record_version=?',
  ).get(s.scope.world_id, s.record.record_ref, s.record.record_version).count, 0);
  assert.deepEqual(s.provider.getIndexStatusForDiagnostics(s.scope.world_id), {
    index_health: 'unavailable',
    source_reconciliation: 'stale',
    snapshot: null,
    failure_code: 'RECORD_WRITE_FAILED',
  });
});
