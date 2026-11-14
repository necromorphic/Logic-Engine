import test from 'node:test';
import assert from 'node:assert/strict';
import { createHostDigestProxyHandler, createHostInventoryReconcileProxyHandler, createHostRootInventoryPersistence, createHostLifecycleJournalProxy } from '../st-server-digest-proxy.mjs';
import { createHash, createHmac } from 'node:crypto';
import { verifyHostMutationReceiptSignature } from '../../extension-gateway/server-plugin/st-host-mutation-receipt-signature.mjs';
import { createCommunicationDeliveryReceipt } from '../../extension-gateway/server-plugin/st-host-lifecycle-receipt-store.mjs';
import { resolve } from 'node:path';

const CONFIG = {
  LOGIC_ENGINE_CORE_URL: 'http://192.168.1.10:8787',
  LOGIC_ENGINE_API_TOKEN: 'core-api-token-long-enough',
  LOGIC_ENGINE_ADAPTER_ID: 'sillytavern-phone',
  LOGIC_ENGINE_ADAPTER_TOKEN: 'adapter-token-long-enough',
};
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
const GLOBAL_DATA_ROOT = '/tmp/st-global-data-root';
globalThis.DATA_ROOT = GLOBAL_DATA_ROOT;
const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const HOST_CONVERSATION_ID = '22222222-2222-4222-8222-222222222222:66666666-6666-4666-8666-666666666666:33333333-3333-4333-8333-333333333333';
const LIFECYCLE_CONVERSATION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:22222222-2222-4222-8222-222222222222:33333333-3333-4333-8333-333333333333';
const requestFor = (body, { sessionId = SESSION_ID, userHandle = 'alice', sessionHandle = userHandle } = {}) => ({
  body,
  user: { profile: { handle: userHandle }, directories: { root: '/tmp/st-root', chats: '/tmp/st-root/chats', groups: '/tmp/st-root/groups', groupChats: '/tmp/st-root/groupChats', extensions: '/tmp/st-root/extensions' } },
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
    assertOutsideRoot: async root => assert.equal(root, resolve(GLOBAL_DATA_ROOT)),
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
      assertOutsideRoot: async root => assert.equal(root, resolve(GLOBAL_DATA_ROOT)),
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
    identityStore: { assertOutsideRoot: async root => assert.equal(root, resolve(GLOBAL_DATA_ROOT)), resolveAuthenticatedAccount: async () => ({ host_installation_id: 'bad', authenticated_account_id: 'also-bad' }) },
    fetchImpl: async () => { calls++; throw new Error('must not call'); },
  });
  const invalidIdentity = await persist({ userHandle: 'alice', rootPath: '/srv/st/data', entries: rootEntries });
  assert.equal(invalidIdentity.status, 'NON_READY');
  const invalidManifest = await createHostRootInventoryPersistence({
    env: CONFIG,
    identityStore: { assertOutsideRoot: async root => assert.equal(root, resolve(GLOBAL_DATA_ROOT)), resolveAuthenticatedAccount: async () => ({
      host_installation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      authenticated_account_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    }) },
    fetchImpl: async () => { calls++; throw new Error('must not call'); },
  })({ userHandle: 'alice', rootPath: '/srv/st/data', entries: [{ ...rootEntries[0], path: '../escape' }] });
  assert.equal(invalidManifest.status, 'NON_READY');
  const oversized = await createHostRootInventoryPersistence({
    env: CONFIG,
    identityStore: { assertOutsideRoot: async root => assert.equal(root, resolve(GLOBAL_DATA_ROOT)), resolveAuthenticatedAccount: async () => ({
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


test('digest proxy accepts default-user mode only with the signed Host session identity', async () => {
  let calls = 0;
  const handler = createHostDigestProxyHandler({
    env: CONFIG,
    fetchImpl: async () => {
      calls++;
      return { status: 201, json: async () => ({ capture: { status: 'captured' } }) };
    },
  });
  const request = requestFor(capture);
  delete request.session.handle;
  const accepted = responseRecorder();
  await handler(request, accepted);
  assert.equal(accepted.statusCode, 201);
  const rejectedRequest = requestFor(capture);
  delete rejectedRequest.session.handle;
  rejectedRequest.session.logicEngineSessionHandle = 'another-user';
  const rejected = responseRecorder();
  await handler(rejectedRequest, rejected);
  assert.equal(rejected.statusCode, 403);
  assert.equal(rejected.payload.error.code, 'HOST_SESSION_SCOPE_REQUIRED');
  assert.equal(calls, 1);
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

test('capture proxy accepts the same stable conversation after a new authenticated ST session', async () => {
  let calls = 0;
  const handler = createHostDigestProxyHandler({ env: CONFIG, fetchImpl: async () => { calls++; return { status: 201, json: async () => ({ capture: { status: 'captured' } }) }; } });
  const restartedSession = responseRecorder();
  await handler(requestFor(capture, { sessionId: '44444444-4444-4444-8444-444444444444' }), restartedSession);
  assert.equal(restartedSession.statusCode, 201);
  const unauthenticated = responseRecorder();
  await handler(requestFor(capture, { sessionHandle: 'another-user' }), unauthenticated);
  assert.equal(unauthenticated.statusCode, 403);
  assert.equal(unauthenticated.payload.error.code, 'HOST_SESSION_SCOPE_REQUIRED');
  assert.equal(calls, 1);
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

test('reconciliation proxy preserves stable conversation scope across authenticated session restarts and rejects malformed inventories', async () => {
  let calls = 0;
  const handler = createHostInventoryReconcileProxyHandler({
    env: CONFIG,
    fetchImpl: async () => { calls++; return { status: 201, json: async () => ({ inventory_status: 'REVIEW_ONLY' }) }; },
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
  const restartedSessionResponse = responseRecorder();
  await handler(requestFor(valid, { sessionId: '44444444-4444-4444-8444-444444444444' }), restartedSessionResponse);
  assert.equal(restartedSessionResponse.statusCode, 201);
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
  assert.equal(calls, 1);
});


test('lifecycle journal proxy derives account identity and signs only server-verified persisted receipts', async () => {
  let observed;
  const receiptCalls = [];
  const identityStore = {
    assertOutsideRoot: async root => assert.equal(root, resolve(GLOBAL_DATA_ROOT)),
    resolveAuthenticatedAccount: async handle => {
      assert.equal(handle, 'alice');
      return {
        host_installation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        authenticated_account_id: '22222222-2222-4222-8222-222222222222',
      };
    },
  };
  const receiptStore = {
    assertOutsideRoot: async root => assert.equal(root, resolve(GLOBAL_DATA_ROOT)),
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
  const preparedRequest = requestFor(event);
  await proxy.append(preparedRequest, response);
  assert.equal(response.statusCode, 201);
  assert.deepEqual(preparedRequest.session.logicEngineHostPreparedMutation, {
    protocol_version: 1,
    host_installation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    authenticated_account_id: '22222222-2222-4222-8222-222222222222',
    host_session_id: SESSION_ID,
    conversation_uuid: '33333333-3333-4333-8333-333333333333',
    mutation_id: event.mutation_id,
    event_id: event.event_id,
    operation: event.operation,
    mutation_digest: event.mutation_digest,
  });
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
  assert.equal(receiptCalls[0].directories.root, resolve('/tmp/st-root'));
  assert.equal(receiptCalls[0].directories.backups, resolve('/tmp/st-root/backups'));

  const committedEvent = {
    ...event,
    event_id: '66666666-6666-4666-8666-666666666666',
    event_type: 'MUTATION_COMMITTED',
    occurred_at: '2000-01-01T00:00:01.000Z',
  };
  const committedResponse = responseRecorder();
  preparedRequest.body = committedEvent;
  await proxy.append(preparedRequest, committedResponse);
  assert.equal(committedResponse.statusCode, 201);
  assert.equal(preparedRequest.session.logicEngineHostPreparedMutation, undefined);
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
    identityStore: {
      assertOutsideRoot: async root => assert.equal(root, resolve(GLOBAL_DATA_ROOT)),
      resolveAuthenticatedAccount: async () => ({
        host_installation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        authenticated_account_id: '22222222-2222-4222-8222-222222222222',
      }),
    },
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
  assert.equal(recoveredScope.directories.root, resolve('/tmp/st-root'));
  assert.equal(recoveredScope.directories.backups, resolve('/tmp/st-root/backups'));
  const eventBody = JSON.parse(calls[1].options.body);
  assert.equal(eventBody.event_type, 'MUTATION_COMMITTED');
  assert.equal(eventBody.receipt_digest, 'f'.repeat(64));
  assert.match(eventBody.receipt_signature, /^[a-f0-9]{64}$/);
});

test('lifecycle journal proxy status is session-bound and forwards only server-derived identity', async () => {
  let observed;
  const proxy = createHostLifecycleJournalProxy({
    env: CONFIG,
    identityStore: {
      assertOutsideRoot: async root => assert.equal(root, resolve(GLOBAL_DATA_ROOT)),
      resolveAuthenticatedAccount: async () => ({
        host_installation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        authenticated_account_id: '22222222-2222-4222-8222-222222222222',
      }),
    },
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
  const wrongAccount = responseRecorder();
  const wrongAccountRequest = requestFor({});
  wrongAccountRequest.query = {
    conversation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb:33333333-3333-4333-8333-333333333333',
  };
  await proxy.status(wrongAccountRequest, wrongAccount);
  assert.equal(wrongAccount.statusCode, 403);
  assert.equal(wrongAccount.payload.error.code, 'HOST_SESSION_SCOPE_REQUIRED');
});

test('digest proxy reports a bounded reason for Host session-scope rejection without weakening authentication', async () => {
  const handler = createHostDigestProxyHandler({ env: CONFIG, fetchImpl: async () => {
    throw Error('upstream must not be called for an unauthenticated request');
  } });
  const cases = [
    [{ user: { profile: {} }, session: {} }, 'HOST_USER_IDENTITY_MISSING'],
    [{ ...requestFor(capture), session: { ...requestFor(capture).session, logicEngineSessionHandle: 'other' } }, 'HOST_SESSION_HANDLE_MISMATCH'],
    [{ ...requestFor(capture), session: { ...requestFor(capture).session, handle: 'other' } }, 'HOST_SESSION_ACCOUNT_MISMATCH'],
    [{ ...requestFor(capture), session: { handle: 'alice', logicEngineSessionHandle: 'alice' } }, 'HOST_SESSION_ID_MISSING_OR_INVALID'],
    [{ ...requestFor({ ...capture, conversation_id: 'not-a-host-conversation-id' }) }, 'HOST_CONVERSATION_ID_INVALID'],
  ];
  for (const [request, reason] of cases) {
    const response = responseRecorder();
    await handler(request, response);
    assert.equal(response.statusCode, 403);
    assert.equal(response.payload.error.code, 'HOST_SESSION_SCOPE_REQUIRED');
    assert.equal(response.payload.error.reason, reason);
  }
});

test('digest proxy uses a bounded timeout signal after successful Host session authentication', async () => {
  let observedSignal;
  const handler = createHostDigestProxyHandler({
    env: CONFIG,
    timeoutMs: 1234,
    fetchImpl: async (_url, options) => {
      observedSignal = options.signal;
      return { status: 201, json: async () => ({ capture: { status: 'captured' } }) };
    },
  });
  const response = responseRecorder();
  await handler(requestFor(capture), response);
  assert.equal(response.statusCode, 201);
  assert.ok(observedSignal instanceof AbortSignal);
  assert.equal(observedSignal.aborted, false);
});


test('communication delivery receipt requires one persisted user message in a one-to-one character chat', () => {
  const installationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const accountId = '22222222-2222-4222-8222-222222222222';
  const conversationUuid = '33333333-3333-4333-8333-333333333333';
  const coreConversationId = [SESSION_ID, installationId, conversationUuid].join(':');
  const priorMessage = {
    message_id: '66666666-6666-4666-8666-666666666666',
    role: 'assistant',
    active_version_index: 0,
    versions: [{
      version_id: '77777777-7777-4777-8777-777777777777',
      version_index: 0,
      parent_version_id: null,
      content_sha256: 'b'.repeat(64),
      active: true,
    }],
  };
  const newMessage = {
    message_id: '88888888-8888-4888-8888-888888888888',
    role: 'user',
    active_version_index: 0,
    versions: [{
      version_id: '99999999-9999-4999-8999-999999999999',
      version_index: 0,
      parent_version_id: null,
      content_sha256: 'c'.repeat(64),
      active: true,
    }],
  };
  const scope = {
    operation: 'message-send',
    host_installation_id: installationId,
    authenticated_account_id: accountId,
    host_session_id: SESSION_ID,
    conversation_uuid: conversationUuid,
    event_id: '44444444-4444-4444-8444-444444444444',
    mutation_id: '55555555-5555-4555-8555-555555555555',
    mutation_digest: 'a'.repeat(64),
    occurred_at: '2026-10-31T00:00:01.000Z',
  };
  const snapshotProof = snapshotId => ({
    host_commit: '06bde939fb1e9c4c8d8641d810f0a916b5bce127',
    snapshot_id: snapshotId,
    source_snapshot_id: snapshotId,
    snapshot_sha256: '1'.repeat(64),
    source_inventory_sha256: '2'.repeat(64),
    source_manifest_sha256: '3'.repeat(64),
    mutation_coverage_manifest_sha256: '4'.repeat(64),
    mutation_coverage_source_files_sha256: '5'.repeat(64),
    snapshot_alignment: 'SHARED_VSS_SNAPSHOT',
  });
  const before = {
    target_kind: 'character-chat',
    target_locator: 'avatar-main/chat-1.jsonl',
    logical_identity: { identity_status: 'CURRENT_IDENTITIES_VERIFIED', messages: [priorMessage] },
    snapshot_proof: snapshotProof('snapshot-before'),
  };
  const after = {
    target_kind: 'character-chat',
    target_locator: 'avatar-main/chat-1.jsonl',
    logical_identity: { identity_status: 'CURRENT_IDENTITIES_VERIFIED', messages: [priorMessage, newMessage] },
    snapshot_proof: snapshotProof('snapshot-after'),
  };
  const recipientBinding = {
    adapter_id: CONFIG.LOGIC_ENGINE_ADAPTER_ID,
    conversation_id: coreConversationId,
    host_character_avatar_id: 'avatar-main',
    world_id: 'world-main',
    actor_id: 'npc-alice',
    actor_type: 'npc',
  };
  const receipt = createCommunicationDeliveryReceipt({
    scope, before, after, recipientBinding, hostCommit: '06bde939fb1e9c4c8d8641d810f0a916b5bce127',
  });
  assert.equal(receipt.evidence_type, 'communication_delivered');
  assert.equal(receipt.status, 'delivered');
  assert.deepEqual(receipt.recipient, {
    world_id: 'world-main', actor_id: 'npc-alice', actor_type: 'npc',
    host_character_avatar_id: 'avatar-main',
  });
  assert.deepEqual(receipt.source, {
    message_id: newMessage.message_id,
    version_id: newMessage.versions[0].version_id,
    content_sha256: 'c'.repeat(64),
  });
  assert.equal(JSON.stringify(receipt).includes('raw message text'), false);

  assert.equal(createCommunicationDeliveryReceipt({
    scope, before: { ...before, target_kind: 'group-chat' },
    after: { ...after, target_kind: 'group-chat' }, recipientBinding,
    hostCommit: '06bde939fb1e9c4c8d8641d810f0a916b5bce127',
  }), null);
  assert.equal(createCommunicationDeliveryReceipt({
    scope, before, after: { ...after, logical_identity: {
      ...after.logical_identity,
      messages: [priorMessage, { ...newMessage, role: 'assistant' }],
    } }, recipientBinding, hostCommit: '06bde939fb1e9c4c8d8641d810f0a916b5bce127',
  }), null);
  assert.equal(createCommunicationDeliveryReceipt({
    scope, before, after, recipientBinding: null,
    hostCommit: '06bde939fb1e9c4c8d8641d810f0a916b5bce127',
  }), null);
  assert.equal(createCommunicationDeliveryReceipt({
    scope, before, after,
    recipientBinding: { ...recipientBinding, host_character_avatar_id: 'different-avatar' },
    hostCommit: '06bde939fb1e9c4c8d8641d810f0a916b5bce127',
  }), null);
});

