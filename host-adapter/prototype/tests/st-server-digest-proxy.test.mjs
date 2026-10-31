import test from 'node:test';
import assert from 'node:assert/strict';
import { createHostDigestProxyHandler, createHostInventoryReconcileProxyHandler, createHostRootInventoryPersistence, createHostLifecycleJournalProxy } from '../st-server-digest-proxy.mjs';
import { createHash, createHmac } from 'node:crypto';

const CONFIG = {
  LOGIC_ENGINE_CORE_URL: 'http://192.168.1.10:8787',
  LOGIC_ENGINE_API_TOKEN: 'core-api-token-long-enough',
  LOGIC_ENGINE_ADAPTER_ID: 'sillytavern-phone',
  LOGIC_ENGINE_ADAPTER_TOKEN: 'adapter-token-long-enough',
};
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const HOST_CONVERSATION_ID = SESSION_ID + ':22222222-2222-4222-8222-222222222222:33333333-3333-4333-8333-333333333333';
const LIFECYCLE_CONVERSATION_ID = SESSION_ID + ':aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:33333333-3333-4333-8333-333333333333';
const requestFor = (body, { sessionId = SESSION_ID, userHandle = 'alice', sessionHandle = userHandle } = {}) => ({
  body,
  user: { profile: { handle: userHandle }, directories: { root: '/tmp/st-root', chats: '/tmp/st-root/chats', groups: '/tmp/st-root/groups', groupChats: '/tmp/st-root/groupChats' } },
  session: { handle: sessionHandle, logicEngineSessionId: sessionId, logicEngineSessionHandle: userHandle },
});
const capture = {
  conversation_id: HOST_CONVERSATION_ID,
  message_id: 'message-1',
  version_id: 'version-1',
  parent_version_id: null,
  content_sha256: 'a'.repeat(64),
  active: true,
  deleted: false,
};
function responseRecorder() {
  return {
    statusCode: null,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}


const rootEntries = [{
  path: 'chats/main.jsonl',
  identity: { dev: '1', ino: '2', mode: 33188, size: 64, mtimeMs: 1, ctimeMs: 1 },
  sha256: 'c'.repeat(64),
}];

test('root inventory persistence forwards only bounded digest metadata with server identity and credentials', async () => {
  let observed;
  const identityStore = {
    resolveAuthenticatedAccount: async handle => {
      assert.equal(handle, 'alice');
      return {
        host_installation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        authenticated_account_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      };
    },
  };
  const persist = createHostRootInventoryPersistence({
    env: CONFIG,
    identityStore,
    fetchImpl: async (url, options) => {
      observed = { url: String(url), options };
      return {
        status: 200,
        json: async () => ({
          inventory_status: 'REVIEW_ONLY',
          reconciliation: {
            status: 'BASELINED_REVIEW_ONLY',
            integrity_status: 'INTEGRITY_OK',
            sequence: 1,
            manifest_sha256: 'd'.repeat(64),
          },
        }),
      };
    },
  });
  const result = await persist({
    userHandle: 'alice',
    rootPath: resolve('/srv/st/data'),
    entries: rootEntries,
  });
  assert.equal(result.status, 'BASELINED_REVIEW_ONLY');
  assert.equal(result.sequence, 1);
  assert.equal(observed.url, 'http://192.168.1.10:8787/v1/host-root-inventory/baseline');
  assert.equal(observed.options.method, 'POST');
  assert.equal(observed.options.headers.authorization, 'Bearer ' + CONFIG.LOGIC_ENGINE_API_TOKEN);
  assert.equal(observed.options.headers['x-adapter-id'], CONFIG.LOGIC_ENGINE_ADAPTER_ID);
  assert.equal(observed.options.headers['x-adapter-token'], CONFIG.LOGIC_ENGINE_ADAPTER_TOKEN);
  const body = JSON.parse(observed.options.body);
  assert.equal(body.host_installation_id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.equal(body.authenticated_account_id, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  assert.equal(body.root_id, createHash('sha256').update(resolve('/srv/st/data')).digest('hex'));
  assert.deepEqual(body.entries, rootEntries);
  assert.equal(observed.options.body.includes('raw chat text'), false);
});

test('root inventory persistence falls back from first baseline to observation only on already-enrolled response', async () => {
  const requests = [];
  const persist = createHostRootInventoryPersistence({
    env: CONFIG,
    identityStore: {
      resolveAuthenticatedAccount: async () => ({
        host_installation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        authenticated_account_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      }),
    },
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), body: JSON.parse(options.body) });
      if (requests.length === 1) return {
        status: 409,
        json: async () => ({ error: { code: 'HOST_ROOT_INVENTORY_ALREADY_ENROLLED' } }),
      };
      return {
        status: 409,
        json: async () => ({
          inventory_status: 'NON_READY',
          reconciliation: {
            status: 'NON_READY', integrity_status: 'INTEGRITY_OK', sequence: 2,
            manifest_sha256: 'e'.repeat(64), delta_sha256: 'f'.repeat(64),
            counts: { added: 0, removed: 0, modified: 1, metadata_changed: 0, replaced: 0, moved: 0 },
          },
        }),
      };
    },
  });
  const result = await persist({ userHandle: 'alice', rootPath: '/srv/st/data', entries: rootEntries });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url.endsWith('/v1/host-root-inventory/baseline'), true);
  assert.equal(requests[1].url.endsWith('/v1/host-root-inventory/observe'), true);
  assert.notEqual(requests[0].body.event_id, requests[1].body.event_id);
  assert.equal(result.status, 'NON_READY');
  assert.equal(result.sequence, 2);
  assert.equal(result.delta_sha256, 'f'.repeat(64));
  assert.equal(result.counts.modified, 1);
});

