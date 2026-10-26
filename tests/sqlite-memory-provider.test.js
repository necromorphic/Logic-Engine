import test from 'node:test';
import assert from 'node:assert/strict';
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
  const scope = { world_id: 'world-a', subject_id: 'npc-a', purpose: 'npc_decision' };
  const record = {
    ...scope, record_ref: 'memory:record-a', record_version: 'record-v1',
    source_kind: 'canonical_entity', source_entity_id: 'entity-source-a', source_version: 'source-v1',
    content_kind: 'claim', epistemic_kind: 'acquired_report', producer_kind: 'memory-index',
    content_disposition: 'usable', evidence_assessment: 'unassessed',
    lineage: [{ source_kind: 'canonical_entity', entity_id: 'entity-source-a', source_version: 'source-v1' }],
  };
  t.after(() => {
    try { provider?.close(); } catch {}
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    path, scope, record,
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
  assert.equal(provider.coordinatorDb, null);
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
  s.provider.db.exec(`CREATE TRIGGER fail_ingest_index_insert BEFORE INSERT ON memory_index_entries
    BEGIN SELECT RAISE(ABORT, 'injected ingest index failure'); END;`);

  assert.throws(() => s.provider.putRecord(s.record), /injected ingest index failure/);
  assert.equal(s.provider.db.prepare(
    'SELECT COUNT(*) AS count FROM memory_records WHERE world_id=? AND record_ref=?',
  ).get(s.scope.world_id, s.record.record_ref).count, 1,
  'durable source record must survive the separate derived-index failure');
  assert.equal(s.provider.db.prepare(
    'SELECT COUNT(*) AS count FROM memory_index_entries WHERE world_id=? AND record_ref=?',
  ).get(s.scope.world_id, s.record.record_ref).count, 0);
  assert.deepEqual(s.provider.getIndexStatusForDiagnostics(s.scope.world_id), {
    index_health: 'unavailable',
    source_reconciliation: 'stale',
    snapshot: null,
    failure_code: 'INDEX_WRITE_FAILED',
  });

  s.provider.db.exec('DROP TRIGGER fail_ingest_index_insert');
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
  s.provider.db.exec(`CREATE TRIGGER fail_index_insert BEFORE INSERT ON memory_index_entries
    BEGIN SELECT RAISE(ABORT, 'injected index failure'); END;`);
  assert.throws(() => s.provider.putRecord(s.record), /injected index failure/);
  assert.equal(s.provider.db.prepare('SELECT COUNT(*) AS count FROM memory_records WHERE world_id=?')
    .get('world-a').count, 1);
  await assert.rejects(() => s.provider.retrieveCandidates(s.scope), /MEMORY_INDEX_NOT_READY/);
  s.provider.db.exec('DROP TRIGGER fail_index_insert');
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

  s.provider.db.exec(`CREATE TRIGGER fail_rebuild_insert BEFORE INSERT ON memory_index_entries
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
  assert.equal(s.provider.db.prepare(
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
