import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { enrollAcceptedHeadDomain } from '../src/security/enroll-accepted-head-domain.js';
import { SQLiteMemoryProvider } from '../src/application/sqlite-memory-provider.js';
import {
  advanceAcceptedHeadSync,
  enrollAcceptedHeadSync,
  finalizeAcceptedHeadSync,
  getAcceptedHeadsSync,
  getAcceptedHeadStatusSync,
} from '../src/security/accepted-head-client-sync.js';

const coreToken = 'core-token-for-provider-handshake-tests-00000000000000000000000000000001';
const providerToken = 'provider-token-for-provider-handshake-tests-00000000000000000000000000000002';
const readToken = 'gateway-read-token-for-provider-handshake-tests-00000000000000000000000000000003';
const digestA = 'a'.repeat(64);
const digestB = 'b'.repeat(64);

async function startAuthorityProcess(path) {
  const authorityUrl = new URL('../src/security/accepted-head-authority.js', import.meta.url).href;
  const script = [
    'import { AcceptedHeadAuthority, createAcceptedHeadAuthorityServer } from ' + JSON.stringify(authorityUrl) + ';',
    'const args = process.argv.slice(1);',
    'const authority = new AcceptedHeadAuthority({ path: args[0], installationId: "provider-handshake-test-installation" });',
    'const server = createAcceptedHeadAuthorityServer({ authority, coreToken: process.env.LE_TEST_CORE_TOKEN, providerToken: process.env.LE_TEST_PROVIDER_TOKEN, readToken: process.env.LE_TEST_READ_TOKEN });',
    'server.listen(0, "127.0.0.1", () => process.stdout.write("LISTENING:" + server.address().port + "\\n"));',
    'process.stdin.on("data", () => server.close(() => { authority.close(); process.exit(0); }));',
  ].join('\n');
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, path], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: {
      PATH: process.env.PATH || '',
      SystemRoot: process.env.SystemRoot || '',
      WINDIR: process.env.WINDIR || '',
      LE_TEST_CORE_TOKEN: coreToken,
      LE_TEST_PROVIDER_TOKEN: providerToken,
      LE_TEST_READ_TOKEN: readToken,
    },
  });
  const [chunk] = await once(child.stdout, 'data');
  const match = String(chunk).match(/LISTENING:(\d+)/);
  if (!match) {
    child.kill();
    throw new Error('Accepted-head test service did not start.');
  }
  return { child, port: Number(match[1]) };
}