test('root inventory persistence fails closed on invalid identity, malformed manifest and oversized payload', async () => {
  let calls = 0;
  const persist = createHostRootInventoryPersistence({
    env: CONFIG,
    identityStore: { resolveAuthenticatedAccount: async () => ({ host_installation_id: 'bad', authenticated_account_id: 'also-bad' }) },
    fetchImpl: async () => { calls++; throw new Error('must not call'); },
  });
  const invalidIdentity = await persist({ userHandle: 'alice', rootPath: '/srv/st/data', entries: rootEntries });
  assert.equal(invalidIdentity.status, 'NON_READY');
  const invalidManifest = await createHostRootInventoryPersistence({
    env: CONFIG,
    identityStore: { resolveAuthenticatedAccount: async () => ({
      host_installation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      authenticated_account_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    }) },
    fetchImpl: async () => { calls++; throw new Error('must not call'); },
  })({ userHandle: 'alice', rootPath: '/srv/st/data', entries: [{ ...rootEntries[0], path: '../escape' }] });
  assert.equal(invalidManifest.status, 'NON_READY');
  const oversized = await createHostRootInventoryPersistence({
    env: CONFIG,
    identityStore: { resolveAuthenticatedAccount: async () => ({
      host_installation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      authenticated_account_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    }) },
    fetchImpl: async () => { calls++; throw new Error('must not call'); },
  })({ userHandle: 'alice', rootPath: '/srv/st/data', entries: Array.from({ length: 25001 }, (_, index) => ({
    ...rootEntries[0], path: 'files/' + String(index).padStart(5, '0'),
    identity: { ...rootEntries[0].identity, ino: String(index + 2) },
  })) });
  assert.equal(oversized.status, 'NON_READY');
  assert.equal(calls, 0);
});

test('unconfigured proxy fails closed without making an upstream request', async () => {
  let called = false;
  const handler = createHostDigestProxyHandler({ env: {}, fetchImpl: async () => { called = true; } });
  const response = responseRecorder();
  await handler(requestFor(capture), response);
  assert.equal(response.statusCode, 503);
  assert.equal(response.payload.error.code, 'LOGIC_ENGINE_PROXY_UNCONFIGURED');
  assert.equal(called, false);
});

