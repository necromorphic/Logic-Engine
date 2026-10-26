import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { SQLiteMemoryProvider } from '../src/application/sqlite-memory-provider.js';

const waitFor = async (predicate, timeoutMs = 4000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(10);
  }
  throw new Error('Timed out waiting for child process marker');
};

const scope = { world_id: 'world-coordinator', subject_id: 'npc-coordinator', purpose: 'npc_decision' };
const record = {
  ...scope,
  record_ref: 'memory:coordinator',
  record_version: 'record-v1',
  source_kind: 'canonical_entity',
  source_entity_id: 'source-entity',
  source_version: 'source-v1',
  content_kind: 'claim',
  epistemic_kind: 'acquired_report',
  producer_kind: 'memory-index',
  content_disposition: 'usable',
  evidence_assessment: 'unassessed',
  lineage: [{ source_kind: 'canonical_entity', entity_id: 'source-entity', source_version: 'source-v1' }],
};

test('file-backed Provider still fails closed when no coordinator path is explicitly supplied', () => {
  const dir = mkdtempSync(join(tmpdir(), 'logic-provider-no-coordinator-'));
  try {
    assert.throws(() => new SQLiteMemoryProvider({
      path: join(dir, 'provider.sqlite'),
      coordinatorPath: null,
      getSnapshot: async () => ({ world_revision: 1, commit_sequence: 1 }),
      validateSourceVersion: async () => true,
      validateInventory: async () => true,
    }), /requires the shared LOGIC_ENGINE_COORDINATOR_DB_PATH/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Provider startup, grants, source-version records, tombstones, indexing and reconciliation join Core shared coordinator across processes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'logic-provider-coordinator-'));
  const coordinatorPath = join(dir, 'shared-coordinator.sqlite');
  const corePath = join(dir, 'core.sqlite');
  const providerPath = join(dir, 'provider.sqlite');
  const env = { ...process.env, LOGIC_ENGINE_COORDINATOR_DB_PATH: coordinatorPath };
  const coreScript = `
    import { writeFileSync } from 'node:fs';
    import { SQLiteStore } from ${JSON.stringify(new URL('../src/storage/sqlite-store.js', import.meta.url).href)};
    const [dbPath, enteredPath, holdMs] = process.argv.slice(1);
    const store = new SQLiteStore(dbPath);
    store.tx(() => {
      writeFileSync(enteredPath, 'entered');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(holdMs));
    });
    store.close();
  `;
  const providerScript = `
    import { createInterface } from 'node:readline';
    import { writeFileSync } from 'node:fs';
    import { SQLiteMemoryProvider } from ${JSON.stringify(new URL('../src/application/sqlite-memory-provider.js', import.meta.url).href)};
    const [dbPath, readyPath] = process.argv.slice(1);
    const provider = new SQLiteMemoryProvider({
      path: dbPath,
      coordinatorPath: process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH,
      getSnapshot: async () => ({ world_revision: 1, commit_sequence: 1 }),
      validateSourceVersion: async (candidate) => candidate.source_version === 'source-v1',
      validateInventory: async () => true,
    });
    const scope = ${JSON.stringify(scope)};
    const record = ${JSON.stringify(record)};
    // Seed a raw capture solely to exercise the existing tombstone mutation path.
    provider.db.prepare('INSERT INTO memory_raw_captures (world_id,conversation_id,message_id,version_id,role,content_text,content_sha256,metadata_json,captured_at,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,NULL)').run('world-coordinator','conversation','message','v1','user','text','digest','{}',new Date().toISOString());
    writeFileSync(readyPath, 'ready');
    const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
    for await (const line of rl) {
      const { id, operation } = JSON.parse(line);
      try {
        if (operation === 'grantQuery') provider.grantQuery(scope, true);
        else if (operation === 'revokeQuery') provider.grantQuery(scope, false);
        else if (operation === 'grantRecord') provider.grantRecord(scope, record.record_ref, record.record_version, true);
        else if (operation === 'revokeRecord') provider.revokeRecord(scope, record.record_ref, record.record_version);
        else if (operation === 'putRecord') provider.putRecord(record);
        // Test-only fixture mutation: simulate a previously durable record whose derived index write failed.
        else if (operation === 'removeIndexEntryForTest') provider.db.prepare('DELETE FROM memory_index_entries WHERE world_id=? AND record_ref=? AND record_version=?').run(record.world_id, record.record_ref, record.record_version);
        else if (operation === 'tombstone') provider.markRawSourceDeleted({ world_id:'world-coordinator', conversation_id:'conversation', message_id:'message', version_id:'v1' });
        else if (operation === 'purge') provider.purgeRawSource({ world_id:'world-coordinator', conversation_id:'conversation', message_id:'message', version_id:'v1' });
        else if (operation === 'rebuildIndex') await provider.rebuildIndex(scope.world_id);
        else if (operation === 'reconcile') await provider.reconcile(scope.world_id);
        else if (operation === 'close') { provider.close(); process.stdout.write(JSON.stringify({id, ok:true})+'\\n'); process.exit(0); }
        process.stdout.write(JSON.stringify({id, ok:true})+'\\n');
      } catch (error) {
        process.stdout.write(JSON.stringify({id, ok:false, error:error.message})+'\\n');
      }
    }
  `;

  const startChild = (script, args) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, ...args], {
      env, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const messages = [];
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      for (;;) {
        const newline = stdout.indexOf('\n');
        if (newline < 0) break;
        const line = stdout.slice(0, newline);
        stdout = stdout.slice(newline + 1);
        try { messages.push(JSON.parse(line)); } catch {}
      }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    // Register exit listeners immediately; short-lived Core workers can exit
    // before the parent reaches the synchronization point below.
    const exited = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => code === 0
        ? resolve({ code, signal })
        : reject(new Error('child exited with code=' + code + ', signal=' + signal + ': ' + stderr)));
    });
    // Some workers are intentionally terminated during cleanup; mark the rejection handled
    // while preserving `exited` rejection semantics for callers that await it.
    void exited.catch(() => {});
    return { child, messages, exited, get stderr() { return stderr; } };
  };
  let providerChild;
  let coreChild;
  try {
    const readyPath = join(dir, 'provider-ready');
    const providerProc = startChild(providerScript, [providerPath, readyPath]);
    providerChild = providerProc.child;
    await waitFor(() => existsSync(readyPath));
    let nextId = 0;

    const assertBlockedByCoreLock = async (operation) => {
      const enteredPath = join(dir, 'core-entered-' + operation + '-' + nextId);
      const coreProc = startChild(coreScript, [corePath, enteredPath, '450']);
      coreChild = coreProc.child;
      await waitFor(() => existsSync(enteredPath));
      const id = ++nextId;
      providerProc.child.stdin.write(JSON.stringify({ id, operation }) + '\n');
      await delay(100);
      assert.equal(providerProc.messages.some((message) => message.id === id), false,
        operation + ' must wait while Core holds the shared coordinator lock');
      await waitFor(() => providerProc.messages.some((message) => message.id === id));
      const response = providerProc.messages.find((message) => message.id === id);
      assert.equal(response.ok, true, response.error);
      coreChild = null;
      await coreProc.exited;
    };

    for (const operation of ['grantQuery', 'revokeQuery', 'grantRecord', 'revokeRecord', 'putRecord', 'tombstone', 'purge', 'rebuildIndex', 'reconcile']) {
      await assertBlockedByCoreLock(operation);
    }

    // Exercise the duplicate-ingest repair branch separately from the new-record insert.
    const repairId = ++nextId;
    providerProc.child.stdin.write(JSON.stringify({ id: repairId, operation: 'removeIndexEntryForTest' }) + '\n');
    await waitFor(() => providerProc.messages.some((message) => message.id === repairId));
    assert.equal(providerProc.messages.find((message) => message.id === repairId).ok, true);
    await assertBlockedByCoreLock('putRecord');

    // A fresh Provider DB must also take the shared lock around schema creation/migration.
    const migrationPath = join(dir, 'provider-migration.sqlite');
    const migrationReadyPath = join(dir, 'provider-migration-ready');
    const enteredPath = join(dir, 'core-entered-migration');
    const coreProc = startChild(coreScript, [corePath, enteredPath, '450']);
    coreChild = coreProc.child;
    await waitFor(() => existsSync(enteredPath));
    const migrationProc = startChild(providerScript, [migrationPath, migrationReadyPath]);
    const migrationReady = await delay(100).then(() => existsSync(migrationReadyPath));
    assert.equal(migrationReady, false, 'Provider startup DDL/migration must wait for Core coordinator lock');
    await waitFor(() => existsSync(migrationReadyPath));
    await coreProc.exited;
    migrationProc.child.stdin.end(JSON.stringify({ id: 999, operation: 'close' }) + '\n');
    await migrationProc.exited;
  } finally {
    providerChild?.kill();
    coreChild?.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