function setEnv(name, value, previous) {
  previous[name] = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

const providerOptions = (path, coordinatorPath) => ({
  path,
  coordinatorPath,
  getSnapshot: async () => ({ world_revision: 0, commit_sequence: 0 }),
  validateSourceVersion: async () => true,
  validateInventory: async () => true,
});

test('Provider mutations advance accepted head before commit and fail closed when authority is unavailable', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-provider-accepted-head-'));
  const providerPath = join(directory, 'provider.sqlite');
  const coordinatorPath = join(directory, 'coordinator.sqlite');
  const authorityPath = join(directory, 'authority.sqlite');
  const previousEnv = {};
  let child;
  let provider;
  try {
    setEnv('LOGIC_ENGINE_COORDINATOR_DB_PATH', coordinatorPath, previousEnv);
    setEnv('LOGIC_ENGINE_ACCEPTED_HEAD_REQUIRED', undefined, previousEnv);
    setEnv('LOGIC_ENGINE_ACCEPTED_HEAD_PORT', undefined, previousEnv);
    setEnv('LOGIC_ENGINE_ACCEPTED_HEAD_PROVIDER_TOKEN', undefined, previousEnv);
    const bootstrap = new SQLiteMemoryProvider(providerOptions(providerPath, coordinatorPath));
    bootstrap.close();

    const service = await startAuthorityProcess(authorityPath);
    child = service.child;
    const port = service.port;

    const enrolledCore = enrollAcceptedHeadSync({
      domain: 'core', operationId: 'core-baseline-enrollment', operationDigest: digestA, token: coreToken, port,
    });
    finalizeAcceptedHeadSync({
      domain: 'core', operationId: enrolledCore.operation_id, operationDigest: digestA, token: coreToken, port,
    });

    enrollAcceptedHeadDomain({
      domain: 'provider',
      databasePath: providerPath,
      coordinatorPath,
      port,
      token: providerToken,
      approvalId: 'approval-provider-test',
      baselineDigest: digestB,
    });

    setEnv('LOGIC_ENGINE_ACCEPTED_HEAD_PORT', String(port), previousEnv);
    setEnv('LOGIC_ENGINE_ACCEPTED_HEAD_PROVIDER_TOKEN', providerToken, previousEnv);
    setEnv('LOGIC_ENGINE_ACCEPTED_HEAD_REQUIRED', '1', previousEnv);
    provider = new SQLiteMemoryProvider(providerOptions(providerPath, coordinatorPath));
    const scope = { world_id: 'world-1', subject_id: 'npc-1', purpose: 'recall' };

    provider.grantQuery(scope, true);
    assert.equal(provider.authorizeQuery(scope), true);
    const firstOperation = provider.db.prepare(
      'SELECT head,enrolled,last_operation_id,last_operation_digest FROM accepted_head_state WHERE singleton=1',
    ).get();
    assert.equal(firstOperation.head, 2);
    assert.equal(firstOperation.enrolled, 1);
    assert.match(firstOperation.last_operation_digest, /^[a-f0-9]{64}$/);
    assert.equal(firstOperation.last_operation_id, 'provider-' + firstOperation.last_operation_digest);

    provider.grantQuery({ world_id: 'world-1', subject_id: 'npc-2', purpose: 'recall' }, true);
    const secondOperation = provider.db.prepare(
      'SELECT head,enrolled,last_operation_id,last_operation_digest FROM accepted_head_state WHERE singleton=1',
    ).get();
    assert.equal(secondOperation.head, 3);
    assert.equal(secondOperation.last_operation_id, 'provider-' + secondOperation.last_operation_digest);
    assert.notEqual(secondOperation.last_operation_digest, firstOperation.last_operation_digest);
    assert.deepEqual(getAcceptedHeadsSync({ port, token: providerToken }), { core: 1, provider: 3 });

    const recoveryDigest = 'e'.repeat(64);
    const pendingRecovery = advanceAcceptedHeadSync({
      domain: 'provider',
      operationId: 'provider-recovery-committed-operation',
      operationDigest: recoveryDigest,
      expectedHead: 3,
      token: providerToken,
      port,
    });
    assert.equal(pendingRecovery.status, 'pending');
    provider.close();
    provider = null;
    const recoveryDb = new DatabaseSync(providerPath);
    try {
      recoveryDb.prepare(
        'UPDATE accepted_head_state SET head=?,last_operation_id=?,last_operation_digest=? WHERE singleton=1',
      ).run(4, pendingRecovery.operation_id, recoveryDigest);
    } finally {
      recoveryDb.close();
    }
    provider = new SQLiteMemoryProvider(providerOptions(providerPath, coordinatorPath));
    assert.deepEqual(getAcceptedHeadsSync({ port, token: providerToken }), { core: 1, provider: 4 });

    // Verify the accepted-head wrapper covers each currently usable Provider
    // mutation family, not only query grants. Each visible state transition must
    // advance the external head and persist the same local head before returning.
    const currentProviderHead = () => provider.db.prepare(
      'SELECT head FROM accepted_head_state WHERE singleton=1',
    ).get().head;
    const assertHeadAdvanced = async (work) => {
      const before = currentProviderHead();
      await work();
      const after = currentProviderHead();
      assert.ok(after > before, 'Provider-visible mutation must advance the accepted head');
      assert.equal(getAcceptedHeadsSync({ port, token: providerToken }).provider, after);
    };

    const record = {
      world_id: scope.world_id,
      subject_id: scope.subject_id,
      purpose: scope.purpose,
      record_ref: 'memory:accepted-head-record',
      record_version: 'record-v1',
      source_kind: 'canonical_entity',
      source_entity_id: 'entity-source-a',
      source_version: 'source-v1',
      content_kind: 'claim',
      epistemic_kind: 'acquired_report',
      producer_kind: 'memory-index',
      content_disposition: 'usable',
      evidence_assessment: 'unassessed',
      lineage: [{
        source_kind: 'canonical_entity',
        entity_id: 'entity-source-a',
        source_version: 'source-v1',
      }],
    };
    await assertHeadAdvanced(() => provider.grantRecord(
      scope, record.record_ref, record.record_version, true,
    ));
    await assertHeadAdvanced(() => provider.revokeRecord(
      scope, record.record_ref, record.record_version,
    ));
    await assertHeadAdvanced(() => provider.putRecord(record));
    await assertHeadAdvanced(() => provider.rebuildIndex(scope.world_id));
    await assertHeadAdvanced(() => provider.reconcile(scope.world_id));
    assert.equal(provider.getIndexStatusForDiagnostics(scope.world_id).index_health, 'ready');
    assert.equal(provider.getIndexStatusForDiagnostics(scope.world_id).source_reconciliation, 'current');

    // A candidate read succeeds only while the accepted-head authority is
    // current and available, even when local grants/readiness remain positive.
    provider.grantQuery(scope, true);
    provider.grantRecord(scope, record.record_ref, record.record_version, true);
    const candidateRequest = {
      ...scope,
      record_ref: record.record_ref,
      record_version: record.record_version,
      source_kind: record.source_kind,
      source_entity_id: record.source_entity_id,
    };
    assert.equal(await provider.authorizeCandidate(candidateRequest), true);
    assert.equal((await provider.retrieveCandidates(scope)).candidates.length, 1);

    child.stdin.end('stop');
    await once(child, 'exit');
    child = null;

    assert.throws(() => provider.grantQuery(scope, false), /ACCEPTED_HEAD_AUTHORITY_UNAVAILABLE/);
    await assert.rejects(
      provider.authorizeCandidate(candidateRequest),
      /PROVIDER_ACCEPTED_HEAD_AUTHORITY_UNAVAILABLE/,
    );
    await assert.rejects(
      provider.retrieveCandidates(scope),
      /PROVIDER_ACCEPTED_HEAD_AUTHORITY_UNAVAILABLE/,
    );
    assert.equal(provider.authorizeQuery(scope), true);
  } finally {
    try { provider?.close(); } catch {}
    if (child) {
      child.stdin.end('stop');
      await once(child, 'exit');
    }
    for (const [name, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Provider fails closed when authority advances but the local checkpoint transaction rolls back', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-provider-accepted-head-orphaned-pending-'));
  const providerPath = join(directory, 'provider.sqlite');
  const coordinatorPath = join(directory, 'coordinator.sqlite');
  const authorityPath = join(directory, 'authority.sqlite');
  const previousEnv = {};
  let child;
  let provider;
  try {
    setEnv('LOGIC_ENGINE_COORDINATOR_DB_PATH', coordinatorPath, previousEnv);
    setEnv('LOGIC_ENGINE_ACCEPTED_HEAD_REQUIRED', undefined, previousEnv);
    setEnv('LOGIC_ENGINE_ACCEPTED_HEAD_PORT', undefined, previousEnv);
    setEnv('LOGIC_ENGINE_ACCEPTED_HEAD_PROVIDER_TOKEN', undefined, previousEnv);
    const bootstrap = new SQLiteMemoryProvider(providerOptions(providerPath, coordinatorPath));
    bootstrap.close();

    const service = await startAuthorityProcess(authorityPath);
    child = service.child;
    const port = service.port;
    const coreEnrollment = enrollAcceptedHeadSync({
      domain: 'core', operationId: 'core-orphaned-pending-baseline',
      operationDigest: digestA, token: coreToken, port,
    });
    finalizeAcceptedHeadSync({
      domain: 'core', operationId: coreEnrollment.operation_id,
      operationDigest: digestA, token: coreToken, port,
    });
    enrollAcceptedHeadDomain({
      domain: 'provider', databasePath: providerPath, coordinatorPath, port,
      token: providerToken, approvalId: 'approval-orphaned-pending-test', baselineDigest: digestB,
    });

    setEnv('LOGIC_ENGINE_ACCEPTED_HEAD_PORT', String(port), previousEnv);
    setEnv('LOGIC_ENGINE_ACCEPTED_HEAD_PROVIDER_TOKEN', providerToken, previousEnv);
    setEnv('LOGIC_ENGINE_ACCEPTED_HEAD_REQUIRED', '1', previousEnv);
    provider = new SQLiteMemoryProvider(providerOptions(providerPath, coordinatorPath));
    provider.db.exec(`CREATE TRIGGER fail_accepted_head_checkpoint
      BEFORE UPDATE ON accepted_head_state
      BEGIN SELECT RAISE(ABORT, 'injected checkpoint failure'); END;`);

    assert.throws(() => provider.grantQuery({
      world_id: 'world-orphaned', subject_id: 'npc-orphaned', purpose: 'recall',
    }, true), /injected checkpoint failure/);
    assert.equal(provider.authorizeQuery({
      world_id: 'world-orphaned', subject_id: 'npc-orphaned', purpose: 'recall',
    }), false);
    const status = getAcceptedHeadStatusSync({ port, token: readToken });
    assert.equal(status.pending.provider, true);
    assert.equal(status.heads.provider, 2);

    provider.close();
    provider = null;
    assert.throws(
      () => new SQLiteMemoryProvider(providerOptions(providerPath, coordinatorPath)),
      /PROVIDER_ACCEPTED_HEAD_RECOVERY_REQUIRED/,
    );
  } finally {
    try { provider?.close(); } catch {}
    if (child) {
      child.stdin.end('stop');
      await once(child, 'exit');
    }
    for (const [name, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