test('proxy forwards only allowlisted digest fields with server-side credentials', async () => {
  let observed;
  const handler = createHostDigestProxyHandler({
    env: CONFIG,
    fetchImpl: async (url, options) => {
      observed = { url: String(url), options };
      return { status: 201, json: async () => ({ capture: { status: 'captured' } }) };
    },
  });
  const response = responseRecorder();
  await handler(requestFor(capture), response);
  assert.equal(response.statusCode, 201);
  assert.deepEqual(response.payload, { capture: { status: 'captured' } });
  assert.equal(observed.url, 'http://192.168.1.10:8787/v1/host-version-ledger/capture');
  assert.equal(observed.options.method, 'POST');
  assert.equal(observed.options.headers.authorization, 'Bearer ' + CONFIG.LOGIC_ENGINE_API_TOKEN);
  assert.equal(observed.options.headers['x-adapter-id'], CONFIG.LOGIC_ENGINE_ADAPTER_ID);
  assert.equal(observed.options.headers['x-adapter-token'], CONFIG.LOGIC_ENGINE_ADAPTER_TOKEN);
  assert.deepEqual(JSON.parse(observed.options.body), capture);
  assert.equal(observed.options.body.includes('raw'), false);
});

test('proxy rejects caller URLs, world IDs, raw text and malformed digests before upstream I/O', async () => {
  let calls = 0;
  const handler = createHostDigestProxyHandler({ env: CONFIG, fetchImpl: async () => { calls++; } });
  for (const body of [
    { ...capture, url: 'http://attacker.invalid' },
    { ...capture, world_id: 'attacker-world' },
    (() => { const { parent_version_id, ...missingParent } = capture; return missingParent; })(),
    { ...capture, parent_version_id: 'bad parent id ' },
    { ...capture, content: 'raw prompt content' },
    { ...capture, content_sha256: 'not-a-digest' },
    { ...capture, active: true, deleted: true },
  ]) {
    const response = responseRecorder();
    await handler(requestFor(body), response);
    assert.equal(response.statusCode, 400);
    assert.equal(response.payload.error.code, 'INVALID_HOST_VERSION_CAPTURE');
  }
  assert.equal(calls, 0);
});

test('capture proxy rejects a different Host session or unauthenticated account before upstream I/O', async () => {
  let calls = 0;
  const handler = createHostDigestProxyHandler({ env: CONFIG, fetchImpl: async () => { calls++; } });
  for (const request of [
    requestFor(capture, { sessionId: '44444444-4444-4444-8444-444444444444' }),
    requestFor(capture, { sessionHandle: 'another-user' }),
  ]) {
    const response = responseRecorder();
    await handler(request, response);
    assert.equal(response.statusCode, 403);
    assert.equal(response.payload.error.code, 'HOST_SESSION_SCOPE_REQUIRED');
  }
  assert.equal(calls, 0);
});

test('proxy rejects upstream URL credentials and paths from configuration', async () => {
  for (const value of [
    'http://user:pass@192.168.1.10:8787',
    'http://192.168.1.10:8787/anything',
    'file:///tmp/core',
  ]) {
    const response = responseRecorder();
    await createHostDigestProxyHandler({
      env: { ...CONFIG, LOGIC_ENGINE_CORE_URL: value },
      fetchImpl: async () => { throw Error('must not call upstream'); },
    })(requestFor(capture), response);
    assert.equal(response.statusCode, 503);
  }
});

test('proxy maps upstream transport failures to a generic response without leaking details', async () => {
  const response = responseRecorder();
  await createHostDigestProxyHandler({
    env: CONFIG,
    fetchImpl: async () => { throw Error('private upstream secret and raw body'); },
  })(requestFor(capture), response);
  assert.equal(response.statusCode, 502);
  assert.equal(response.payload.error.code, 'LOGIC_ENGINE_UNREACHABLE');
  assert.equal(JSON.stringify(response.payload).includes('private upstream secret'), false);
});


test('reconciliation proxy forwards a bounded digest-only snapshot to the Core reconciliation route', async () => {
  const snapshot = {
    conversation_id: HOST_CONVERSATION_ID,
    complete: false,
    versions: [{
      message_id: 'message-1',
      version_id: 'version-1',
      parent_version_id: null,
      content_sha256: 'b'.repeat(64),
      active: true,
      deleted: false,
    }],
  };
  let observed;
  const handler = createHostInventoryReconcileProxyHandler({
    env: CONFIG,
    fetchImpl: async (url, options) => {
      observed = { url: String(url), options };
      return {
        status: 409,
        json: async () => ({
          inventory_status: 'NON_READY',
          reconciliation: { status: 'non_ready', code: 'HOST_INVENTORY_NOT_AUTHORIZED' },
        }),
      };
    },
  });
  const response = responseRecorder();
  await handler(requestFor(snapshot), response);
  assert.equal(response.statusCode, 409);
  assert.equal(response.payload.inventory_status, 'NON_READY');
  assert.equal(observed.url, 'http://192.168.1.10:8787/v1/host-version-ledger/reconcile');
  assert.equal(observed.options.headers.authorization, 'Bearer ' + CONFIG.LOGIC_ENGINE_API_TOKEN);
  assert.equal(observed.options.headers['x-adapter-id'], CONFIG.LOGIC_ENGINE_ADAPTER_ID);
  assert.deepEqual(JSON.parse(observed.options.body), snapshot);
});

