import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import {
  enrollAcceptedHeadSync,
  finalizeAcceptedHeadSync,
} from '../src/security/accepted-head-client-sync.js';
import { MemoryDispatchGateway } from '../src/security/memory-dispatch-gateway.js';
import { createSqliteMemoryDispatchEvidenceReaders } from '../src/security/memory-dispatch-sqlite-evidence.js';

const coreToken = 'core-token-for-sqlite-evidence-tests-00000000000000000000000000000001';
const providerToken = 'provider-token-for-sqlite-evidence-tests-00000000000000000000000000000002';
const readToken = 'gateway-read-token-for-sqlite-evidence-tests-00000000000000000000000000000003';
const digestA = 'a'.repeat(64);
const digestB = 'b'.repeat(64);

async function startAuthorityProcess(path) {
  const authorityUrl = new URL('../src/security/accepted-head-authority.js', import.meta.url).href;
  const script = [
    'import { AcceptedHeadAuthority, createAcceptedHeadAuthorityServer } from ' + JSON.stringify(authorityUrl) + ';',
    'const args = process.argv.slice(1);',
    'const authority = new AcceptedHeadAuthority({ path: args[0], installationId: "sqlite-evidence-test-installation" });',
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

const source = {
  source_kind: 'canonical_entity',
  source_entity_id: 'entity-42',
  source_version: 'core-entity-v1:7',
};
const candidate = {
  record_ref: 'record-42',
  record_version: 'record-version-3',
  source_kind: 'canonical_entity',
  source_entity_id: source.source_entity_id,
  source_version: source.source_version,
};
const scope = {
  adapterId: 'adapter-1',
  conversationId: 'conversation-1',
  worldId: 'world-1',
  actorId: 'npc-1',
  purpose: 'recall',
  sources: [source],
  candidates: [candidate],
};

function seedCore(path) {
  const db = new DatabaseSync(path);
  try {
    db.exec(`
      CREATE TABLE accepted_head_state(singleton INTEGER PRIMARY KEY, head INTEGER NOT NULL, enrolled INTEGER NOT NULL);
      CREATE TABLE worlds(world_id TEXT PRIMARY KEY, status TEXT NOT NULL);
      CREATE TABLE host_conversation_world_bindings(
        adapter_id TEXT NOT NULL, conversation_id TEXT NOT NULL, world_id TEXT NOT NULL,
        active INTEGER NOT NULL, PRIMARY KEY(adapter_id,conversation_id)
      );
      CREATE TABLE actor_bindings(
        world_id TEXT NOT NULL, adapter_id TEXT NOT NULL, entity_id TEXT NOT NULL,
        active INTEGER NOT NULL, PRIMARY KEY(world_id,adapter_id,entity_id)
      );
      CREATE TABLE entities(
        world_id TEXT NOT NULL, entity_id TEXT NOT NULL, status TEXT NOT NULL,
        PRIMARY KEY(world_id,entity_id)
      );
      CREATE TABLE entity_source_versions(
        world_id TEXT NOT NULL, entity_id TEXT NOT NULL, source_version INTEGER NOT NULL,
        PRIMARY KEY(world_id,entity_id)
      );
      INSERT INTO accepted_head_state VALUES(1,4,1);
      INSERT INTO worlds VALUES('world-1','active');
      INSERT INTO host_conversation_world_bindings VALUES('adapter-1','conversation-1','world-1',1);
      INSERT INTO actor_bindings VALUES('world-1','adapter-1','npc-1',1);
      INSERT INTO entities VALUES('world-1','npc-1','active');
      INSERT INTO entities VALUES('world-1','entity-42','active');
      INSERT INTO entity_source_versions VALUES('world-1','entity-42',7);
    `);
  } finally {
    db.close();
  }
}

function seedProvider(path) {
  const db = new DatabaseSync(path);
  try {
    db.exec(`
      CREATE TABLE accepted_head_state(singleton INTEGER PRIMARY KEY, head INTEGER NOT NULL, enrolled INTEGER NOT NULL);
      CREATE TABLE memory_query_grants(
        world_id TEXT NOT NULL, subject_id TEXT NOT NULL, purpose TEXT NOT NULL, allowed INTEGER NOT NULL,
        PRIMARY KEY(world_id,subject_id,purpose)
      );
      CREATE TABLE memory_record_grants(
        world_id TEXT NOT NULL, subject_id TEXT NOT NULL, purpose TEXT NOT NULL,
        record_ref TEXT NOT NULL, record_version TEXT NOT NULL, allowed INTEGER NOT NULL,
        PRIMARY KEY(world_id,subject_id,purpose,record_ref,record_version)
      );
      CREATE TABLE memory_index_state(
        world_id TEXT PRIMARY KEY, index_health TEXT NOT NULL, source_reconciliation TEXT NOT NULL
      );
      CREATE TABLE memory_records(
        world_id TEXT NOT NULL, subject_id TEXT NOT NULL, purpose TEXT NOT NULL,
        record_ref TEXT NOT NULL, record_version TEXT NOT NULL, source_kind TEXT NOT NULL,
        source_entity_id TEXT NOT NULL, source_version TEXT NOT NULL, content_disposition TEXT NOT NULL,
        lineage_json TEXT NOT NULL, PRIMARY KEY(world_id,record_ref,record_version)
      );
      CREATE TABLE memory_index_entries(
        world_id TEXT NOT NULL, record_ref TEXT NOT NULL, record_version TEXT NOT NULL,
        PRIMARY KEY(world_id,record_ref,record_version)
      );
      INSERT INTO accepted_head_state VALUES(1,9,1);
      INSERT INTO memory_query_grants VALUES('world-1','npc-1','recall',1);
      INSERT INTO memory_record_grants VALUES('world-1','npc-1','recall','record-42','record-version-3',1);
      INSERT INTO memory_index_state VALUES('world-1','ready','current');
      INSERT INTO memory_records VALUES(
        'world-1','npc-1','recall','record-42','record-version-3','canonical_entity',
        'entity-42','core-entity-v1:7','usable',
        '[{"source_kind":"canonical_entity","entity_id":"entity-42","source_version":"core-entity-v1:7"}]'
      );
      INSERT INTO memory_index_entries VALUES('world-1','record-42','record-version-3');
    `);
  } finally {
    db.close();
  }
}

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'logic-dispatch-sqlite-evidence-'));
  const coreDatabasePath = join(directory, 'core.sqlite');
  const providerDatabasePath = join(directory, 'provider.sqlite');
  seedCore(coreDatabasePath);
  seedProvider(providerDatabasePath);
  const readers = createSqliteMemoryDispatchEvidenceReaders({ coreDatabasePath, providerDatabasePath });
  return {
    ...readers,
    coreDatabasePath,
    providerDatabasePath,
    close() {
      try { readers.close(); } finally { rmSync(directory, { recursive: true, force: true }); }
    },
  };
}

