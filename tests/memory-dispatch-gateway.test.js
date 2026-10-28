import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import {
  advanceAcceptedHeadSync,
  enrollAcceptedHeadSync,
  finalizeAcceptedHeadSync,
  getAcceptedHeadsSync,
} from '../src/security/accepted-head-client-sync.js';
import { createDispatchRequestSignature, verifyDispatchRequestSignature, MemoryDispatchGateway, openReadOnlySqliteDatabase } from '../src/security/memory-dispatch-gateway.js';
import { createMemoryDispatchGatewayServer } from '../src/security/memory-dispatch-gateway-server.js';
import { SQLiteMemoryProvider } from '../src/application/sqlite-memory-provider.js';
import { enrollAcceptedHeadDomain } from '../src/security/enroll-accepted-head-domain.js';
import { createGoogleAiStudioTransport } from '../src/security/memory-dispatch-google-transport.js';

const coreToken = 'core-token-for-dispatch-gateway-tests-00000000000000000000000000000001';
const providerToken = 'provider-token-for-dispatch-gateway-tests-00000000000000000000000000000002';
const readToken = 'gateway-read-token-for-dispatch-gateway-tests-00000000000000000000000000000003';
const digestA = 'a'.repeat(64);
const digestB = 'b'.repeat(64);
const digestC = 'c'.repeat(64);
const sourceSet = Object.freeze([{
  source_kind: 'canonical_entity',
  source_entity_id: 'entity-42',
  source_version: 'version-7',
}]);