test('reconciliation proxy rejects raw text, caller world scope, oversized row sets and oversized bodies', async () => {
  let calls = 0;
  const handler = createHostInventoryReconcileProxyHandler({
    env: CONFIG,
    fetchImpl: async () => { calls++; throw Error('must not call upstream'); },
  });
  const valid = {
    conversation_id: HOST_CONVERSATION_ID,
    complete: false,
    versions: [{
      message_id: 'message-1',
      version_id: 'version-1',
      parent_version_id: null,
      content_sha256: 'b'.repeat(64),
      active: true,
      deleted: false,
    }],
  };
  const wrongSessionResponse = responseRecorder();
  await handler(requestFor(valid, { sessionId: '44444444-4444-4444-8444-444444444444' }), wrongSessionResponse);
  assert.equal(wrongSessionResponse.statusCode, 403);
  assert.equal(wrongSessionResponse.payload.error.code, 'HOST_SESSION_SCOPE_REQUIRED');
  for (const body of [
    { ...valid, world_id: 'attacker-world' },
    { ...valid, versions: [{ ...valid.versions[0], content: 'raw source text' }] },
  ]) {
    const response = responseRecorder();
    await handler(requestFor(body), response);
    assert.equal(response.statusCode, 400);
    assert.equal(response.payload.error.code, 'INVALID_HOST_INVENTORY_RECONCILIATION');
  }
  const tooMany = { ...valid, versions: Array.from({ length: 25001 }, (_, index) => ({
    ...valid.versions[0], message_id: 'message-' + index, version_id: 'version-' + index,
  })) };
  const countResponse = responseRecorder();
  await handler(requestFor(tooMany), countResponse);
  assert.equal(countResponse.statusCode, 413);
  assert.equal(countResponse.payload.error.code, 'HOST_INVENTORY_TOO_LARGE');

  const byteResponse = responseRecorder();
  await handler(requestFor({ ...valid, padding: 'x'.repeat(8 * 1024 * 1024) }), byteResponse);
  assert.equal(byteResponse.statusCode, 413);
  assert.equal(byteResponse.payload.error.code, 'HOST_INVENTORY_TOO_LARGE');
  assert.equal(calls, 0);
});