test('trusted read-only readers derive Core identity and exact source version from persisted rows', () => {
  const f = fixture();
  try {
    const evidence = f.readCoreEvidence(scope);
    assert.equal(evidence.world_id, 'world-1');
    assert.equal(evidence.actor_id, 'npc-1');
    assert.equal(evidence.readiness, 'READY');
    assert.equal(evidence.head, 4);
    assert.deepEqual(evidence.sources, [source]);
    // Current Core tables do not prove a complete inventory of deleted or
    // historical SillyTavern messages; a live dispatch must remain blocked.
    assert.equal(evidence.inventory_status, 'NOT_READY');

    assert.equal(f.readCoreEvidence({ ...scope, sources: [{ ...source, source_version: 'core-entity-v1:6' }] }).readiness, 'NOT_READY');
    assert.equal(f.readCoreEvidence({ ...scope, worldId: 'world-spoofed' }).readiness, 'NOT_READY');
    assert.equal(f.readCoreEvidence({ ...scope, actorId: 'npc-spoofed' }).readiness, 'NOT_READY');
  } finally {
    f.close();
  }
});

test('trusted Core reader fails closed after conversation or actor binding revocation', () => {
  const f = fixture();
  try {
    let db = new DatabaseSync(f.coreDatabasePath);
    db.prepare('UPDATE host_conversation_world_bindings SET active=0 WHERE adapter_id=? AND conversation_id=?')
      .run(scope.adapterId, scope.conversationId);
    db.close();
    assert.equal(f.readCoreEvidence(scope).readiness, 'NOT_READY');

    db = new DatabaseSync(f.coreDatabasePath);
    db.prepare('UPDATE host_conversation_world_bindings SET active=1 WHERE adapter_id=? AND conversation_id=?')
      .run(scope.adapterId, scope.conversationId);
    db.prepare('UPDATE actor_bindings SET active=0 WHERE world_id=? AND adapter_id=? AND entity_id=?')
      .run(scope.worldId, scope.adapterId, scope.actorId);
    db.close();
    assert.equal(f.readCoreEvidence(scope).readiness, 'NOT_READY');
  } finally {
    f.close();
  }
});

