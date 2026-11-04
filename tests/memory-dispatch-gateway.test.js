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
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { createProtectedMemoryFinalSend, PROTECTED_MEMORY_SENDER_ROUTES } from '../host-adapter/protected-memory-final-send.mjs';

const coreToken = 'core-token-for-dispatch-gateway-tests-00000000000000000000000000000001';
const providerToken = 'provider-token-for-dispatch-gateway-tests-00000000000000000000000000000002';
const readToken = 'gateway-read-token-for-dispatch-gateway-tests-00000000000000000000000000000003';
const digestA = 'a'.repeat(64);
const digestB = 'b'.repeat(64);
const digestC = 'c'.repeat(64);
const hostContext = Object.freeze({
  adapter_id: 'st-gateway',
  core_conversation_id: '55555555-5555-4555-8555-555555555555:11111111-1111-4111-8111-111111111111:33333333-3333-4333-8333-333333333333',
  world_id: 'world-1',
  actor_id: 'npc-1',
  actor_type: 'npc',
  host_installation_id: '11111111-1111-4111-8111-111111111111',
  authenticated_account_id: '22222222-2222-4222-8222-222222222222',
  host_session_id: '55555555-5555-4555-8555-555555555555',
  host_conversation_id: '11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:33333333-3333-4333-8333-333333333333',
  conversation_uuid: '33333333-3333-4333-8333-333333333333',
  root_id: 'e'.repeat(64),
  root_inventory_sequence: 1,
  root_manifest_sha256: 'f'.repeat(64),
});

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

function installTestTransport(gateway, factory) {
  const dispatch = gateway.dispatchProtectedRequest.bind(gateway);
  gateway.dispatchProtectedRequest = (request) => dispatch({
    ...request,
    transport: request.transport ?? factory(request),
  });
  return gateway;
}