test('lifecycle journal proxy derives account identity and signs only server-verified persisted receipts', async () => {
  let observed;
  const receiptCalls = [];
  const identityStore = {
    resolveAuthenticatedAccount: async handle => {
      assert.equal(handle, 'alice');
      return {
        host_installation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        authenticated_account_id: '22222222-2222-4222-8222-222222222222',
      };
    },
  };
  const receiptStore = {
    prepare: async (scope, directories) => {
      receiptCalls.push({ type: 'prepare', scope, directories });
      return { status: 'appended', prepared: { occurred_at: '2026-10-31T00:00:00.000Z' } };
    },
    commit: async (scope, directories) => {
      receiptCalls.push({ type: 'commit', scope, directories });
      return { status: 'appended', receipt_digest: 'f'.repeat(64), occurred_at: '2026-10-31T00:00:01.000Z' };
    },
    abort: async (scope, directories) => {
      receiptCalls.push({ type: 'abort', scope, directories });
      return { status: 'appended', receipt_digest: 'e'.repeat(64), occurred_at: '2026-10-31T00:00:01.000Z' };
    },
    recover: async () => ({ status: 'RECOVERY_REQUIRED' }),
  };
  const proxy = createHostLifecycleJournalProxy({
    env: CONFIG,
    identityStore,
    receiptStore,
    fetchImpl: async (url, options) => {
      observed = { url: String(url), options };
      return { status: 201, json: async () => ({ lifecycle: { status: 'appended' } }) };
    },
  });
  const event = {
    conversation_id: LIFECYCLE_CONVERSATION_ID,
    event_id: '44444444-4444-4444-8444-444444444444',
    event_type: 'MUTATION_PREPARED',
    mutation_id: '55555555-5555-4555-8555-555555555555',
    operation: 'edit-message',
    mutation_digest: 'a'.repeat(64),
    occurred_at: '2000-01-01T00:00:00.000Z',
  };
  const response = responseRecorder();
  await proxy.append(requestFor(event), response);
  assert.equal(response.statusCode, 201);
  assert.equal(observed.url, 'http://192.168.1.10:8787/v1/host-lifecycle/events');
  assert.equal(observed.options.headers['x-adapter-id'], CONFIG.LOGIC_ENGINE_ADAPTER_ID);
  assert.equal(observed.options.headers['x-adapter-token'], CONFIG.LOGIC_ENGINE_ADAPTER_TOKEN);
  const preparedBody = JSON.parse(observed.options.body);
  assert.deepEqual({
    host_installation_id: preparedBody.host_installation_id,
    authenticated_account_id: preparedBody.authenticated_account_id,
    host_session_id: preparedBody.host_session_id,
    conversation_uuid: preparedBody.conversation_uuid,
    event_id: preparedBody.event_id,
    event_type: preparedBody.event_type,
    mutation_id: preparedBody.mutation_id,
    operation: preparedBody.operation,
    mutation_digest: preparedBody.mutation_digest,
    occurred_at: preparedBody.occurred_at,
  }, {
    host_installation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    authenticated_account_id: '22222222-2222-4222-8222-222222222222',
    host_session_id: SESSION_ID,
    conversation_uuid: '33333333-3333-4333-8333-333333333333',
    event_id: event.event_id,
    event_type: event.event_type,
    mutation_id: event.mutation_id,
    operation: event.operation,
    mutation_digest: event.mutation_digest,
    occurred_at: '2026-10-31T00:00:00.000Z',
  });
  assert.equal(receiptCalls[0].type, 'prepare');
  assert.equal(receiptCalls[0].directories.root, '/tmp/st-root');

  const committedEvent = {
    ...event,
    event_id: '66666666-6666-4666-8666-666666666666',
    event_type: 'MUTATION_COMMITTED',
    occurred_at: '2000-01-01T00:00:01.000Z',
  };
  const committedResponse = responseRecorder();
  await proxy.append(requestFor(committedEvent), committedResponse);
  assert.equal(committedResponse.statusCode, 201);
  const committedBody = JSON.parse(observed.options.body);
  assert.equal(committedBody.host_session_id, SESSION_ID);
  assert.equal(committedBody.receipt_digest, 'f'.repeat(64));
  assert.equal(committedBody.mutation_digest, event.mutation_digest);
  assert.equal(committedBody.occurred_at, '2026-10-31T00:00:01.000Z');
  const proof = {
    protocol_version: 1,
    adapter_id: CONFIG.LOGIC_ENGINE_ADAPTER_ID,
    host_installation_id: committedBody.host_installation_id,
    authenticated_account_id: committedBody.authenticated_account_id,
    host_session_id: committedBody.host_session_id,
    conversation_uuid: committedBody.conversation_uuid,
    event_id: committedBody.event_id,
    event_type: committedBody.event_type,
    mutation_id: committedBody.mutation_id,
    operation: committedBody.operation,
    mutation_digest: committedBody.mutation_digest,
    receipt_digest: committedBody.receipt_digest,
    occurred_at: committedBody.occurred_at,
  };
  const expectedSignature = createHmac('sha256', CONFIG.LOGIC_ENGINE_ADAPTER_TOKEN)
    .update(canonical(proof), 'utf8').digest('hex');
  assert.equal(committedBody.receipt_signature, expectedSignature);
  assert.equal(receiptCalls[1].type, 'commit');

  const forgedReceipt = responseRecorder();
  await proxy.append(requestFor({ ...committedEvent, receipt_digest: 'b'.repeat(64) }), forgedReceipt);
  assert.equal(forgedReceipt.statusCode, 400);

  const mismatchedInstallation = responseRecorder();
  await proxy.append(requestFor({ ...event, conversation_id: HOST_CONVERSATION_ID }), mismatchedInstallation);
  assert.equal(mismatchedInstallation.statusCode, 403);
  assert.equal(mismatchedInstallation.payload.error.code, 'HOST_SESSION_SCOPE_REQUIRED');
});