test('trusted Provider reader derives exact candidate, direct lineage, readiness, and grants from persisted rows', () => {
  const f = fixture();
  try {
    const evidence = f.readProviderEvidence(scope);
    assert.equal(evidence.world_id, 'world-1');
    assert.equal(evidence.actor_id, 'npc-1');
    assert.equal(evidence.purpose, 'recall');
    assert.equal(evidence.granted, true);
    assert.equal(evidence.readiness, 'READY');
    assert.equal(evidence.head, 9);
    assert.deepEqual(evidence.sources, [source]);
    assert.deepEqual(evidence.candidates, [candidate]);

    assert.equal(f.readProviderEvidence({
      ...scope, candidates: [{ ...candidate, record_version: 'wrong-version' }],
    }).readiness, 'NOT_READY');

    const db = new DatabaseSync(f.providerDatabasePath);
    db.prepare('UPDATE memory_record_grants SET allowed=0 WHERE world_id=? AND subject_id=? AND purpose=? AND record_ref=? AND record_version=?')
      .run(scope.worldId, scope.actorId, scope.purpose, candidate.record_ref, candidate.record_version);
    db.close();
    assert.equal(f.readProviderEvidence(scope).readiness, 'NOT_READY');
  } finally {
    f.close();
  }
});

test('trusted Provider reader fails closed for stale index, wrong lineage, or un-enrolled store', () => {
  const f = fixture();
  try {
    let db = new DatabaseSync(f.providerDatabasePath);
    db.prepare('UPDATE memory_index_state SET source_reconciliation=? WHERE world_id=?')
      .run('stale', scope.worldId);
    db.close();
    assert.equal(f.readProviderEvidence(scope).readiness, 'NOT_READY');

    db = new DatabaseSync(f.providerDatabasePath);
    db.prepare('UPDATE memory_index_state SET source_reconciliation=? WHERE world_id=?')
      .run('current', scope.worldId);
    db.prepare('UPDATE accepted_head_state SET enrolled=0 WHERE singleton=1').run();
    db.close();
    assert.equal(f.readProviderEvidence(scope).readiness, 'NOT_READY');
  } finally {
    f.close();
  }
});

test('trusted readers fail closed for deleted Core sources, removed Provider records, and revoked query grants', () => {
  const f = fixture();
  try {
    let db = new DatabaseSync(f.coreDatabasePath);
    db.prepare('UPDATE entities SET status=? WHERE world_id=? AND entity_id=?')
      .run('destroyed', scope.worldId, source.source_entity_id);
    db.close();
    assert.equal(f.readCoreEvidence(scope).readiness, 'NOT_READY');

    db = new DatabaseSync(f.coreDatabasePath);
    db.prepare('UPDATE entities SET status=? WHERE world_id=? AND entity_id=?')
      .run('active', scope.worldId, source.source_entity_id);
    db.close();
    assert.equal(f.readCoreEvidence(scope).readiness, 'READY');

    db = new DatabaseSync(f.providerDatabasePath);
    db.prepare('DELETE FROM memory_records WHERE world_id=? AND record_ref=? AND record_version=?')
      .run(scope.worldId, candidate.record_ref, candidate.record_version);
    db.close();
    assert.equal(f.readProviderEvidence(scope).readiness, 'NOT_READY');

    db = new DatabaseSync(f.providerDatabasePath);
    db.prepare('INSERT INTO memory_records VALUES(?,?,?,?,?,?,?,?,?,?)').run(
      scope.worldId, scope.actorId, scope.purpose, candidate.record_ref, candidate.record_version,
      candidate.source_kind, candidate.source_entity_id, candidate.source_version, 'usable',
      JSON.stringify([{ source_kind: 'canonical_entity', entity_id: source.source_entity_id, source_version: source.source_version }]),
    );
    db.prepare('UPDATE memory_query_grants SET allowed=0 WHERE world_id=? AND subject_id=? AND purpose=?')
      .run(scope.worldId, scope.actorId, scope.purpose);
    db.close();
    assert.equal(f.readProviderEvidence(scope).readiness, 'NOT_READY');
  } finally {
    f.close();
  }
});