async function startAuthorityProcess(path) {
  const authorityUrl = new URL('../src/security/accepted-head-authority.js', import.meta.url).href;
  const script = [
    'import { AcceptedHeadAuthority, createAcceptedHeadAuthorityServer } from ' + JSON.stringify(authorityUrl) + ';',
    'const args = process.argv.slice(1);',
    'const authority = new AcceptedHeadAuthority({ path: args[0], installationId: "dispatch-gateway-test-installation" });',
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

async function createFixture({ sendUpstream, coreHead = 1, providerHead = 1, initialProviderGrant = true, providerCandidatesOverride } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'logic-memory-dispatch-gateway-'));
  const authorityPath = join(directory, 'authority.sqlite');
  const coordinatorPath = join(directory, 'coordinator.sqlite');
  const ledgerPath = join(directory, 'dispatch-ledger.sqlite');
  const service = await startAuthorityProcess(authorityPath);
  let gateway;
  let closed = false;
  const coreEnrolled = enrollAcceptedHeadSync({
    domain: 'core', operationId: 'core-baseline', operationDigest: digestA, token: coreToken, port: service.port,
  });
  finalizeAcceptedHeadSync({
    domain: 'core', operationId: coreEnrolled.operation_id, operationDigest: digestA, token: coreToken, port: service.port,
  });
  const providerEnrolled = enrollAcceptedHeadSync({
    domain: 'provider', operationId: 'provider-baseline', operationDigest: digestB, token: providerToken, port: service.port,
  });
  finalizeAcceptedHeadSync({
    domain: 'provider', operationId: providerEnrolled.operation_id, operationDigest: digestB, token: providerToken, port: service.port,
  });

  let providerGranted = initialProviderGrant;
  const calls = [];
  const makeGateway = () => new MemoryDispatchGateway({
    ledgerPath,
    coordinatorPath,
    authorityPort: service.port,
    readToken,
    readCoreEvidence: ({ worldId, actorId, sources }) => ({
      head: coreHead,
      world_id: worldId,
      actor_id: actorId,
      readiness: 'READY',
      inventory_status: 'READY',
      sources,
    }),
    readProviderEvidence: ({ worldId, actorId, purpose, sources, candidates }) => ({
      head: providerHead,
      world_id: worldId,
      actor_id: actorId,
      purpose,
      granted: providerGranted,
      readiness: 'READY',
      sources,
      candidates: providerCandidatesOverride ?? candidates,
    }),
    sendUpstream: async (request) => {
      calls.push(request);
      if (sendUpstream) return sendUpstream(request);
      return { status: 200, body: 'accepted' };
    },
  });
  gateway = makeGateway();

  return {
    directory, authorityPath, coordinatorPath, ledgerPath, child: service.child, port: service.port,
    get gateway() { return gateway; },
    calls,
    reopenGateway() {
      try { gateway?.close(); } catch {}
      gateway = makeGateway();
      return gateway;
    },
    setProviderGranted(value) { providerGranted = value; },
    async close() {
      if (closed) return;
      closed = true;
      try { gateway?.close(); } catch {}
      if (service.child.exitCode === null && service.child.signalCode === null) {
        service.child.stdin.end('stop');
        await once(service.child, 'exit');
      }
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

const validRequest = (requestId = 'request-001', overrides = {}) => ({
  requestId,
  route: 'google-ai-studio-chat-completions',
  model: 'gemini-2.5-flash-lite',
  stream: false,
  body: JSON.stringify({ messages: [{ role: 'user', content: 'SECRET_MEMORY_TEXT_DO_NOT_PERSIST' }] }),
  worldId: 'world-1',
  actorId: 'npc-1',
  purpose: 'recall',
  sources: sourceSet,
  candidates: [{
    record_ref: 'record-42',
    record_version: 'record-version-3',
    source_kind: 'canonical_entity',
    source_entity_id: 'entity-42',
    source_version: 'version-7',
  }],
  ...overrides,
});

test('Host dispatch signature binds the exact body, route, model, identity, and source versions with locale-independent source ordering', () => {
  const request = validRequest('signed-request');
  const secret = 'host-dispatch-signing-secret-00000000000000000000000000000001';
  const signature = createDispatchRequestSignature(secret, request);
  assert.equal(verifyDispatchRequestSignature(secret, request, signature), true);
  assert.equal(verifyDispatchRequestSignature(secret, { ...request, body: request.body + 'tampered' }, signature), false);
  assert.equal(verifyDispatchRequestSignature(secret, { ...request, candidates: [{ ...request.candidates[0], record_version: 'record-version-4' }] }, signature), false);
  assert.equal(verifyDispatchRequestSignature(secret, { ...request, sources: [{
    source_kind: 'canonical_entity',
    source_entity_id: 'entity-42',
    source_version: 'version-8',
  }] }, signature), false);
  const reordered = { ...request,
    sources: [
      { source_kind: 'canonical_entity', source_entity_id: 'z-entity', source_version: 'v1' },
      { source_kind: 'canonical_entity', source_entity_id: 'ä-entity', source_version: 'v1' },
    ],
    candidates: [
      { record_ref: 'record-z', record_version: 'rv1', source_kind: 'canonical_entity', source_entity_id: 'z-entity', source_version: 'v1' },
      { record_ref: 'record-a', record_version: 'rv1', source_kind: 'canonical_entity', source_entity_id: 'ä-entity', source_version: 'v1' },
    ],
  };
  const reverseOrder = {
    ...reordered,
    sources: [...reordered.sources].reverse(),
    candidates: [...reordered.candidates].reverse(),
  };
  assert.equal(
    createDispatchRequestSignature(secret, reordered),
    createDispatchRequestSignature(secret, reverseOrder),
  );
});

test('read-only Gateway SQLite connection can read committed WAL state without write access', () => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-gateway-readonly-wal-'));
  const path = join(directory, 'core.sqlite');
  const writer = new DatabaseSync(path);
  let reader;
  try {
    writer.exec('PRAGMA journal_mode=WAL; CREATE TABLE sample(id INTEGER PRIMARY KEY, value TEXT NOT NULL);');
    writer.prepare('INSERT INTO sample(value) VALUES(?)').run('committed-value');
    reader = openReadOnlySqliteDatabase(path);
    assert.equal(reader.prepare('SELECT value FROM sample WHERE id=1').get().value, 'committed-value');
    assert.throws(() => reader.prepare('INSERT INTO sample(value) VALUES(?)').run('must-not-write'), /readonly|read-only/i);
    assert.equal(existsSync(path + '-wal'), true);
    assert.equal(existsSync(path + '-shm'), true);
  } finally {
    try { reader?.close(); } catch {}
    writer.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('dispatch rejects Provider evidence whose exact candidate record/version set differs from the signed request', async () => {
  const fixture = await createFixture({
    providerCandidatesOverride: [{
      record_ref: 'record-42',
      record_version: 'record-version-4',
      source_kind: 'canonical_entity',
      source_entity_id: 'entity-42',
      source_version: 'version-7',
    }],
  });
  try {
    await assert.rejects(
      fixture.gateway.dispatchProtectedRequest(validRequest('provider-candidate-mismatch')),
      /MEMORY_DISPATCH_NOT_READY/,
    );
    assert.equal(fixture.calls.length, 0, 'mismatched Provider evidence must block all upstream calls');
  } finally {
    await fixture.close();
  }
});

test('dispatch validates current heads and grants, records one content-free start, and sends once', async () => {
  const fixture = await createFixture();
  try {
    const response = await fixture.gateway.dispatchProtectedRequest(validRequest());
    assert.equal(response.status, 200);
    assert.equal(fixture.calls.length, 1);
    assert.equal(fixture.calls[0].body, validRequest().body);
    await assert.rejects(
      fixture.gateway.dispatchProtectedRequest(validRequest()),
      /MEMORY_DISPATCH_DUPLICATE_ID/,
    );
    assert.equal(fixture.calls.length, 1);

    const db = new DatabaseSync(fixture.ledgerPath);
    try {
      const row = db.prepare('SELECT status,request_digest,model,sources_json FROM dispatch_ledger WHERE request_id=?')
        .get('request-001');
      assert.equal(row.status, 'COMPLETED');
      assert.equal(row.model, 'gemini-2.5-flash-lite');
      assert.match(row.request_digest, /^[a-f0-9]{64}$/);
      assert.equal(JSON.stringify(row).includes('SECRET_MEMORY_TEXT_DO_NOT_PERSIST'), false);
    } finally {
      db.close();
    }
  } finally {
    await fixture.close();
  }
});

test('local Core or Provider head mismatch prevents dispatch before transport', async () => {
  const fixture = await createFixture({ coreHead: 2 });
  try {
    await assert.rejects(
      fixture.gateway.dispatchProtectedRequest(validRequest('stale-local-head')),
      /MEMORY_DISPATCH_NOT_READY/,
    );
    assert.equal(fixture.calls.length, 0);
  } finally {
    await fixture.close();
  }
});

test('unsupported route, denied Provider grant, and pending authority all produce zero upstream calls', async () => {
  const fixture = await createFixture();
  try {
    await assert.rejects(
      fixture.gateway.dispatchProtectedRequest(validRequest('unsupported', { route: 'vertex-ai-chat-completions' })),
      /MEMORY_DISPATCH_NOT_READY/,
    );
    fixture.setProviderGranted(false);
    await assert.rejects(
      fixture.gateway.dispatchProtectedRequest(validRequest('denied-grant')),
      /MEMORY_DISPATCH_NOT_READY/,
    );
    fixture.setProviderGranted(true);
    advanceAcceptedHeadSync({
      domain: 'provider',
      operationId: 'provider-pending-test',
      operationDigest: digestC,
      expectedHead: 1,
      token: providerToken,
      port: fixture.port,
    });
    await assert.rejects(
      fixture.gateway.dispatchProtectedRequest(validRequest('pending-authority')),
      /MEMORY_DISPATCH_NOT_READY/,
    );
    assert.equal(fixture.calls.length, 0);
  } finally {
    await fixture.close();
  }
});

test('ambiguous transport outcome is recorded UNKNOWN and the request identity cannot be replayed', async () => {
  let sends = 0;
  const fixture = await createFixture({
    sendUpstream: async () => {
      sends += 1;
      throw new Error('simulated timeout after dispatch start');
    },
  });
  try {
    await assert.rejects(
      fixture.gateway.dispatchProtectedRequest(validRequest('ambiguous-request')),
      /MEMORY_DISPATCH_OUTCOME_UNKNOWN/,
    );
    assert.equal(sends, 1);

    const db = new DatabaseSync(fixture.ledgerPath);
    try {
      const row = db.prepare('SELECT status,request_digest,route,sources_json FROM dispatch_ledger WHERE request_id=?')
        .get('ambiguous-request');
      assert.equal(row.status, 'UNKNOWN');
      assert.match(row.request_digest, /^[a-f0-9]{64}$/);
      assert.equal(row.route, 'google-ai-studio-chat-completions');
      assert.equal(JSON.stringify(row).includes('SECRET_MEMORY_TEXT_DO_NOT_PERSIST'), false);
    } finally {
      db.close();
    }

    await assert.rejects(
      fixture.gateway.dispatchProtectedRequest(validRequest('ambiguous-request')),
      /MEMORY_DISPATCH_DUPLICATE_ID/,
    );
    await assert.rejects(
      fixture.gateway.dispatchProtectedRequest(validRequest('ambiguous-request-new-id')),
      /MEMORY_DISPATCH_REPLAY_BLOCKED/,
    );
    assert.equal(sends, 1);
  } finally {
    await fixture.close();
  }
});

test('loopback Gateway endpoint requires Host authentication and a body-bound signature before Google egress', async () => {
  const apiKey = 'google-ai-studio-test-key-not-real';
  const hostToken = 'host-dispatch-token-for-gateway-tests-00000000000000000000000000000004';
  const signingKey = 'host-dispatch-signing-key-for-gateway-tests-00000000000000000000000000000005';
  let upstreamCalls = 0;
  let observedUrl;
  let observedBody;
  let observedHeaders;
  const transport = createGoogleAiStudioTransport({
    apiKey,
    fetchImpl: async (url, options) => {
      upstreamCalls += 1;
      observedUrl = String(url);
      observedBody = options.body;
      observedHeaders = options.headers;
      return new Response('{"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  const fixture = await createFixture({ sendUpstream: transport });
  const server = await createMemoryDispatchGatewayServer({
    gateway: fixture.gateway,
    hostToken,
    hostSigningKey: signingKey,
  });
  try {
    const boundAddress = server.address();
    assert.equal(boundAddress.address, '127.0.0.1');
    assert.throws(() => server.listen(0, '0.0.0.0'), /MEMORY_GATEWAY_REBIND_DENIED/);
    const url = 'http://127.0.0.1:' + boundAddress.port + '/v1/dispatch';
    const request = validRequest('http-gateway-request');
    const payload = {
      request_id: request.requestId,
      route: request.route,
      model: request.model,
      stream: request.stream,
      body: request.body,
      world_id: request.worldId,
      actor_id: request.actorId,
      purpose: request.purpose,
      sources: request.sources,
      candidates: request.candidates,
      signature: createDispatchRequestSignature(signingKey, request),
    };

    const anonymous = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(anonymous.status, 403);
    assert.equal(upstreamCalls, 0);

    const tampered = await fetch(url, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + hostToken, 'content-type': 'application/json' },
      body: JSON.stringify({ ...payload, body: payload.body + 'tampered' }),
    });
    assert.equal(tampered.status, 403);
    assert.equal(upstreamCalls, 0);

    const response = await fetch(url, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + hostToken, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /"candidates"/);
    assert.equal(upstreamCalls, 1);
    assert.equal(observedBody, request.body);
    const upstreamUrl = new URL(observedUrl);
    assert.equal(upstreamUrl.hostname, 'generativelanguage.googleapis.com');
    assert.equal(upstreamUrl.pathname, '/v1beta/models/gemini-2.5-flash-lite:generateContent');
    assert.equal(upstreamUrl.searchParams.has('key'), false);
    const apiKeyHeader = 'x-goog-' + 'api-key';
    assert.equal(observedHeaders[apiKeyHeader], apiKey);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fixture.close();
  }
});

test('gateway startup rejects any requested non-loopback bind', async () => {
  const gateway = { dispatchProtectedRequest: async () => ({ status: 200 }) };
  const hostToken = 'host-dispatch-token-for-gateway-tests-00000000000000000000000000000004';
  const hostSigningKey = 'host-dispatch-signing-key-for-gateway-tests-00000000000000000000000000000005';
  await assert.rejects(
    createMemoryDispatchGatewayServer({ gateway, hostToken, hostSigningKey, host: '0.0.0.0' }),
    /Invalid Memory dispatch Gateway server configuration/,
  );
});

test('gateway startup converts stale DISPATCH_STARTED rows to UNKNOWN and blocks new-ID replay', async () => {
  const fixture = await createFixture();
  try {
    const request = validRequest('crash-before-response');
    await fixture.gateway.dispatchProtectedRequest(request);
    const db = new DatabaseSync(fixture.ledgerPath);
    try {
      db.prepare("UPDATE dispatch_ledger SET status='DISPATCH_STARTED', finished_at=NULL WHERE request_id=?")
        .run(request.requestId);
    } finally {
      db.close();
    }
    fixture.reopenGateway();
    const verify = new DatabaseSync(fixture.ledgerPath);
    try {
      assert.equal(verify.prepare('SELECT status FROM dispatch_ledger WHERE request_id=?').get(request.requestId).status, 'UNKNOWN');
    } finally {
      verify.close();
    }
    await assert.rejects(
      fixture.gateway.dispatchProtectedRequest(validRequest('crash-replay-new-id')),
      /MEMORY_DISPATCH_REPLAY_BLOCKED/,
    );
    assert.equal(fixture.calls.length, 1);
  } finally {
    await fixture.close();
  }
});

test('existing dispatch ledger with missing schema fails closed without auto-repair', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-dispatch-ledger-schema-'));
  const ledgerPath = join(directory, 'ledger.sqlite');
  const coordinatorPath = join(directory, 'coordinator.sqlite');
  const existing = new DatabaseSync(ledgerPath);
  existing.close();
  try {
    assert.throws(() => new MemoryDispatchGateway({
      ledgerPath,
      coordinatorPath,
      authorityPort: 1,
      readToken,
      readCoreEvidence: () => ({}),
      readProviderEvidence: () => ({}),
      sendUpstream: async () => ({ status: 200 }),
    }), /DISPATCH_LEDGER_SCHEMA_INCOMPLETE/);
    const verify = new DatabaseSync(ledgerPath);
    try {
      const table = verify.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='dispatch_ledger'",
      ).get();
      assert.equal(table, undefined);
    } finally {
      verify.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});


test('real Provider revokeRecord committed before dispatch-start produces zero upstream calls', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-provider-revoke-dispatch-race-'));
  const authorityPath = join(directory, 'authority.sqlite');
  const coordinatorPath = join(directory, 'coordinator.sqlite');
  const providerPath = join(directory, 'provider.sqlite');
  const ledgerPath = join(directory, 'dispatch-ledger.sqlite');
  const previousEnv = {};
  let service;
  let provider;
  let providerReader;
  let gateway;
  const rememberEnv = (name, value) => {
    previousEnv[name] = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
  try {
    rememberEnv('LOGIC_ENGINE_COORDINATOR_DB_PATH', coordinatorPath);
    rememberEnv('LOGIC_ENGINE_ACCEPTED_HEAD_REQUIRED', undefined);
    rememberEnv('LOGIC_ENGINE_ACCEPTED_HEAD_PORT', undefined);
    rememberEnv('LOGIC_ENGINE_ACCEPTED_HEAD_PROVIDER_TOKEN', undefined);

    service = await startAuthorityProcess(authorityPath);
    const coreEnrollment = enrollAcceptedHeadSync({
      domain: 'core', operationId: 'core-provider-revoke-test-baseline',
      operationDigest: digestA, token: coreToken, port: service.port,
    });
    finalizeAcceptedHeadSync({
      domain: 'core', operationId: coreEnrollment.operation_id,
      operationDigest: digestA, token: coreToken, port: service.port,
    });

    const providerOptions = {
      path: providerPath,
      coordinatorPath,
      getSnapshot: async () => ({ world_revision: 1, commit_sequence: 1 }),
      validateSourceVersion: async (record) => record.source_version === 'version-7',
      validateInventory: async () => true,
    };
    const bootstrap = new SQLiteMemoryProvider(providerOptions);
    // Seed a legacy raw row before enrollment; direct SQL is fixture setup only.
    const rawSource = {
      world_id: 'legacy-world',
      conversation_id: 'legacy-conversation',
      message_id: 'legacy-message',
      version_id: 'legacy-version',
    };
    const rawText = 'legacy fixture only';
    bootstrap.db.prepare('INSERT INTO memory_raw_captures (world_id,conversation_id,message_id,version_id,role,content_text,content_sha256,metadata_json,captured_at,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,NULL)')
      .run(rawSource.world_id, rawSource.conversation_id, rawSource.message_id, rawSource.version_id,
        'assistant', rawText, createHash('sha256').update(rawText, 'utf8').digest('hex'), '{}',
        '2026-01-01T00:00:00.000Z');
    bootstrap.close();
    enrollAcceptedHeadDomain({
      domain: 'provider',
      databasePath: providerPath,
      coordinatorPath,
      port: service.port,
      token: providerToken,
      approvalId: 'provider-revoke-dispatch-test',
      baselineDigest: digestC,
    });
    rememberEnv('LOGIC_ENGINE_ACCEPTED_HEAD_PORT', String(service.port));
    rememberEnv('LOGIC_ENGINE_ACCEPTED_HEAD_PROVIDER_TOKEN', providerToken);
    rememberEnv('LOGIC_ENGINE_ACCEPTED_HEAD_REQUIRED', '1');

    provider = new SQLiteMemoryProvider(providerOptions);
    const request = validRequest('provider-revoked-before-start');
    const scope = { world_id: request.worldId, subject_id: request.actorId, purpose: request.purpose };
    const record = {
      ...scope,
      record_ref: request.candidates[0].record_ref,
      record_version: request.candidates[0].record_version,
      source_kind: 'canonical_entity',
      source_entity_id: request.candidates[0].source_entity_id,
      source_version: request.candidates[0].source_version,
      content_kind: 'claim',
      epistemic_kind: 'acquired_report',
      producer_kind: 'memory-index',
      content_disposition: 'usable',
      evidence_assessment: 'unassessed',
      lineage: [{
        source_kind: 'canonical_entity',
        entity_id: request.candidates[0].source_entity_id,
        source_version: request.candidates[0].source_version,
      }],
    };
    provider.grantQuery(scope, true);
    provider.putRecord(record);
    provider.grantRecord(scope, record.record_ref, record.record_version, true);
    await provider.rebuildIndex(scope.world_id);
    assert.equal((await provider.reconcile(scope.world_id)).status, 'current');

    providerReader = openReadOnlySqliteDatabase(providerPath);
    const calls = [];
    gateway = new MemoryDispatchGateway({
      ledgerPath,
      coordinatorPath,
      authorityPort: service.port,
      readToken,
      readCoreEvidence: ({ worldId, actorId, sources }) => ({
        head: 1, world_id: worldId, actor_id: actorId,
        readiness: 'READY', inventory_status: 'READY', sources,
      }),
      readProviderEvidence: ({ worldId, actorId, purpose }) => {
        const head = providerReader.prepare('SELECT head FROM accepted_head_state WHERE singleton=1').get();
        const queryGrant = providerReader.prepare('SELECT allowed FROM memory_query_grants WHERE world_id=? AND subject_id=? AND purpose=?').get(worldId, actorId, purpose);
        const recordGrant = providerReader.prepare('SELECT allowed FROM memory_record_grants WHERE world_id=? AND subject_id=? AND purpose=? AND record_ref=? AND record_version=?').get(worldId, actorId, purpose, record.record_ref, record.record_version);
        const stored = providerReader.prepare('SELECT * FROM memory_records WHERE world_id=? AND record_ref=? AND record_version=?').get(worldId, record.record_ref, record.record_version);
        const index = providerReader.prepare('SELECT index_health,source_reconciliation FROM memory_index_state WHERE world_id=?').get(worldId);
        return {
          head: head?.head,
          world_id: worldId, actor_id: actorId, purpose,
          granted: queryGrant?.allowed === 1 && recordGrant?.allowed === 1,
          readiness: index?.index_health === 'ready' && index?.source_reconciliation === 'current' ? 'READY' : 'NOT_READY',
          sources: stored ? [{ source_kind: stored.source_kind, source_entity_id: stored.source_entity_id, source_version: stored.source_version }] : [],
          candidates: stored ? [{ record_ref: stored.record_ref, record_version: stored.record_version, source_kind: stored.source_kind, source_entity_id: stored.source_entity_id, source_version: stored.source_version }] : [],
        };
      },
      sendUpstream: async (outgoing) => {
        calls.push(outgoing);
        return { status: 200, body: 'accepted' };
      },
    });

    // Tombstone and purge are real Provider mutation APIs too; the legacy row
    // was seeded before enrollment, so no enrolled write bypasses the head guard.
    const providerHead = () => provider.db.prepare(
      'SELECT head FROM accepted_head_state WHERE singleton=1',
    ).get().head;
    const beforeTombstone = providerHead();
    assert.equal(provider.markRawSourceDeleted(rawSource).status, 'deleted');
    assert.ok(providerHead() > beforeTombstone, 'tombstone must advance the accepted Provider head');
    assert.equal(getAcceptedHeadsSync({ port: service.port, token: providerToken }).provider, providerHead());
    const beforePurge = providerHead();
    assert.equal(provider.purgeRawSource(rawSource).status, 'purged');
    assert.ok(providerHead() > beforePurge, 'purge must advance the accepted Provider head');
    assert.equal(getAcceptedHeadsSync({ port: service.port, token: providerToken }).provider, providerHead());

    // The real Provider revoke writer wins before dispatch-start; Gateway must see the committed denial.
    provider.revokeRecord(scope, record.record_ref, record.record_version);
    await assert.rejects(gateway.dispatchProtectedRequest(request), /MEMORY_DISPATCH_NOT_READY/);
    assert.equal(calls.length, 0, 'revocation before dispatch-start must cause zero upstream calls');
    const ledger = new DatabaseSync(ledgerPath);
    try {
      assert.equal(ledger.prepare('SELECT COUNT(*) AS n FROM dispatch_ledger').get().n, 0,
        'denied pre-start request must not create DISPATCH_STARTED');
    } finally {
      ledger.close();
    }
  } finally {
    try { gateway?.close(); } catch {}
    try { providerReader?.close(); } catch {}
    try { provider?.close(); } catch {}
    if (service?.child && service.child.exitCode === null && service.child.signalCode === null) {
      service.child.stdin.end('stop');
      await once(service.child, 'exit');
    }
    for (const [name, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