test('lifecycle status performs durable server-side crash recovery before allowing the next mutation', async () => {
  const calls = [];
  let recoveredScope;
  const receiptStore = {
    prepare: async () => ({ status: 'appended', prepared: { occurred_at: '2026-10-31T00:00:00.000Z' } }),
    commit: async () => ({ status: 'appended' }),
    abort: async () => ({ status: 'appended' }),
    recover: async (scope, directories) => {
      recoveredScope = { scope, directories };
      return {
        status: 'COMMITTED',
        event_id: '77777777-7777-4777-8777-777777777777',
        receipt_digest: 'f'.repeat(64),
        occurred_at: '2026-10-31T00:00:02.000Z',
      };
    },
  };
  const proxy = createHostLifecycleJournalProxy({
    env: CONFIG,
    identityStore: { resolveAuthenticatedAccount: async () => ({
      host_installation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      authenticated_account_id: '22222222-2222-4222-8222-222222222222',
    }) },
    receiptStore,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (options.method === 'GET' && calls.filter(call => call.options.method === 'GET').length === 1) {
        return { status: 200, json: async () => ({ lifecycle: {
          status: 'PENDING_MUTATION',
          pending: {
            mutation_id: '55555555-5555-4555-8555-555555555555',
            operation: 'edit-message',
            mutation_digest: 'a'.repeat(64),
            prepared_event_id: '66666666-6666-4666-8666-666666666666',
          },
        } }) };
      }
      if (options.method === 'POST') return { status: 201, json: async () => ({ lifecycle: { status: 'appended' } }) };
      return { status: 200, json: async () => ({ lifecycle: { status: 'NO_PENDING_MUTATION' } }) };
    },
  });
  const request = requestFor({});
  request.query = { conversation_id: LIFECYCLE_CONVERSATION_ID };
  const response = responseRecorder();
  await proxy.status(request, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.lifecycle.status, 'NO_PENDING_MUTATION');
  assert.equal(calls.length, 3);
  assert.equal(recoveredScope.scope.mutation_id, '55555555-5555-4555-8555-555555555555');
  assert.equal(recoveredScope.scope.prepared_event_id, '66666666-6666-4666-8666-666666666666');
  assert.equal(recoveredScope.directories.root, '/tmp/st-root');
  const eventBody = JSON.parse(calls[1].options.body);
  assert.equal(eventBody.event_type, 'MUTATION_COMMITTED');
  assert.equal(eventBody.receipt_digest, 'f'.repeat(64));
  assert.match(eventBody.receipt_signature, /^[a-f0-9]{64}$/);
});

test('lifecycle journal proxy status is session-bound and forwards only server-derived identity', async () => {
  let observed;
  const proxy = createHostLifecycleJournalProxy({
    env: CONFIG,
    identityStore: { resolveAuthenticatedAccount: async () => ({
      host_installation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      authenticated_account_id: '22222222-2222-4222-8222-222222222222',
    }) },
    fetchImpl: async (url, options) => {
      observed = { url: String(url), options };
      return { status: 200, json: async () => ({ lifecycle: { status: 'NO_PENDING_MUTATION' } }) };
    },
  });
  const response = responseRecorder();
  const request = requestFor({});
  request.query = { conversation_id: LIFECYCLE_CONVERSATION_ID };
  await proxy.status(request, response);
  assert.equal(response.statusCode, 200);
  assert.equal(observed.url.startsWith('http://192.168.1.10:8787/v1/host-lifecycle/status?'), true);
  assert.equal(new URL(observed.url).searchParams.get('host_session_id'), SESSION_ID);
  const wrongSession = responseRecorder();
  const wrongRequest = requestFor({});
  wrongRequest.query = { conversation_id: HOST_CONVERSATION_ID };
  wrongRequest.session.logicEngineSessionId = '66666666-6666-4666-8666-666666666666';
  await proxy.status(wrongRequest, wrongSession);
  assert.equal(wrongSession.statusCode, 403);
  assert.equal(wrongSession.payload.error.code, 'HOST_SESSION_SCOPE_REQUIRED');
});