async function createFixture({ sendUpstream, createTransport, coreHead = 1, providerHead = 1, initialProviderGrant = true, providerCandidatesOverride } = {}) {
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
  let hostInventoryReady = true;
  let currentProviderCandidatesOverride = providerCandidatesOverride;
  let policyAuthority = { authority_id: 'test-memory-policy', generation: 1, fingerprint: 'd'.repeat(64) };
  const calls = [];
  const makeGateway = () => installTestTransport(new MemoryDispatchGateway({
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
      policy_authority: policyAuthority,
      sources,
    }),
    readProviderEvidence: ({ worldId, actorId, purpose, sources, candidates, providerEvidenceCursor }) => ({
      head: providerHead,
      world_id: worldId,
      actor_id: actorId,
      purpose,
      granted: providerGranted,
      readiness: 'READY',
      sources,
      candidates: currentProviderCandidatesOverride ?? candidates,
      provider_evidence_cursor: providerEvidenceCursor,
    }),
    readHostEvidence: ({ hostContext: binding, worldId, actorId }) => ({
      status: hostInventoryReady ? 'READY' : 'NON_READY',
      adapter_id: binding.adapter_id,
      core_conversation_id: binding.core_conversation_id,
      world_id: worldId,
      actor_id: actorId,
      root_id: binding.root_id,
      root_inventory_sequence: binding.root_inventory_sequence,
      root_manifest_sha256: binding.root_manifest_sha256,
    }),
  }), (request) => createTransport
    ? createTransport(request)
    : () => {
      calls.push(request);
      if (sendUpstream) return sendUpstream(request);
      return Promise.resolve({ status: 200, body: 'accepted' });
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
    setHostInventoryReady(value) { hostInventoryReady = value; },
    setProviderCandidates(value) { currentProviderCandidatesOverride = value; },
    setPolicyAuthority(value) { policyAuthority = value; },
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

async function dispatchAndRelease(gateway, request) {
  const response = await gateway.dispatchProtectedRequest(request);
  gateway.authorizeResponseWrite(request.requestId, () => response, { final: true });
  return response;
}

const validRequest = (requestId = 'request-001', overrides = {}) => ({
  requestId,
  generationId: 'generation-' + requestId,
  replayIdentity: createHash('sha256').update('original-host-prompt-' + requestId, 'utf8').digest('hex'),
  route: 'host-selected-chat-generation',
  senderRoute: 'google-ai-studio',
  model: 'selected-model',
  stream: false,
  body: JSON.stringify({ messages: [{ role: 'user', content: 'SECRET_MEMORY_TEXT_DO_NOT_PERSIST' }] }),
  worldId: 'world-1',
  actorId: 'npc-1',
  purpose: 'recall',
  sources: sourceSet,
  hostContext,
  laneA: {
    lane: 'A',
    purpose: 'npc_turn_context',
    authorization_ref: 'core-read-authorization',
    visibility_authorization_ref: 'core-visibility-policy',
    items: [],
  },
  providerEvidenceCursor: { data_version: 7, candidate_digest: 'f'.repeat(64) },
  candidates: [{
    record_ref: 'record-42',
    record_version: 'record-version-3',
    authorization_generation: 1,
    source_kind: 'canonical_entity',
    source_entity_id: 'entity-42',
    source_version: 'version-7',
  }],
  ...overrides,
});

test('Gateway signing is independent of mutable Array prototype methods and iteration', () => {
  const secret = 'host-dispatch-signing-secret-00000000000000000000000000000001';
  const request = validRequest('poisoned-array-prototypes');
  const names = ['map', 'sort', 'some', 'every', 'forEach', 'includes', 'concat', 'push', 'pop', 'shift', 'unshift', 'splice', Symbol.iterator];
  const descriptors = new Array(names.length);
  const poison = () => { throw new Error('POISONED_ARRAY_METHOD_CALLED'); };
  try {
    for (let index = 0; index < names.length; index += 1) {
      const name = names[index];
      descriptors[index] = Object.getOwnPropertyDescriptor(Array.prototype, name);
      Object.defineProperty(Array.prototype, name, {
        value: poison, writable: true, configurable: true,
      });
    }
    let signed = false;
    try {
      createDispatchRequestSignature(secret, request);
      signed = true;
    } catch {}
    if (!signed) throw new Error('Gateway signing invoked a poisoned Array prototype method');
  } finally {
    for (let index = 0; index < names.length; index += 1) {
      const key = names[index];
      const descriptor = descriptors[index];
      if (descriptor) Object.defineProperty(Array.prototype, key, descriptor);
      else delete Array.prototype[key];
    }
  }
});

test('dispatch signature snapshot rejects getters and Proxy objects without executing them', () => {
  const secret = 'host-dispatch-signing-secret-00000000000000000000000000000001';
  let getterCalls = 0;
  const request = { ...validRequest('signature-getter') };
  Object.defineProperty(request, 'body', {
    enumerable: true, get() { getterCalls += 1; return '{}'; },
  });
  assert.throws(() => createDispatchRequestSignature(secret, request), /Invalid signed dispatch request/);
  assert.equal(getterCalls, 0);
  assert.throws(() => createDispatchRequestSignature(secret, new Proxy(validRequest('signature-proxy'), {})),
    /Invalid signed dispatch request/);
});

test('Gateway snapshots its outer request envelope without invoking getters or Proxy traps', async () => {
  const fixture = await createFixture();
  let getterCalls = 0;
  try {
    const request = { ...validRequest('outer-request-getter'), transport: () => Promise.resolve({ status: 200 }) };
    Object.defineProperty(request, 'requestId', {
      enumerable: true, get() { getterCalls += 1; return 'forged-request-id'; },
    });
    await assert.rejects(MemoryDispatchGateway.prototype.dispatchProtectedRequest.call(fixture.gateway, request), /MEMORY_DISPATCH_NOT_READY/);
    assert.equal(getterCalls, 0);

    const proxied = new Proxy({ ...validRequest('outer-request-proxy'), transport: () => Promise.resolve({ status: 200 }) }, {});
    await assert.rejects(MemoryDispatchGateway.prototype.dispatchProtectedRequest.call(fixture.gateway, proxied), /MEMORY_DISPATCH_NOT_READY/);
    assert.equal(fixture.calls.length, 0);
  } finally {
    await fixture.close();
  }
});

test('Gateway ignores unrelated protected-context metadata without reading it', async () => {
  const fixture = await createFixture();
  let getterCalls = 0;
  try {
    const request = {
      ...validRequest('outer-request-extra-context'),
      transport: () => Promise.resolve({ status: 200, body: 'accepted' }),
      contentBlocks: [],
    };
    Object.defineProperty(request, 'laneB', {
      enumerable: true, get() { getterCalls += 1; return []; },
    });
    let response;
    try {
      response = await MemoryDispatchGateway.prototype.dispatchProtectedRequest.call(fixture.gateway, request);
    } catch (error) {
      const cause = error?.cause;
      throw new Error('Unexpected Gateway dispatch rejection: '
        + String(cause?.stack || cause?.message || error?.message), { cause: error });
    }
    assert.equal(response.status, 200);
    assert.equal(getterCalls, 0);
    fixture.gateway.authorizeResponseWrite(request.requestId, () => undefined, { final: true });
  } finally {
    await fixture.close();
  }
});

test('Lane A nested accessors and proxies are rejected before dispatch without executing getters', async () => {
  const fixture = await createFixture();
  let getterCalls = 0;
  try {
    const item = { acquisition_id: 'acq-1' };
    Object.defineProperty(item, 'value', {
      enumerable: true,
      get() { getterCalls += 1; return 'secret'; },
    });
    await assert.rejects(fixture.gateway.dispatchProtectedRequest(validRequest('lane-a-nested-getter', {
      laneA: {
        lane: 'A', purpose: 'npc_turn_context',
        authorization_ref: 'core-read-auth', visibility_authorization_ref: 'core-visibility-auth',
        items: [item],
      },
      transport: () => {
        fixture.calls.push('unexpected');
        return Promise.resolve({ status: 200 });
      },
    })), /MEMORY_DISPATCH_NOT_READY/);
    assert.equal(getterCalls, 0);
    assert.equal(fixture.calls.length, 0);

    const proxiedItem = new Proxy({ acquisition_id: 'acq-2' }, {});
    await assert.rejects(fixture.gateway.dispatchProtectedRequest(validRequest('lane-a-nested-proxy', {
      laneA: {
        lane: 'A', purpose: 'npc_turn_context',
        authorization_ref: 'core-read-auth', visibility_authorization_ref: 'core-visibility-auth',
        items: [proxiedItem],
      },
      transport: () => {
        fixture.calls.push('unexpected-proxy');
        return Promise.resolve({ status: 200 });
      },
    })), /MEMORY_DISPATCH_NOT_READY/);
    assert.equal(fixture.calls.length, 0);
  } finally {
    await fixture.close();
  }
});

test('Gateway rejects accessor, Proxy and sparse source/candidate containers before upstream egress', async () => {
  const fixture = await createFixture();
  let getterCalls = 0;
  try {
    const source = {};
    Object.defineProperties(source, {
      source_kind: { enumerable: true, value: 'canonical_entity' },
      source_entity_id: { enumerable: true, value: 'entity-42' },
      source_version: { enumerable: true, get() { getterCalls += 1; return 'version-7'; } },
    });
    await assert.rejects(fixture.gateway.dispatchProtectedRequest(validRequest('source-getter', {
      sources: [source],
      transport: () => { fixture.calls.push('unexpected-source'); return Promise.resolve({ status: 200 }); },
    })), /MEMORY_DISPATCH_NOT_READY/);
    assert.equal(getterCalls, 0);

    await assert.rejects(fixture.gateway.dispatchProtectedRequest(validRequest('source-proxy', {
      sources: new Proxy(sourceSet, {}),
      transport: () => { fixture.calls.push('unexpected-source-proxy'); return Promise.resolve({ status: 200 }); },
    })), /MEMORY_DISPATCH_NOT_READY/);

    const candidate = { ...validRequest().candidates[0] };
    Object.defineProperty(candidate, 'record_ref', {
      enumerable: true, get() { getterCalls += 1; return 'record-42'; },
    });
    await assert.rejects(fixture.gateway.dispatchProtectedRequest(validRequest('candidate-getter', {
      candidates: [candidate],
      transport: () => { fixture.calls.push('unexpected-candidate'); return Promise.resolve({ status: 200 }); },
    })), /MEMORY_DISPATCH_NOT_READY/);
    assert.equal(getterCalls, 0);

    const sparse = [];
    sparse.length = 1;
    await assert.rejects(fixture.gateway.dispatchProtectedRequest(validRequest('source-sparse', {
      sources: sparse,
      transport: () => { fixture.calls.push('unexpected-sparse'); return Promise.resolve({ status: 200 }); },
    })), /MEMORY_DISPATCH_NOT_READY/);
    assert.equal(fixture.calls.length, 0);
  } finally {
    await fixture.close();
  }
});

test('Lane A revoke before DISPATCH_STARTED blocks the upstream transport', async () => {
  const fixture = await createFixture();
  try {
    const laneA = {
      lane: 'A', purpose: 'npc_turn_context',
      authorization_ref: 'core-read-auth', visibility_authorization_ref: 'core-visibility-auth',
      items: [{ acquisition_id: 'acq-1', fact_id: 'fact-1', subject_ref: 'npc-1',
        predicate: 'knows', value: 'secret', acquisition_kind: 'author_initial',
        provenance_ref: 'source-1', provenance_digest: digestA,
        acquisition_authorization_ref: 'acq-auth-1', source_event_ids: ['event-1'] }],
    };
    const request = validRequest('lane-a-revoked-before-dispatch', {
      laneA,
      revalidateLaneA: () => ({ status: 'non_ready', reason: 'dispatch_lane_a_changed' }),
    });
    await assert.rejects(fixture.gateway.dispatchProtectedRequest(request),
      /MEMORY_DISPATCH_LANE_A_REVALIDATION_DENIED/);
    assert.equal(fixture.calls.length, 0);
    assert.equal(fixture.gateway.db.prepare('SELECT COUNT(*) AS count FROM dispatch_ledger').get().count, 0);
  } finally {
    await fixture.close();
  }
});

test('Gateway does not expose arbitrary caller errors using the dispatch contract prefix', async () => {
  const fixture = await createFixture();
  try {
    const laneA = {
      lane: 'A', purpose: 'npc_turn_context',
      authorization_ref: 'core-read-auth', visibility_authorization_ref: 'core-visibility-auth',
      items: [{ acquisition_id: 'acq-1', fact_id: 'fact-1', subject_ref: 'npc-1',
        predicate: 'knows', value: 'secret', acquisition_kind: 'author_initial',
        provenance_ref: 'source-1', provenance_digest: digestA,
        acquisition_authorization_ref: 'acq-auth-1', source_event_ids: ['event-1'] }],
    };
    await assert.rejects(
      fixture.gateway.dispatchProtectedRequest(validRequest('lane-a-untrusted-error-code', {
        laneA,
        revalidateLaneA: () => { throw new Error('MEMORY_DISPATCH_INJECTED_DIAGNOSTIC'); },
      })),
      error => error.message === 'MEMORY_DISPATCH_NOT_READY'
        && error.cause?.message === 'MEMORY_DISPATCH_INJECTED_DIAGNOSTIC',
    );
    assert.equal(fixture.calls.length, 0);
    assert.equal(
      fixture.gateway.db.prepare('SELECT COUNT(*) AS count FROM dispatch_ledger').get().count,
      0,
    );
  } finally {
    await fixture.close();
  }
});

test('Gateway rejects bound and prototype-spoofed async Lane A revalidators before dispatch-start', async () => {
  const laneA = {
    lane: 'A', purpose: 'npc_turn_context',
    authorization_ref: 'core-read-auth', visibility_authorization_ref: 'core-visibility-auth',
    items: [{ acquisition_id: 'acq-1', fact_id: 'fact-1', subject_ref: 'npc-1',
      predicate: 'knows', value: 'secret', acquisition_kind: 'author_initial',
      provenance_ref: 'source-1', provenance_digest: digestA,
      acquisition_authorization_ref: 'acq-auth-1', source_event_ids: ['event-1'] }],
  };
  const variants = [
    () => (async () => ({ status: 'ready' })).bind(null),
    () => {
      const callback = async () => ({ status: 'ready' });
      Object.setPrototypeOf(callback, Function.prototype);
      return callback;
    },
  ];

  for (let index = 0; index < variants.length; index += 1) {
    const fixture = await createFixture();
    try {
      await assert.rejects(
        fixture.gateway.dispatchProtectedRequest(validRequest('invalid-lane-a-revalidator-' + index, {
          laneA,
          revalidateLaneA: variants[index](),
        })),
        /MEMORY_DISPATCH_LANE_A_REVALIDATION_REQUIRED/,
      );
      assert.equal(fixture.calls.length, 0);
      assert.equal(
        fixture.gateway.db.prepare('SELECT COUNT(*) AS count FROM dispatch_ledger').get().count,
        0,
      );
    } finally {
      await fixture.close();
    }
  }
});

test('Lane A revoke during model execution blocks final response release', async () => {
  let laneAReads = 0;
  const fixture = await createFixture({
    createTransport: () => () => Promise.resolve({ status: 200, body: 'model-result' }),
  });
  try {
    const laneA = {
      lane: 'A', purpose: 'npc_turn_context',
      authorization_ref: 'core-read-auth', visibility_authorization_ref: 'core-visibility-auth',
      items: [{ acquisition_id: 'acq-1', fact_id: 'fact-1', subject_ref: 'npc-1',
        predicate: 'knows', value: 'secret', acquisition_kind: 'author_initial',
        provenance_ref: 'source-1', provenance_digest: digestA,
        acquisition_authorization_ref: 'acq-auth-1', source_event_ids: ['event-1'] }],
    };
    const request = validRequest('lane-a-revoked-during-inference', {
      laneA,
      revalidateLaneA: () => (++laneAReads === 1
        ? { status: 'ready' }
        : { status: 'non_ready', reason: 'dispatch_lane_a_changed' }),
    });
    await assert.rejects(fixture.gateway.dispatchProtectedRequest(request),
      /MEMORY_DISPATCH_FINAL_RESPONSE_REVALIDATION_DENIED/);
    assert.equal(laneAReads, 2);
    const row = fixture.gateway.db.prepare(
      'SELECT status FROM dispatch_ledger WHERE request_id=?',
    ).get(request.requestId);
    assert.equal(row.status, 'UNKNOWN', 'a withheld final response remains non-replayable');
  } finally {
    await fixture.close();
  }
});

test('bound async response writer is rejected before it can execute', async (t) => {
  const fixture = await createFixture();
  t.after(() => fixture.close());
  const request = validRequest('async-response-writer-rejected');
  const response = await fixture.gateway.dispatchProtectedRequest(request);
  let writes = 0;
  const asyncWrite = (async () => { writes += 1; }).bind(null);
  Object.defineProperty(asyncWrite, 'constructor', { value: Function });
  assert.throws(
    () => fixture.gateway.authorizeResponseWrite(request.requestId, asyncWrite),
    /Invalid protected response release capability/,
  );
  assert.equal(writes, 0);

  const prototypeSpoofedAsyncWrite = async () => { writes += 1; };
  Object.setPrototypeOf(prototypeSpoofedAsyncWrite, Function.prototype);
  assert.throws(
    () => fixture.gateway.authorizeResponseWrite(request.requestId, prototypeSpoofedAsyncWrite),
    /Invalid protected response release capability/,
  );
  const asyncGeneratorWrite = async function* () { writes += 1; };
  Object.setPrototypeOf(asyncGeneratorWrite, Function.prototype);
  assert.throws(
    () => fixture.gateway.authorizeResponseWrite(request.requestId, asyncGeneratorWrite),
    /Invalid protected response release capability/,
  );

  // A bound synchronous callback is indistinguishable from a bound async
  // callback without invocation, so the capability boundary rejects both.
  const boundSyncWrite = (() => { writes += 1; }).bind(null);
  assert.throws(
    () => fixture.gateway.authorizeResponseWrite(request.requestId, boundSyncWrite),
    /Invalid protected response release capability/,
  );
  const proxiedWrite = new Proxy(() => { writes += 1; }, {});
  assert.throws(
    () => fixture.gateway.authorizeResponseWrite(request.requestId, proxiedWrite),
    /Invalid protected response release capability/,
  );
  assert.equal(writes, 0);
  fixture.gateway.authorizeResponseWrite(request.requestId, () => response, { final: true });
});

test('Lane A revoke between streamed response writes blocks the next chunk', async () => {
  let laneAReads = 0;
  const fixture = await createFixture({
    createTransport: () => () => Promise.resolve({ status: 200, body: 'stream-result' }),
  });
  try {
    const laneA = {
      lane: 'A', purpose: 'npc_turn_context',
      authorization_ref: 'core-read-auth', visibility_authorization_ref: 'core-visibility-auth',
      items: [{ acquisition_id: 'acq-1', fact_id: 'fact-1', subject_ref: 'npc-1',
        predicate: 'knows', value: 'secret', acquisition_kind: 'author_initial',
        provenance_ref: 'source-1', provenance_digest: digestA,
        acquisition_authorization_ref: 'acq-auth-1', source_event_ids: ['event-1'] }],
    };
    const request = validRequest('lane-a-revoked-between-chunks', {
      stream: true,
      hostTransformsStream: true,
      laneA,
      revalidateLaneA: () => (++laneAReads <= 3
        ? { status: 'ready' }
        : { status: 'non_ready', reason: 'dispatch_lane_a_changed' }),
    });
    const response = await fixture.gateway.dispatchProtectedRequest(request);
    let writes = 0;
    fixture.gateway.authorizeResponseWrite(request.requestId, () => { writes += 1; return true; }, { final: false });
    assert.equal(writes, 1);
    assert.throws(
      () => fixture.gateway.authorizeResponseWrite(request.requestId, () => { writes += 1; return true; }, { final: false }),
      /MEMORY_DISPATCH_FINAL_RESPONSE_REVALIDATION_DENIED/,
    );
    assert.equal(writes, 1);
    assert.equal(laneAReads, 4);
    assert.equal(response.status, 200);
  } finally {
    await fixture.close();
  }
});

test('dispatch ledger explicitly uses SQLite FULL synchronous durability', async () => {
  const fixture = await createFixture();
  try {
    const row = fixture.gateway.db.prepare('PRAGMA synchronous').get();
    assert.equal(row.synchronous, 2, 'dispatch-start must use SQLite synchronous=FULL');
  } finally {
    await fixture.close();
  }
});

test('Host dispatch signature binds the exact body, route, model, identity, and source versions with locale-independent source ordering', () => {
  const request = validRequest('signed-request');
  const secret = 'host-dispatch-signing-secret-00000000000000000000000000000001';
  const signature = createDispatchRequestSignature(secret, request);
  assert.equal(verifyDispatchRequestSignature(secret, request, signature), true);
  assert.equal(verifyDispatchRequestSignature(secret, { ...request, body: request.body + 'tampered' }, signature), false);
  assert.equal(verifyDispatchRequestSignature(secret, { ...request, hostContext: { ...hostContext, root_manifest_sha256: '0'.repeat(64) } }, signature), false);
  assert.equal(verifyDispatchRequestSignature(secret, { ...request, candidates: [{ ...request.candidates[0], record_version: 'record-version-4' }] }, signature), false);
  assert.equal(verifyDispatchRequestSignature(secret, { ...request, candidates: [{ ...request.candidates[0], authorization_generation: 2 }] }, signature), false);
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
      { record_ref: 'record-z', record_version: 'rv1', authorization_generation: 1, source_kind: 'canonical_entity', source_entity_id: 'z-entity', source_version: 'v1' },
      { record_ref: 'record-a', record_version: 'rv1', authorization_generation: 1, source_kind: 'canonical_entity', source_entity_id: 'ä-entity', source_version: 'v1' },
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

test('Gateway without an in-process transport capability fails closed before ledger creation', async () => {
  const fixture = await createFixture();
  try {
    const directDispatch = MemoryDispatchGateway.prototype.dispatchProtectedRequest.bind(fixture.gateway);
    await assert.rejects(
      directDispatch(validRequest('missing-transport-capability')),
      /MEMORY_DISPATCH_NOT_READY/,
    );
    assert.equal(fixture.calls.length, 0);
    const ledger = new DatabaseSync(fixture.ledgerPath);
    try {
      assert.equal(ledger.prepare('SELECT COUNT(*) AS n FROM dispatch_ledger').get().n, 0);
    } finally {
      ledger.close();
    }
  } finally {
    await fixture.close();
  }
});

test('request-scoped transport capability must be dormant and synchronous before DISPATCH_STARTED', async () => {
  let starts = 0;
  const fixture = await createFixture({
    createTransport: () => async () => {
      starts += 1;
      return { status: 200 };
    },
  });
  try {
    await assert.rejects(
      fixture.gateway.dispatchProtectedRequest(validRequest('async-capability-request')),
      /MEMORY_DISPATCH_NOT_READY/,
    );
    assert.equal(starts, 0, 'an async capability must be rejected without invoking it');
    const ledger = new DatabaseSync(fixture.ledgerPath);
    try {
      assert.equal(ledger.prepare('SELECT COUNT(*) AS n FROM dispatch_ledger').get().n, 0,
        'invalid capability must be rejected before durable DISPATCH_STARTED');
    } finally {
      ledger.close();
    }
  } finally {
    await fixture.close();
  }
});

test('Gateway rejects bound and prototype-spoofed async transport capabilities before invocation', async () => {
  const variants = [
    {
      id: 'bound-async-transport',
      create: (started) => (async () => { started.count += 1; return { status: 200 }; }).bind(null),
    },
    {
      id: 'prototype-spoofed-async-transport',
      create: (started) => {
        const transport = async () => { started.count += 1; return { status: 200 }; };
        Object.setPrototypeOf(transport, Function.prototype);
        return transport;
      },
    },
  ];

  for (let index = 0; index < variants.length; index += 1) {
    const variant = variants[index];
    const started = { count: 0 };
    const fixture = await createFixture({ createTransport: () => variant.create(started) });
    try {
      await assert.rejects(
        fixture.gateway.dispatchProtectedRequest(validRequest(variant.id)),
        /MEMORY_DISPATCH_NOT_READY/,
      );
      assert.equal(started.count, 0, 'rejected transport must remain dormant');
      assert.equal(fixture.calls.length, 0, 'rejected transport must not produce upstream egress');
      assert.equal(
        fixture.gateway.db.prepare('SELECT COUNT(*) AS count FROM dispatch_ledger').get().count,
        0,
        'invalid transport must be rejected before durable DISPATCH_STARTED',
      );
    } finally {
      await fixture.close();
    }
  }
});

test('dispatch rejects Provider evidence whose exact candidate record/version set differs from the signed request', async () => {
  const fixture = await createFixture({
    providerCandidatesOverride: [{
      record_ref: 'record-42',
      record_version: 'record-version-4',
      authorization_generation: 1,
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


test('transport handoff begins while the shared coordinator is still held', async (t) => {
  let contender;
  let coordinatorWasHeldAtTransportStart = false;
  const fixture = await createFixture({
    createTransport: () => () => {
      try {
        contender.exec('BEGIN IMMEDIATE');
        contender.exec('ROLLBACK');
      } catch (error) {
        coordinatorWasHeldAtTransportStart = /locked|busy/i.test(String(error?.message || ''));
      }
      return Promise.resolve({ status: 200, body: 'accepted' });
    },
  });
  t.after(async () => {
    try { contender?.close(); } catch {}
    await fixture.close();
  });

  contender = new DatabaseSync(fixture.coordinatorPath);
  contender.exec('PRAGMA busy_timeout=0;');
  await dispatchAndRelease(fixture.gateway, validRequest('transport-start-under-lock'));
  assert.equal(
    coordinatorWasHeldAtTransportStart,
    true,
    'transport initiation must occur before the dispatch coordinator lease is released',
  );
  contender.exec('BEGIN IMMEDIATE');
  contender.exec('ROLLBACK');
});

test('stream response is not released when Provider revoke wins during upstream inference', async () => {
  let releaseTransport;
  const transportGate = new Promise((resolve) => { releaseTransport = resolve; });
  const fixture = await createFixture();
  let upstreamCalls = 0;
  let hostWrites = 0;
  const finalSend = createProtectedMemoryFinalSend({
    gateway: fixture.gateway,
    resolveProtectedMemory: (hostRequestContext) => hostRequestContext,
    fetchImpl: () => {
      upstreamCalls += 1;
      return transportGate;
    },
  });
  try {
    const pending = finalSend({
      senderRoute: 'google-ai-studio',
      endpointUrl: 'https://provider.example/stream',
      requestInit: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stream: true, messages: [{ role: 'user', content: 'protected' }] }),
      },
      hostRequestContext: {
        ...validRequest('stream-revoke-during-send'),
      },
      stream: true,
      forwardResponse: () => {
        hostWrites += 1;
        return Promise.resolve();
      },
    });
    fixture.setProviderGranted(false);
    releaseTransport({ status: 200, body: 'must-not-be-streamed' });
    await assert.rejects(pending, /MEMORY_DISPATCH_FINAL_RESPONSE_REVALIDATION_DENIED/);
    assert.equal(upstreamCalls, 1);
    assert.equal(hostWrites, 0, 'failed final revalidation must prevent the first Host response write');
  } finally {
    await fixture.close();
  }
});

test('successful stream begins its one Host response write under the Coordinator lease', async () => {
  const fixture = await createFixture();
  const contender = new DatabaseSync(fixture.coordinatorPath);
  contender.exec('PRAGMA busy_timeout=0;');
  let leaseHeldAtHostWrite = false;
  let hostWrites = 0;
  const finalSend = createProtectedMemoryFinalSend({
    gateway: fixture.gateway,
    resolveProtectedMemory: (hostRequestContext) => hostRequestContext,
    fetchImpl: async () => ({ status: 200, body: 'stream-body' }),
  });
  try {
    await finalSend({
      senderRoute: 'google-ai-studio',
      endpointUrl: 'https://provider.example/stream',
      requestInit: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stream: true, messages: [{ role: 'user', content: 'protected' }] }),
      },
      hostRequestContext: {
        ...validRequest('stream-response-under-lease'),
      },
      stream: true,
      forwardResponse: () => {
        fixture.gateway.authorizeResponseWrite('stream-response-under-lease', () => {
          hostWrites += 1;
          try {
            contender.exec('BEGIN IMMEDIATE');
            contender.exec('ROLLBACK');
          } catch (error) {
            leaseHeldAtHostWrite = /locked|busy/i.test(String(error?.message || ''));
          }
        }, { final: true });
        return Promise.resolve();
      },
    });
    assert.equal(hostWrites, 1);
    assert.equal(leaseHeldAtHostWrite, true);
  } finally {
    contender.close();
    await fixture.close();
  }
});

test('Gateway rejects policy authority getters and proxies without invoking them', async () => {
  const fixture = await createFixture();
  let getterCalls = 0;
  try {
    const authority = { generation: 1, fingerprint: digestC };
    Object.defineProperty(authority, 'authority_id', {
      enumerable: true, get() { getterCalls += 1; return 'test-memory-policy'; },
    });
    fixture.setPolicyAuthority(authority);
    await assert.rejects(fixture.gateway.dispatchProtectedRequest({
      ...validRequest('policy-authority-getter'),
      transport: () => { fixture.calls.push('unexpected-policy'); return Promise.resolve({ status: 200 }); },
    }), /MEMORY_DISPATCH_NOT_READY/);
    assert.equal(getterCalls, 0);

    fixture.setPolicyAuthority(new Proxy({
      authority_id: 'test-memory-policy', generation: 1, fingerprint: digestC,
    }, {}));
    await assert.rejects(fixture.gateway.dispatchProtectedRequest({
      ...validRequest('policy-authority-proxy'),
      transport: () => { fixture.calls.push('unexpected-policy-proxy'); return Promise.resolve({ status: 200 }); },
    }), /MEMORY_DISPATCH_NOT_READY/);
    assert.equal(fixture.calls.length, 0);
  } finally {
    await fixture.close();
  }
});

test('Gateway rejects a missing or malformed policy authority tuple before upstream egress', async () => {
  const fixture = await createFixture();
  try {
    fixture.setPolicyAuthority({ authority_id: 'test-memory-policy', generation: 1 });
    await assert.rejects(
      fixture.gateway.dispatchProtectedRequest({
        ...validRequest('missing-policy-fingerprint'),
        transport: () => {
          fixture.calls.push('unexpected');
          return Promise.resolve({ status: 200 });
        },
      }),
      /MEMORY_DISPATCH_NOT_READY/,
    );
    assert.equal(fixture.calls.length, 0);
    const ledger = new DatabaseSync(fixture.ledgerPath);
    try {
      assert.equal(ledger.prepare('SELECT COUNT(*) AS n FROM dispatch_ledger').get().n, 0);
    } finally {
      ledger.close();
    }
  } finally {
    await fixture.close();
  }
});

test('all protected sender families share one real Gateway and each causes exactly one upstream call', async () => {
  assert.equal(PROTECTED_MEMORY_SENDER_ROUTES.length, 30);
  assert.ok(PROTECTED_MEMORY_SENDER_ROUTES.includes('cometapi'));
  assert.ok(PROTECTED_MEMORY_SENDER_ROUTES.includes('horde-text'));
  const fixture = await createFixture();
  let upstreamCalls = 0;
  const prepared = {
    model: 'selected-model',
    worldId: 'world-1',
    actorId: 'npc-1',
    purpose: 'recall',
    sources: sourceSet,
    candidates: validRequest().candidates,
    hostContext,
    laneA: {
      lane: 'A', purpose: 'npc_turn_context',
      authorization_ref: 'core-read-authorization',
      visibility_authorization_ref: 'core-visibility-policy', items: [],
    },
    providerEvidenceCursor: { data_version: 7, candidate_digest: 'f'.repeat(64) },
  };
  const finalSend = createProtectedMemoryFinalSend({
    gateway: fixture.gateway,
    resolveProtectedMemory: (hostRequestContext) => hostRequestContext,
    fetchImpl: async () => {
      upstreamCalls += 1;
      return { status: 200, body: 'upstream-response' };
    },
  });
  try {
    let routeIndex = 0;
    for (const senderRoute of PROTECTED_MEMORY_SENDER_ROUTES) {
      routeIndex += 1;
      const requestId = 'sender-route-' + routeIndex;
      try {
        await finalSend({
          senderRoute,
          endpointUrl: 'https://provider.example/v1/chat/completions',
          requestInit: {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ messages: [{ role: 'user', content: 'protected' }] }),
          },
          hostRequestContext: { ...prepared, requestId },
        });
      } catch (error) {
        throw new Error('Protected sender route failed (' + senderRoute + '): '
          + String(error?.cause?.stack || error?.cause?.message || error?.stack || error?.message), { cause: error });
      }
      fixture.gateway.authorizeResponseWrite(requestId, () => undefined, { final: true });
    }
    assert.equal(upstreamCalls, PROTECTED_MEMORY_SENDER_ROUTES.length);
    const ledger = new DatabaseSync(fixture.ledgerPath);
    try {
      assert.equal(
        ledger.prepare('SELECT COUNT(*) AS n FROM dispatch_ledger WHERE status=?').get('COMPLETED').n,
        PROTECTED_MEMORY_SENDER_ROUTES.length,
      );
      const recordedRoutes = ledger.prepare(
        'SELECT sender_route,policy_authority_id,policy_generation,policy_fingerprint FROM dispatch_ledger ORDER BY sender_route',
      ).all();
      assert.deepEqual(
        recordedRoutes.map((row) => row.sender_route),
        [...PROTECTED_MEMORY_SENDER_ROUTES].sort(),
      );
      assert.ok(recordedRoutes.every((row) => row.policy_authority_id === 'test-memory-policy'
        && row.policy_generation === 1 && row.policy_fingerprint === 'd'.repeat(64)));
    } finally {
      ledger.close();
    }
  } finally {
    await fixture.close();
  }
});

test('Gateway migrates sender constraints to the complete registry without losing dispatch history', async () => {
  const fixture = await createFixture();
  try {
    const legacyRequest = validRequest('legacy-horde-before-sender-migration', {
      senderRoute: 'horde-text',
    });
    await fixture.gateway.dispatchProtectedRequest(legacyRequest);
    fixture.gateway.authorizeResponseWrite(legacyRequest.requestId, () => undefined, { final: true });
    fixture.gateway.close();

    const legacy = new DatabaseSync(fixture.ledgerPath);
    try {
      legacy.exec(`
        BEGIN IMMEDIATE;
        DROP INDEX dispatch_ledger_status_started;
        DROP INDEX dispatch_ledger_unresolved_digest;
        ALTER TABLE dispatch_ledger RENAME TO dispatch_ledger_before_sender_migration;
        CREATE TABLE dispatch_ledger (
          request_id TEXT PRIMARY KEY,
          request_digest TEXT NOT NULL CHECK(length(request_digest)=64),
          route TEXT NOT NULL CHECK(route='host-selected-chat-generation'),
          sender_route TEXT NOT NULL CHECK(sender_route IN ('claude','google-ai-studio','vertex-ai','ai21','mistral','cohere','deepseek','xai','aimlapi','electronhub','chutes','minimax','azure-openai','openai','openrouter','custom','perplexity','groq','fireworks','nanogpt','pollinations','moonshot','zai','siliconflow','workers-ai','text-completions','kobold','novelai-text','horde-text')),
          model TEXT NOT NULL,
          stream INTEGER NOT NULL CHECK(stream IN (0,1)),
          world_id TEXT NOT NULL,
          actor_id TEXT NOT NULL,
          purpose TEXT NOT NULL,
          sources_json TEXT NOT NULL,
          candidates_json TEXT NOT NULL,
          core_head INTEGER NOT NULL CHECK(core_head > 0),
          provider_head INTEGER NOT NULL CHECK(provider_head > 0),
          policy_authority_id TEXT NOT NULL,
          policy_generation INTEGER NOT NULL CHECK(policy_generation > 0),
          policy_fingerprint TEXT NOT NULL CHECK(length(policy_fingerprint)=64),
          status TEXT NOT NULL CHECK(status IN ('DISPATCH_STARTED','COMPLETED','UNKNOWN')),
          outcome_code INTEGER,
          started_at TEXT NOT NULL,
          finished_at TEXT
        );
        INSERT INTO dispatch_ledger SELECT * FROM dispatch_ledger_before_sender_migration;
        DROP TABLE dispatch_ledger_before_sender_migration;
        CREATE INDEX dispatch_ledger_status_started ON dispatch_ledger(status, started_at);
        CREATE UNIQUE INDEX dispatch_ledger_unresolved_digest
          ON dispatch_ledger(request_digest) WHERE status IN ('DISPATCH_STARTED','UNKNOWN');
        COMMIT;
      `);
    } finally {
      legacy.close();
    }

    fixture.reopenGateway();
    const history = fixture.gateway.db.prepare(
      'SELECT sender_route,status FROM dispatch_ledger WHERE request_id=?',
    ).get(legacyRequest.requestId);
    assert.equal(history.sender_route, 'horde-text');
    assert.equal(history.status, 'COMPLETED');

    const expandedRequest = validRequest('cometapi-after-sender-migration', {
      senderRoute: 'cometapi',
    });
    await fixture.gateway.dispatchProtectedRequest(expandedRequest);
    fixture.gateway.authorizeResponseWrite(expandedRequest.requestId, () => undefined, { final: true });
    assert.equal(fixture.gateway.db.prepare(
      'SELECT sender_route FROM dispatch_ledger WHERE request_id=?',
    ).get(expandedRequest.requestId).sender_route, 'cometapi');
  } finally {
    await fixture.close();
  }
});

test('FINAL RESPONSE REVALIDATION blocks Host release after Provider revoke during upstream send', async () => {
  let releaseTransport;
  const transportGate = new Promise((resolve) => { releaseTransport = resolve; });
  const fixture = await createFixture({
    createTransport: () => () => {
      fixture.calls.push('upstream');
      return transportGate;
    },
  });
  try {
    const pending = fixture.gateway.dispatchProtectedRequest(validRequest('revoke-during-send'));
    await new Promise((resolve) => setImmediate(resolve));
    fixture.setProviderGranted(false);
    releaseTransport({ status: 200, body: 'must-not-reach-host' });
    await assert.rejects(pending, /MEMORY_DISPATCH_FINAL_RESPONSE_REVALIDATION_DENIED/);
    assert.equal(fixture.calls.length, 1, 'exactly one upstream call occurred');
    const ledger = new DatabaseSync(fixture.ledgerPath);
    try {
      const row = ledger.prepare('SELECT status FROM dispatch_ledger WHERE request_id=?')
        .get('revoke-during-send');
      assert.equal(row.status, 'UNKNOWN', 'withheld response remains non-replayable');
    } finally {
      ledger.close();
    }
  } finally {
    await fixture.close();
  }
});

test('revoke after upstream completion but before response.end prevents the actual Host write', async () => {
  const fixture = await createFixture();
  let hostWrites = 0;
  try {
    const request = validRequest('revoke-before-response-end');
    await fixture.gateway.dispatchProtectedRequest(request);
    fixture.setProviderGranted(false);
    assert.throws(
      () => fixture.gateway.authorizeResponseWrite(request.requestId, () => { hostWrites += 1; }, { final: true }),
      /MEMORY_DISPATCH_FINAL_RESPONSE_REVALIDATION_DENIED/,
    );
    assert.equal(hostWrites, 0, 'the final Express write must not occur after revoke');
    const ledger = new DatabaseSync(fixture.ledgerPath);
    try {
      assert.equal(ledger.prepare('SELECT status FROM dispatch_ledger WHERE request_id=?')
        .get(request.requestId).status, 'UNKNOWN');
    } finally {
      ledger.close();
    }
  } finally {
    await fixture.close();
  }
});

test('streaming revalidates every chunk and stops the stream after revoke', async () => {
  const fixture = await createFixture();
  const hostChunks = [];
  const request = validRequest('revoke-between-stream-chunks', { stream: true });
  try {
    await assert.rejects(fixture.gateway.dispatchProtectedRequest({
      ...request,
      forwardResponse: async () => {
        fixture.gateway.authorizeResponseWrite(request.requestId, () => hostChunks.push('chunk-1'));
        fixture.setProviderGranted(false);
        fixture.gateway.authorizeResponseWrite(request.requestId, () => hostChunks.push('chunk-2'));
      },
    }), /MEMORY_DISPATCH_OUTCOME_UNKNOWN/);
    assert.deepEqual(hostChunks, ['chunk-1'], 'no chunk after revoke may be written');
  } finally {
    await fixture.close();
  }
});

test('FINAL RESPONSE REVALIDATION rejects Provider record authorization-generation changes during upstream send', async () => {
  let releaseTransport;
  const transportGate = new Promise((resolve) => { releaseTransport = resolve; });
  const fixture = await createFixture({
    createTransport: () => () => {
      fixture.calls.push('upstream');
      return transportGate;
    },
  });
  try {
    const pending = fixture.gateway.dispatchProtectedRequest(validRequest('record-generation-during-send'));
    await new Promise((resolve) => setImmediate(resolve));
    fixture.setProviderCandidates([{
      ...validRequest().candidates[0],
      authorization_generation: 2,
    }]);
    releaseTransport({ status: 200, body: 'must-not-reach-host' });
    await assert.rejects(pending, /MEMORY_DISPATCH_FINAL_RESPONSE_REVALIDATION_DENIED/);
    assert.equal(fixture.calls.length, 1, 'authorization-generation change must not cause a retry');
  } finally {
    await fixture.close();
  }
});

test('FINAL RESPONSE REVALIDATION rejects policy authority tuple rotation during upstream send', async () => {
  let releaseTransport;
  const transportGate = new Promise((resolve) => { releaseTransport = resolve; });
  const fixture = await createFixture({
    createTransport: () => () => {
      fixture.calls.push('upstream');
      return transportGate;
    },
  });
  try {
    const pending = fixture.gateway.dispatchProtectedRequest(validRequest('policy-rotation-during-send'));
    await new Promise((resolve) => setImmediate(resolve));
    fixture.setPolicyAuthority({
      authority_id: 'test-memory-policy',
      generation: 2,
      fingerprint: 'e'.repeat(64),
    });
    releaseTransport({ status: 200, body: 'must-not-reach-host' });
    await assert.rejects(pending, /MEMORY_DISPATCH_FINAL_RESPONSE_REVALIDATION_DENIED/);
    assert.equal(fixture.calls.length, 1, 'policy rotation does not trigger a retry');
  } finally {
    await fixture.close();
  }
});

test('dispatch validates current heads and grants, records one content-free start, and sends once', async () => {
  const fixture = await createFixture();
  try {
    const response = await dispatchAndRelease(fixture.gateway, validRequest());
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
      const row = db.prepare('SELECT status,request_digest,model,sources_json,sender_route,policy_authority_id,policy_generation,policy_fingerprint FROM dispatch_ledger WHERE request_id=?')
        .get('request-001');
      assert.equal(row.status, 'COMPLETED');
      assert.equal(row.model, 'selected-model');
      assert.equal(row.sender_route, 'google-ai-studio');
      assert.equal(row.policy_authority_id, 'test-memory-policy');
      assert.equal(row.policy_generation, 1);
      assert.equal(row.policy_fingerprint, 'd'.repeat(64));
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

test('missing Lane A is NON_READY and cannot be treated as an empty Core projection', async () => {
  const fixture = await createFixture();
  try {
    const request = validRequest('missing-lane-a');
    delete request.laneA;
    await assert.rejects(
      fixture.gateway.dispatchProtectedRequest(request),
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
    await assert.rejects(
      fixture.gateway.dispatchProtectedRequest(validRequest('unsupported-sender', { senderRoute: 'unregistered-provider' })),
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
    createTransport: () => () => {
      sends += 1;
      return Promise.reject(new Error('simulated timeout after dispatch start'));
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
      assert.equal(row.route, 'host-selected-chat-generation');
      assert.equal(JSON.stringify(row).includes('SECRET_MEMORY_TEXT_DO_NOT_PERSIST'), false);
    } finally {
      db.close();
    }

    await assert.rejects(
      fixture.gateway.dispatchProtectedRequest(validRequest('ambiguous-request')),
      /MEMORY_DISPATCH_DUPLICATE_ID/,
    );
    await assert.rejects(
      fixture.gateway.dispatchProtectedRequest(validRequest('ambiguous-request-new-id', {
        generationId: 'generation-ambiguous-request', replayIdentity: createHash('sha256').update('original-host-prompt-ambiguous-request', 'utf8').digest('hex'),
      })),
      /MEMORY_DISPATCH_REPLAY_BLOCKED/,
    );
    await assert.rejects(
      fixture.gateway.dispatchProtectedRequest(validRequest('ambiguous-request-other-sender', {
        senderRoute: 'openai', generationId: 'generation-ambiguous-request', replayIdentity: createHash('sha256').update('original-host-prompt-ambiguous-request', 'utf8').digest('hex'),
      })),
      /MEMORY_DISPATCH_REPLAY_BLOCKED/,
      'changing sender family must not bypass the unresolved request digest',
    );
    await assert.rejects(
      fixture.gateway.dispatchProtectedRequest(validRequest('ambiguous-request-other-model', {
        model: 'different-model', generationId: 'generation-ambiguous-request', replayIdentity: createHash('sha256').update('original-host-prompt-ambiguous-request', 'utf8').digest('hex'),
        body: JSON.stringify({ model: 'different-model', prompt: 'different provider serialization' }),
      })),
      /MEMORY_DISPATCH_REPLAY_BLOCKED/,
      'changing the model must not bypass the unresolved request digest',
    );
    await assert.rejects(
      fixture.gateway.dispatchProtectedRequest(validRequest('ambiguous-request-new-root-revision', {
        generationId: 'generation-ambiguous-request',
        replayIdentity: createHash('sha256').update('original-host-prompt-ambiguous-request', 'utf8').digest('hex'),
        hostContext: Object.freeze({ ...hostContext, root_inventory_sequence: 2, root_manifest_sha256: '9'.repeat(64) }),
      })),
      /MEMORY_DISPATCH_REPLAY_BLOCKED/,
      'an unrelated Host root inventory revision must not reopen an UNKNOWN generation',
    );
    assert.equal(sends, 1);
  } finally {
    await fixture.close();
  }
});

test('pre-aborted Host generation is rejected before durable start or upstream egress', async () => {
  const fixture = await createFixture();
  const controller = new AbortController();
  controller.abort();
  try {
    await assert.rejects(
      fixture.gateway.dispatchProtectedRequest(validRequest('pre-aborted-generation', {
        signal: controller.signal,
      })),
      /MEMORY_DISPATCH_CANCELLED_BEFORE_START/,
    );
    assert.equal(fixture.calls.length, 0, 'pre-cancelled generation must not open upstream transport');
    const db = new DatabaseSync(fixture.ledgerPath);
    try {
      assert.equal(
        db.prepare('SELECT COUNT(*) AS n FROM dispatch_ledger WHERE request_id=?')
          .get('pre-aborted-generation').n,
        0,
        'pre-cancelled generation must not persist DISPATCH_STARTED',
      );
    } finally {
      db.close();
    }
  } finally {
    await fixture.close();
  }
});

test('cancellation after dispatch-start records UNKNOWN and blocks every retry', async () => {
  const controller = new AbortController();
  let sends = 0;
  let signalStarted;
  const transportStarted = new Promise(resolve => { signalStarted = resolve; });
  const fixture = await createFixture({
    createTransport: (request) => () => new Promise((_resolve, reject) => {
      sends += 1;
      signalStarted();
      assert.equal(request.signal, controller.signal,
        'the caller cancellation signal must reach the actual transport capability');
      if (request.signal.aborted) {
        reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
        return;
      }
      request.signal.addEventListener('abort', () => {
        reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
      }, { once: true });
    }),
  });
  try {
    const pending = fixture.gateway.dispatchProtectedRequest(validRequest('cancelled-dispatch', {
      signal: controller.signal,
    }));
    await transportStarted;
    controller.abort();
    await assert.rejects(pending, /MEMORY_DISPATCH_OUTCOME_UNKNOWN/);
    assert.equal(sends, 1, 'cancellation must not trigger a transport retry');

    const db = new DatabaseSync(fixture.ledgerPath);
    try {
      assert.equal(
        db.prepare('SELECT status FROM dispatch_ledger WHERE request_id=?')
          .get('cancelled-dispatch').status,
        'UNKNOWN',
      );
    } finally {
      db.close();
    }

    await assert.rejects(
      fixture.gateway.dispatchProtectedRequest(validRequest('cancelled-dispatch')),
      /MEMORY_DISPATCH_DUPLICATE_ID/,
    );
    await assert.rejects(
      fixture.gateway.dispatchProtectedRequest(validRequest('cancelled-dispatch-new-id')),
      /MEMORY_DISPATCH_REPLAY_BLOCKED/,
    );
    assert.equal(sends, 1, 'same-ID and new-ID retries must both remain blocked');
  } finally {
    await fixture.close();
  }
});

test('serialized Gateway endpoint rejects dispatch because it cannot carry an in-process transport capability', async () => {
  const hostToken = 'host-dispatch-token-for-gateway-tests-00000000000000000000000000000004';
  const signingKey = 'host-dispatch-signing-key-for-gateway-tests-00000000000000000000000000000005';
  let upstreamCalls = 0;
  let observedRoute;
  let observedBody;
  const transport = ({ route, model, body, forwardResponse }) => {
    upstreamCalls += 1;
    observedRoute = route;
    observedBody = body;
    const forwarded = forwardResponse(new Response('selected-backend-response', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    }));
    return Promise.resolve(forwarded).then(() => ({ status: 200 }));
  };
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
      sender_route: request.senderRoute,
      model: request.model,
      stream: request.stream,
      body: request.body,
      world_id: request.worldId,
      actor_id: request.actorId,
      purpose: request.purpose,
      host_context: request.hostContext,
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
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'IN_PROCESS_TRANSPORT_REQUIRED' });
    assert.equal(upstreamCalls, 0, 'JSON/HTTP dispatch must never create or invoke a provider transport');
    assert.equal(observedRoute, undefined);
    assert.equal(observedBody, undefined);
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

test('real process crash after transport handoff recovers UNKNOWN on fresh Gateway startup', async () => {
  const fixture = await createFixture();
  const counterPath = join(fixture.directory, 'upstream-call-count.txt');
  try {
    fixture.gateway.close();
    const moduleUrl = new URL('../src/security/memory-dispatch-gateway.js', import.meta.url).href;
    const script = [
      'import { appendFileSync } from "node:fs";',
      'import { MemoryDispatchGateway } from ' + JSON.stringify(moduleUrl) + ';',
      'const [ledgerPath, coordinatorPath, authorityPort, readToken, counterPath, requestJson] = process.argv.slice(1);',
      'const gateway = new MemoryDispatchGateway({',
      '  ledgerPath, coordinatorPath, authorityPort: Number(authorityPort), readToken,',
      '  readCoreEvidence: ({ worldId, actorId, sources }) => ({ head: 1, world_id: worldId, actor_id: actorId, readiness: "READY", inventory_status: "READY", policy_authority: { authority_id: "test-memory-policy", generation: 1, fingerprint: "' + 'd'.repeat(64) + '" }, sources }),',
      '  readProviderEvidence: ({ worldId, actorId, purpose, sources, candidates, providerEvidenceCursor }) => ({ head: 1, world_id: worldId, actor_id: actorId, purpose, granted: true, readiness: "READY", sources, candidates, provider_evidence_cursor: providerEvidenceCursor }),',
      '  readHostEvidence: ({ hostContext: binding, worldId, actorId }) => ({ status: "READY", adapter_id: binding.adapter_id, core_conversation_id: binding.core_conversation_id, world_id: worldId, actor_id: actorId, root_id: binding.root_id, root_inventory_sequence: binding.root_inventory_sequence, root_manifest_sha256: binding.root_manifest_sha256 }),',
      '  readHostEvidence: ({ hostContext: binding, worldId, actorId }) => ({ status: "READY", adapter_id: binding.adapter_id, core_conversation_id: binding.core_conversation_id, world_id: worldId, actor_id: actorId, root_id: binding.root_id, root_inventory_sequence: binding.root_inventory_sequence, root_manifest_sha256: binding.root_manifest_sha256 }),',
      '});',
      'const request = JSON.parse(requestJson);',
      'gateway.dispatchProtectedRequest({ ...request, transport: () => { appendFileSync(counterPath, "x"); process.stdout.write("HANDOFF\\n", () => process.exit(77)); return new Promise(() => {}); } });',
      'setTimeout(() => process.exit(78), 5000);',
    ].join('\n');
    const child = spawn(process.execPath, [
      '--input-type=module', '-e', script,
      fixture.ledgerPath, fixture.coordinatorPath, String(fixture.port), readToken,
      counterPath, JSON.stringify(validRequest('process-crash-after-handoff')),
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        PATH: process.env.PATH || '',
        SystemRoot: process.env.SystemRoot || '',
        WINDIR: process.env.WINDIR || '',
      },
    });
    const exitPromise = once(child, 'exit');
    const firstChildEvent = await Promise.race([
      once(child.stdout, 'data').then(([chunk]) => ({ chunk })),
      exitPromise.then(([exitCode, signal]) => ({ exitCode, signal })),
    ]);
    assert.ok(firstChildEvent.chunk, 'child must reach the protected transport handoff before exiting; exit='
      + String(firstChildEvent.exitCode) + ' signal=' + String(firstChildEvent.signal));
    assert.match(String(firstChildEvent.chunk), /HANDOFF/);
    const [exitCode] = await exitPromise;
    assert.equal(exitCode, 77, 'child must terminate immediately after the one transport handoff');

    fixture.reopenGateway();
    assert.equal((await import('node:fs')).readFileSync(counterPath, 'utf8'), 'x');
    const ledger = new DatabaseSync(fixture.ledgerPath);
    try {
      assert.equal(
        ledger.prepare('SELECT status FROM dispatch_ledger WHERE request_id=?')
          .get('process-crash-after-handoff').status,
        'UNKNOWN',
      );
    } finally {
      ledger.close();
    }
    await assert.rejects(
      fixture.gateway.dispatchProtectedRequest(validRequest('process-crash-replay-new-id')),
      /MEMORY_DISPATCH_REPLAY_BLOCKED/,
    );
  } finally {
    await fixture.close();
  }
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

test('existing dispatch ledger migrates its sender CHECK to the complete registry without losing history', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-dispatch-ledger-route-migration-'));
  const ledgerPath = join(directory, 'ledger.sqlite');
  const coordinatorPath = join(directory, 'coordinator.sqlite');
  const legacyRoutes = PROTECTED_MEMORY_SENDER_ROUTES.filter(route => route !== 'cometapi');
  const legacyCheck = legacyRoutes.map(route => "'" + route + "'").join(',');
  const db = new DatabaseSync(ledgerPath);
  try {
    db.exec(`
      CREATE TABLE dispatch_ledger (
        request_id TEXT PRIMARY KEY,
        request_digest TEXT NOT NULL CHECK(length(request_digest)=64),
        route TEXT NOT NULL CHECK(route='host-selected-chat-generation'),
        sender_route TEXT NOT NULL CHECK(sender_route IN (${legacyCheck})),
        model TEXT NOT NULL,
        stream INTEGER NOT NULL CHECK(stream IN (0,1)),
        world_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        purpose TEXT NOT NULL,
        sources_json TEXT NOT NULL,
        candidates_json TEXT NOT NULL,
        core_head INTEGER NOT NULL CHECK(core_head > 0),
        provider_head INTEGER NOT NULL CHECK(provider_head > 0),
        policy_authority_id TEXT NOT NULL,
        policy_generation INTEGER NOT NULL CHECK(policy_generation > 0),
        policy_fingerprint TEXT NOT NULL CHECK(length(policy_fingerprint)=64),
        status TEXT NOT NULL CHECK(status IN ('DISPATCH_STARTED','COMPLETED','UNKNOWN')),
        outcome_code INTEGER,
        started_at TEXT NOT NULL,
        finished_at TEXT
      );
      CREATE INDEX dispatch_ledger_status_started ON dispatch_ledger(status, started_at);
      CREATE UNIQUE INDEX dispatch_ledger_unresolved_digest
        ON dispatch_ledger(request_digest) WHERE status IN ('DISPATCH_STARTED','UNKNOWN');
    `);
    db.prepare(`
      INSERT INTO dispatch_ledger(
        request_id,request_digest,route,sender_route,model,stream,world_id,actor_id,purpose,
        sources_json,candidates_json,core_head,provider_head,policy_authority_id,policy_generation,
        policy_fingerprint,status,outcome_code,started_at,finished_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      'legacy-history-row', 'a'.repeat(64), 'host-selected-chat-generation', 'horde-text',
      'legacy-model', 0, 'world-legacy', 'npc-legacy', 'npc_decision',
      '[]', '[]', 1, 1, 'legacy-policy', 1, 'b'.repeat(64),
      'COMPLETED', null, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:01.000Z',
    );
  } finally {
    db.close();
  }

  let gateway;
  try {
    gateway = new MemoryDispatchGateway({
      ledgerPath,
      coordinatorPath,
      authorityPort: 1,
      readToken,
      readCoreEvidence: () => ({}),
      readProviderEvidence: () => ({}),
      readHostEvidence: () => ({}),
    });
    const verify = new DatabaseSync(ledgerPath);
    try {
      const schema = verify.prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='dispatch_ledger'",
      ).get().sql;
      assert.ok(schema.includes("'cometapi'"));
      assert.ok(schema.includes("'horde-text'"));
      assert.equal(
        verify.prepare('SELECT sender_route,status FROM dispatch_ledger WHERE request_id=?')
          .get('legacy-history-row').sender_route,
        'horde-text',
      );
      assert.equal(
        verify.prepare('SELECT status FROM dispatch_ledger WHERE request_id=?')
          .get('legacy-history-row').status,
        'COMPLETED',
      );
    } finally {
      verify.close();
    }
  } finally {
    try { gateway?.close(); } catch {}
    rmSync(directory, { recursive: true, force: true });
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
      readHostEvidence: () => ({}),
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
  let snapshotUnavailable = false;
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
    rememberEnv('LOGIC_ENGINE_ACCEPTED_HEAD_CORE_TOKEN', undefined);

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
      getSnapshot: async () => {
        if (snapshotUnavailable) throw new Error('injected snapshot outage');
        return { world_revision: 1, commit_sequence: 1 };
      },
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
    const bootstrapDb = new DatabaseSync(providerPath);
    bootstrapDb.prepare('INSERT INTO memory_raw_captures (world_id,conversation_id,message_id,version_id,role,content_text,content_sha256,metadata_json,captured_at,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,NULL)')
      .run(rawSource.world_id, rawSource.conversation_id, rawSource.message_id, rawSource.version_id,
        'assistant', rawText, createHash('sha256').update(rawText, 'utf8').digest('hex'), '{}',
        '2026-01-01T00:00:00.000Z');
    bootstrapDb.close();
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
    let signalTransportStart;
    const transportStarted = new Promise((resolve) => { signalTransportStart = resolve; });
    let releaseTransport;
    const transportGate = new Promise((resolve) => { releaseTransport = resolve; });
    gateway = installTestTransport(new MemoryDispatchGateway({
      ledgerPath,
      coordinatorPath,
      authorityPort: service.port,
      readToken,
      readCoreEvidence: ({ worldId, actorId, sources }) => ({
        head: 1, world_id: worldId, actor_id: actorId,
        readiness: 'READY', inventory_status: 'READY',
        policy_authority: { authority_id: 'test-memory-policy', generation: 1, fingerprint: 'd'.repeat(64) },
        sources,
      }),
      readProviderEvidence: ({ worldId, actorId, purpose, providerEvidenceCursor }) => {
        const head = providerReader.prepare('SELECT head FROM accepted_head_state WHERE singleton=1').get();
        const queryGrant = providerReader.prepare('SELECT allowed FROM memory_query_grants WHERE world_id=? AND subject_id=? AND purpose=?').get(worldId, actorId, purpose);
        const recordGrant = providerReader.prepare('SELECT allowed,authorization_generation FROM memory_record_grants WHERE world_id=? AND subject_id=? AND purpose=? AND record_ref=? AND record_version=?').get(worldId, actorId, purpose, record.record_ref, record.record_version);
        const stored = providerReader.prepare('SELECT * FROM memory_records WHERE world_id=? AND record_ref=? AND record_version=?').get(worldId, record.record_ref, record.record_version);
        const index = providerReader.prepare('SELECT index_health,source_reconciliation FROM memory_index_state WHERE world_id=?').get(worldId);
        return {
          head: head?.head,
          world_id: worldId, actor_id: actorId, purpose,
          granted: queryGrant?.allowed === 1 && recordGrant?.allowed === 1,
          readiness: index?.index_health === 'ready' && index?.source_reconciliation === 'current' ? 'READY' : 'NOT_READY',
          sources: stored ? [{ source_kind: stored.source_kind, source_entity_id: stored.source_entity_id, source_version: stored.source_version }] : [],
          candidates: stored && recordGrant ? [{ record_ref: stored.record_ref, record_version: stored.record_version, authorization_generation: recordGrant.authorization_generation, source_kind: stored.source_kind, source_entity_id: stored.source_entity_id, source_version: stored.source_version }] : [],
          provider_evidence_cursor: providerEvidenceCursor,
        };
      },
      readHostEvidence: ({ hostContext: binding, worldId, actorId }) => ({ status: 'READY', adapter_id: binding.adapter_id, core_conversation_id: binding.core_conversation_id, world_id: worldId, actor_id: actorId, root_id: binding.root_id, root_inventory_sequence: binding.root_inventory_sequence, root_manifest_sha256: binding.root_manifest_sha256 }),
    }), (outgoing) => () => {
      calls.push(outgoing);
      signalTransportStart();
      return transportGate.then(() => ({ status: 200, body: 'accepted' }));
    });

    // Tombstone and purge are real Provider mutation APIs too; the legacy row
    // was seeded before enrollment, so no enrolled write bypasses the head guard.
    const providerHead = () => providerReader.prepare(
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
    await assert.rejects(() => gateway.dispatchProtectedRequest(request), /MEMORY_DISPATCH_NOT_READY/);
    assert.equal(calls.length, 0, 'revocation before dispatch-start must cause zero upstream calls');
    const ledger = new DatabaseSync(ledgerPath);
    try {
      assert.equal(ledger.prepare('SELECT COUNT(*) AS n FROM dispatch_ledger').get().n, 0,
        'denied pre-start request must not create DISPATCH_STARTED');
    } finally {
      ledger.close();
    }

    // Query-grant revocation through the real Provider API must also deny
    // before dispatch-start, independently of the record-level grant.
    provider.grantRecord(scope, record.record_ref, record.record_version, true);
    provider.grantQuery(scope, false);
    await assert.rejects(
      () => gateway.dispatchProtectedRequest(validRequest('provider-query-revoked-before-start')),
      /MEMORY_DISPATCH_NOT_READY/,
    );
    assert.equal(calls.length, 0, 'query revocation before dispatch-start must cause zero upstream calls');
    const queryRevocationLedger = new DatabaseSync(ledgerPath);
    try {
      assert.equal(queryRevocationLedger.prepare('SELECT COUNT(*) AS n FROM dispatch_ledger').get().n, 0,
        'query-revoked request must not create DISPATCH_STARTED');
    } finally {
      queryRevocationLedger.close();
    }

    // Readiness loss is a real reconciliation failure, not a fixture update.
    provider.grantQuery(scope, true);
    snapshotUnavailable = true;
    assert.equal((await provider.reconcile(scope.world_id)).status, 'unavailable');
    await assert.rejects(
      () => gateway.dispatchProtectedRequest(validRequest('provider-readiness-lost-before-start')),
      /MEMORY_DISPATCH_NOT_READY/,
    );
    assert.equal(calls.length, 0, 'Provider readiness loss before dispatch-start must cause zero upstream calls');
    const readinessLedger = new DatabaseSync(ledgerPath);
    try {
      assert.equal(readinessLedger.prepare('SELECT COUNT(*) AS n FROM dispatch_ledger').get().n, 0,
        'not-ready request must not create DISPATCH_STARTED');
    } finally {
      readinessLedger.close();
    }
    snapshotUnavailable = false;
    await provider.rebuildIndex(scope.world_id);
    assert.equal((await provider.reconcile(scope.world_id)).status, 'current');

    // Reverse-order control: durable dispatch-start wins first. A later revoke
    // cannot recall the in-flight request; exactly one transport call is allowed.
    provider.grantRecord(scope, record.record_ref, record.record_version, true);
    const currentAuthorizationGeneration = providerReader.prepare(
      'SELECT authorization_generation FROM memory_record_grants WHERE world_id=? AND subject_id=? AND purpose=? AND record_ref=? AND record_version=?',
    ).get(scope.world_id, scope.subject_id, scope.purpose, record.record_ref, record.record_version).authorization_generation;
    const inFlight = gateway.dispatchProtectedRequest(validRequest('dispatch-start-wins-before-revoke', {
      candidates: [{ ...validRequest().candidates[0], authorization_generation: currentAuthorizationGeneration }],
    }));
    await transportStarted;
    provider.revokeRecord(scope, record.record_ref, record.record_version);
    releaseTransport();
    await assert.rejects(inFlight, /MEMORY_DISPATCH_FINAL_RESPONSE_REVALIDATION_DENIED/);
    assert.equal(calls.length, 1, 'dispatch-start winning first permits one upstream call but revoke blocks Host release');
    const completedLedger = new DatabaseSync(ledgerPath);
    try {
      assert.equal(completedLedger.prepare('SELECT status FROM dispatch_ledger WHERE request_id=?')
        .get('dispatch-start-wins-before-revoke').status, 'UNKNOWN');
    } finally {
      completedLedger.close();
    }
  } finally {
    try { releaseTransport?.(); } catch {}
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


test('real Core source mutation and Gateway dispatch-start share one cross-process ordering boundary', async () => {
  let releaseTransport;
  let markTransportStarted;
  const transportStarted = new Promise((resolve) => { markTransportStarted = resolve; });
  const transportGate = new Promise((resolve) => { releaseTransport = resolve; });
  const calls = [];
  const fixture = await createFixture();
  const previousCoordinatorPath = process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH;
  const acceptedHeadEnv = Object.fromEntries([
    'LOGIC_ENGINE_ACCEPTED_HEAD_REQUIRED',
    'LOGIC_ENGINE_ACCEPTED_HEAD_PORT',
    'LOGIC_ENGINE_ACCEPTED_HEAD_CORE_TOKEN',
    'LOGIC_ENGINE_ACCEPTED_HEAD_PROVIDER_TOKEN',
  ].map((name) => [name, process.env[name]]));
  for (const name of Object.keys(acceptedHeadEnv)) delete process.env[name];
  const corePath = join(fixture.directory, 'core.sqlite');
  let coreStore;
  let coreReader;
  let gateway;
  try {
    fixture.gateway.close();
    process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH = fixture.coordinatorPath;
    coreStore = new SQLiteStore(corePath);
    const core = new LogicEngine(coreStore);
    core.createWorld({
      world_id: 'world-1',
      world_pack_id: 'test.world',
      world_pack_version: '1.0.0',
      game_time: '2026-01-01T00:00:00Z',
    });
    core.commitEvent('world-1', {
      idempotency_key: 'dispatch-core-seed',
      turn_id: 'dispatch-core-seed',
      event_type: 'action.completed',
      expected_revision: 0,
      effects: [
        { kind: 'entity.create', entity_id: 'npc-1', entity_type: 'character' },
        { kind: 'entity.create', entity_id: 'entity-42', entity_type: 'character' },
      ],
    });
    coreReader = openReadOnlySqliteDatabase(corePath);

    const readCoreEvidence = ({ worldId, actorId, sources }) => {
      const world = coreReader.prepare('SELECT status FROM worlds WHERE world_id=?').get(worldId);
      if (!world || world.status !== 'active') {
        return { head: 1, world_id: worldId, actor_id: actorId, readiness: 'NOT_READY', inventory_status: 'NOT_READY', sources: [] };
      }
      const currentSources = sources.map((source) => {
        const entity = coreReader.prepare(`
          SELECT entities.status, entity_source_versions.source_version
          FROM entities LEFT JOIN entity_source_versions
            ON entity_source_versions.world_id=entities.world_id
            AND entity_source_versions.entity_id=entities.entity_id
          WHERE entities.world_id=? AND entities.entity_id=?
        `).get(worldId, source.source_entity_id);
        return entity && entity.status !== 'destroyed'
          && Number.isSafeInteger(entity.source_version) && entity.source_version > 0
          ? { source_kind: 'canonical_entity', source_entity_id: source.source_entity_id,
            source_version: 'core-entity-v1:' + String(entity.source_version) }
          : { source_kind: 'canonical_entity', source_entity_id: source.source_entity_id, source_version: 'unavailable' };
      });
      return {
        head: 1,
        world_id: worldId,
        actor_id: actorId,
        readiness: 'READY',
        inventory_status: 'READY',
        policy_authority: { authority_id: 'test-memory-policy', generation: 1, fingerprint: 'd'.repeat(64) },
        sources: currentSources,
      };
    };
    gateway = installTestTransport(new MemoryDispatchGateway({
      ledgerPath: fixture.ledgerPath,
      coordinatorPath: fixture.coordinatorPath,
      authorityPort: fixture.port,
      readToken,
      readCoreEvidence,
      readProviderEvidence: ({ worldId, actorId, purpose, sources, candidates, providerEvidenceCursor }) => ({
        head: 1,
        world_id: worldId,
        actor_id: actorId,
        purpose,
        granted: true,
        readiness: 'READY',
        sources,
        candidates,
        provider_evidence_cursor: providerEvidenceCursor,
      }),
      readHostEvidence: ({ hostContext: binding, worldId, actorId }) => ({ status: 'READY', adapter_id: binding.adapter_id, core_conversation_id: binding.core_conversation_id, world_id: worldId, actor_id: actorId, root_id: binding.root_id, root_inventory_sequence: binding.root_inventory_sequence, root_manifest_sha256: binding.root_manifest_sha256 }),
    }), (request) => () => {
      calls.push(request);
      markTransportStarted();
      return transportGate.then(() => ({ status: 200 }));
    });

    const readCurrentVersion = () => {
      const row = coreReader.prepare(
        'SELECT source_version FROM entity_source_versions WHERE world_id=? AND entity_id=?',
      ).get('world-1', 'entity-42');
      return Number.isSafeInteger(row?.source_version) && row.source_version > 0
        ? 'core-entity-v1:' + String(row.source_version) : 'unavailable';
    };
    const requestAtVersion = (requestId, version) => {
      const base = validRequest(requestId);
      const sources = [{ source_kind: 'canonical_entity', source_entity_id: 'entity-42', source_version: version }];
      return {
        ...base,
        sources,
        candidates: [{
          ...base.candidates[0],
          source_entity_id: 'entity-42',
          source_version: version,
        }],
      };
    };
    const updateSource = (idempotencyKey) => {
      const snapshot = core.getSnapshot('world-1');
      return core.commitEvent('world-1', {
        idempotency_key: idempotencyKey,
        turn_id: idempotencyKey,
        event_type: 'action.completed',
        expected_revision: snapshot.world_revision,
        expected_commit_sequence: snapshot.commit_sequence,
        causal_links: [{ relation: 'REQUIRES', predicate: { kind: 'entity_exists', entity_id: 'entity-42' } }],
        read_set: ['entity:entity-42'],
        effects: [{ kind: 'entity.update', entity_id: 'entity-42', attributes: { updated_by: idempotencyKey } }],
      });
    };

    const staleVersion = readCurrentVersion();
    updateSource('core-update-before-dispatch');
    await assert.rejects(
      gateway.dispatchProtectedRequest(requestAtVersion('core-stale-before-start', staleVersion)),
      /MEMORY_DISPATCH_NOT_READY/,
    );
    assert.equal(calls.length, 0, 'a Core source mutation ordered before dispatch-start must produce zero upstream calls');

    const currentVersion = readCurrentVersion();
    const inFlight = gateway.dispatchProtectedRequest(requestAtVersion('core-dispatch-start-wins', currentVersion));
    await transportStarted;
    updateSource('core-update-after-dispatch-start');
    releaseTransport();
    await assert.rejects(inFlight, /MEMORY_DISPATCH_FINAL_RESPONSE_REVALIDATION_DENIED/);
    assert.equal(calls.length, 1, 'a Core mutation after dispatch-start cannot recall upstream but blocks Host release');

    const ledger = new DatabaseSync(fixture.ledgerPath);
    try {
      assert.equal(ledger.prepare('SELECT status FROM dispatch_ledger WHERE request_id=?')
        .get('core-dispatch-start-wins').status, 'UNKNOWN');
    } finally {
      ledger.close();
    }
  } finally {
    try { releaseTransport?.(); } catch {}
    try { gateway?.close(); } catch {}
    try { coreReader?.close(); } catch {}
    try { coreStore?.close(); } catch {}
    if (previousCoordinatorPath === undefined) delete process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH;
    else process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH = previousCoordinatorPath;
    for (const [name, value] of Object.entries(acceptedHeadEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await fixture.close();
  }
});

test('Host inventory change is revalidated under the Coordinator lease before dispatch-start', async () => {
  const fixture = await createFixture();
  try {
    fixture.setHostInventoryReady(false);
    await assert.rejects(
      fixture.gateway.dispatchProtectedRequest({
        ...validRequest('host-inventory-revoked'),
        transport: () => { fixture.calls.push('unexpected'); return Promise.resolve({ status: 200 }); },
      }),
      /MEMORY_DISPATCH_NOT_READY/,
    );
    assert.equal(fixture.calls.length, 0);
    assert.equal(
      fixture.gateway.db.prepare('SELECT COUNT(*) AS count FROM dispatch_ledger').get().count,
      0,
      'Host NON_READY must be rejected before durable DISPATCH_STARTED',
    );
  } finally {
    await fixture.close();
  }
});



test('Host inventory revoke after upstream completion blocks the actual response write', async () => {
  const fixture = await createFixture();
  try {
    const request = validRequest('host-revoked-before-response-write');
    const upstream = await fixture.gateway.dispatchProtectedRequest(request);
    fixture.setHostInventoryReady(false);
    let writes = 0;
    assert.throws(
      () => fixture.gateway.authorizeResponseWrite(request.requestId, () => { writes += 1; return upstream; }, { final: true }),
      /MEMORY_DISPATCH_FINAL_RESPONSE_REVALIDATION_DENIED/,
    );
    assert.equal(writes, 0, 'Host response must not be written after inventory authority is revoked');
    const row = fixture.gateway.db.prepare('SELECT status FROM dispatch_ledger WHERE request_id=?')
      .get(request.requestId);
    assert.equal(row.status, 'UNKNOWN', 'withheld response remains terminal and non-replayable');
  } finally {
    await fixture.close();
  }
});


test('streaming stops the next chunk after Host inventory authority changes', async () => {
  const fixture = await createFixture();
  const hostChunks = [];
  const request = validRequest('host-revoke-between-stream-chunks', { stream: true });
  try {
    await assert.rejects(fixture.gateway.dispatchProtectedRequest({
      ...request,
      forwardResponse: async () => {
        fixture.gateway.authorizeResponseWrite(request.requestId, () => hostChunks.push('chunk-1'));
        fixture.setHostInventoryReady(false);
        fixture.gateway.authorizeResponseWrite(request.requestId, () => hostChunks.push('chunk-2'));
      },
    }), /MEMORY_DISPATCH_OUTCOME_UNKNOWN/);
    assert.deepEqual(hostChunks, ['chunk-1'], 'no chunk after Host inventory authority changes may be written');
  } finally {
    await fixture.close();
  }
});


test('client cancellation after upstream completion blocks the first response release', async () => {
  const controller = new AbortController();
  const fixture = await createFixture({
    createTransport: () => () => new Promise((resolve) => {
      setImmediate(() => {
        resolve({ status: 200, body: 'accepted' });
        controller.abort(new Error('client disconnected before release'));
      });
    }),
  });
  try {
    const request = validRequest('cancel-after-upstream-before-release', {
      signal: controller.signal,
    });
    await assert.rejects(
      fixture.gateway.dispatchProtectedRequest(request),
      /MEMORY_DISPATCH_FINAL_RESPONSE_REVALIDATION_DENIED/,
    );
    const ledger = new DatabaseSync(fixture.ledgerPath);
    try {
      assert.equal(
        ledger.prepare('SELECT status FROM dispatch_ledger WHERE request_id=?')
          .get(request.requestId).status,
        'UNKNOWN',
      );
    } finally {
      ledger.close();
    }
  } finally {
    await fixture.close();
  }
});

test('client cancellation between streamed chunks blocks the next protected write', async () => {
  const controller = new AbortController();
  const fixture = await createFixture({
    createTransport: () => () => Promise.resolve({ status: 200, body: 'stream' }),
  });
  const chunks = [];
  const requestId = 'cancel-between-protected-stream-chunks';
  try {
    const request = validRequest(requestId, {
      stream: true,
      signal: controller.signal,
      forwardResponse: async () => {
        fixture.gateway.authorizeResponseWrite(requestId, () => {
          chunks.push('first');
        }, { final: false });
        controller.abort(new Error('client disconnected between chunks'));
        fixture.gateway.authorizeResponseWrite(requestId, () => {
          chunks.push('second');
        }, { final: false });
      },
    });
    await assert.rejects(
      fixture.gateway.dispatchProtectedRequest(request),
      /MEMORY_DISPATCH_OUTCOME_UNKNOWN/,
    );
    assert.deepEqual(chunks, ['first']);
    const ledger = new DatabaseSync(fixture.ledgerPath);
    try {
      assert.equal(
        ledger.prepare('SELECT status FROM dispatch_ledger WHERE request_id=?')
          .get(requestId).status,
        'UNKNOWN',
      );
    } finally {
      ledger.close();
    }
  } finally {
    await fixture.close();
  }
});
