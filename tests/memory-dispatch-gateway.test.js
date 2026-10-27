import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import {
  advanceAcceptedHeadSync,
  enrollAcceptedHeadSync,
  finalizeAcceptedHeadSync,
} from '../src/security/accepted-head-client-sync.js';
import { MemoryDispatchGateway } from '../src/security/memory-dispatch-gateway.js';

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

async function createFixture({ sendUpstream } = {}) {
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

  let providerGranted = true;
  const calls = [];
  gateway = new MemoryDispatchGateway({
    ledgerPath,
    coordinatorPath,
    authorityPort: service.port,
    readToken,
    readCoreEvidence: ({ worldId, actorId, sources }) => ({
      head: 1,
      world_id: worldId,
      actor_id: actorId,
      readiness: 'READY',
      inventory_status: 'READY',
      sources,
    }),
    readProviderEvidence: ({ worldId, actorId, purpose, sources }) => ({
      head: 1,
      world_id: worldId,
      actor_id: actorId,
      purpose,
      granted: providerGranted,
      readiness: 'READY',
      sources,
    }),
    sendUpstream: async (request) => {
      calls.push(request);
      if (sendUpstream) return sendUpstream(request);
      return { status: 200, body: 'accepted' };
    },
  });

  return {
    directory, authorityPath, coordinatorPath, ledgerPath, child: service.child, port: service.port,
    gateway, calls,
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
  body: JSON.stringify({ messages: [{ role: 'user', content: 'SECRET_MEMORY_TEXT_DO_NOT_PERSIST' }] }),
  worldId: 'world-1',
  actorId: 'npc-1',
  purpose: 'recall',
  sources: sourceSet,
  ...overrides,
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
      const row = db.prepare('SELECT status,request_digest,sources_json FROM dispatch_ledger WHERE request_id=?')
        .get('request-001');
      assert.equal(row.status, 'COMPLETED');
      assert.match(row.request_digest, /^[a-f0-9]{64}$/);
      assert.equal(JSON.stringify(row).includes('SECRET_MEMORY_TEXT_DO_NOT_PERSIST'), false);
    } finally {
      db.close();
    }
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
    assert.equal(sends, 1);
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