test('evidence readers open databases read-only and refuse Core/Provider path aliasing', () => {
  const f = fixture();
  try {
    const db = new DatabaseSync(f.coreDatabasePath, { readOnly: true });
    try {
      db.exec('PRAGMA query_only=ON');
      assert.throws(() => db.prepare('UPDATE worlds SET status=? WHERE world_id=?').run('inactive', 'world-1'), /readonly|read-only/i);
    } finally {
      db.close();
    }
    assert.throws(() => createSqliteMemoryDispatchEvidenceReaders({
      coreDatabasePath: f.coreDatabasePath,
      providerDatabasePath: f.coreDatabasePath,
    }), /DISPATCH_EVIDENCE_DATABASE_PATH_ALIAS/);
  } finally {
    f.close();
  }
});

test('gateway wired to real SQLite evidence readers blocks dispatch when Host inventory is unproven', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-dispatch-real-readers-'));
  const coreDatabasePath = join(directory, 'core.sqlite');
  const providerDatabasePath = join(directory, 'provider.sqlite');
  const authorityPath = join(directory, 'authority.sqlite');
  const coordinatorPath = join(directory, 'coordinator.sqlite');
  const ledgerPath = join(directory, 'ledger.sqlite');
  let service;
  let gateway;
  try {
    seedCore(coreDatabasePath);
    seedProvider(providerDatabasePath);
    for (const [path, table] of [[coreDatabasePath, 'accepted_head_state'], [providerDatabasePath, 'accepted_head_state']]) {
      const db = new DatabaseSync(path);
      try { db.prepare('UPDATE accepted_head_state SET head=1,enrolled=1 WHERE singleton=1').run(); }
      finally { db.close(); }
    }

    service = await startAuthorityProcess(authorityPath);
    const coreEnrolled = enrollAcceptedHeadSync({
      domain: 'core', operationId: 'core-real-reader-baseline', operationDigest: digestA,
      token: coreToken, port: service.port,
    });
    finalizeAcceptedHeadSync({
      domain: 'core', operationId: coreEnrolled.operation_id, operationDigest: digestA,
      token: coreToken, port: service.port,
    });
    const providerEnrolled = enrollAcceptedHeadSync({
      domain: 'provider', operationId: 'provider-real-reader-baseline', operationDigest: digestB,
      token: providerToken, port: service.port,
    });
    finalizeAcceptedHeadSync({
      domain: 'provider', operationId: providerEnrolled.operation_id, operationDigest: digestB,
      token: providerToken, port: service.port,
    });

    let sends = 0;
    gateway = new MemoryDispatchGateway({
      ledgerPath,
      coordinatorPath,
      authorityPort: service.port,
      readToken,
      coreDatabasePath,
      providerDatabasePath,
      sendUpstream: () => {
        sends += 1;
        return { started: true, response: Promise.resolve({ status: 200 }) };
      },
    });
    await assert.rejects(gateway.dispatchProtectedRequest({
      requestId: 'real-readers-must-fail-closed',
      route: 'host-managed-chat-completions',
      model: 'opaque-host-model',
      stream: false,
      body: '{"messages":[]}',
      adapterId: scope.adapterId,
      conversationId: scope.conversationId,
      worldId: scope.worldId,
      actorId: scope.actorId,
      purpose: scope.purpose,
      sources: [source],
      candidates: [candidate],
    }), /MEMORY_DISPATCH_NOT_READY/);
    assert.equal(sends, 0);
    const ledger = new DatabaseSync(ledgerPath);
    try {
      assert.equal(ledger.prepare('SELECT COUNT(*) AS n FROM dispatch_ledger').get().n, 0);
    } finally {
      ledger.close();
    }
  } finally {
    try { gateway?.close(); } catch {}
    if (service?.child) {
      service.child.stdin.end('stop');
      await once(service.child, 'exit');
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
