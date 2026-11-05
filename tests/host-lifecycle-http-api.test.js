import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash, createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { createApiServer } from '../src/api/server.js';
import { HostLifecycleJournal } from '../src/application/host-lifecycle-journal.js';
import {
  PINNED_ST_COMMIT,
  PINNED_ST_MUTATION_COVERAGE_SHA256,
  PINNED_ST_MUTATION_ROUTE_COUNT,
} from '../host-adapter/extension-gateway/server-plugin/st-mutation-route-contract.mjs';
import {
  PINNED_PATCH_BUNDLE_SHA256,
  PINNED_HOST_HANDLER_GIT_BLOB_SHA,
  createSignedRootInventoryAttestation,
  verifySignedRootInventoryAttestation,
} from '../host-adapter/extension-gateway/server-plugin/st-source-attestation.mjs';
import {
  parseHostRootIdentityRegistry,
  resolveAdapterHostRootIdentity,
  resolveAdapterHostLifecycleIdentity,
  resolveRegisteredHostLifecycleIdentity,
  resolveRegisteredHostRootIdentity,
} from '../src/application/host-root-inventory-identity.js';

const API_TOKEN = 'host-lifecycle-api-token-long-enough';
const ADAPTER_TOKEN = 'host-lifecycle-adapter-token-long-enough';
const ADAPTER_ID = 'st-host-adapter';
const INSTALLATION = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const CONVERSATION = '44444444-4444-4444-8444-444444444444';
const ROOT_ID = createHash('sha256').update('test-root').digest('hex');
const AUTHORITY_ID = 'test-host-authority';
const AUTHORITY_GENERATION = 1;
const DIGEST = value => createHash('sha256').update(value).digest('hex');
const canonical = value => value && typeof value === 'object'
  ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
  : JSON.stringify(value);

function receiptSignature(event, identity) {
  const proof = {
    protocol_version: 1,
    adapter_id: identity.adapter_id,
    host_installation_id: event.host_installation_id,
    authenticated_account_id: event.authenticated_account_id,
    host_session_id: event.host_session_id,
    conversation_uuid: event.conversation_uuid,
    event_id: event.event_id,
    event_type: event.event_type,
    mutation_id: event.mutation_id,
    operation: event.operation,
    mutation_digest: event.mutation_digest,
    receipt_digest: event.receipt_digest,
    occurred_at: event.occurred_at,
  };
  return createHmac('sha256', ADAPTER_TOKEN).update(canonical(proof), 'utf8').digest('hex');
}

test('Core accepts a signed Host root completeness proof before granting lifecycle authority', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'host-lifecycle-http-'));
  const corePath = join(directory, 'core.sqlite');
  const coordinatorPath = resolve(join(directory, 'coordinator.sqlite'));
  const previousCoordinatorPath = process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH;
  process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH = coordinatorPath;
  const store = new SQLiteStore(corePath);
  const engine = new LogicEngine(store);
  const registry = parseHostRootIdentityRegistry(JSON.stringify([{
    adapter_id: ADAPTER_ID,
    host_installation_id: INSTALLATION,
    authenticated_account_id: ACCOUNT,
    root_id: ROOT_ID,
    source_manifest_sha256: DIGEST('test-source-manifest'),
  }]));
  const authority = { authority_id: AUTHORITY_ID, generation: AUTHORITY_GENERATION };
  let journal;
  const resolveJournalIdentity = input => {
    const resolved = resolveRegisteredHostLifecycleIdentity(registry, input);
    if (resolved.authorized !== true) return { authorized: false };
    const snapshot = journal.getAuthoritySnapshot({ ...resolved, ...authority });
    if (snapshot.status !== 'INTEGRITY_OK') return { authorized: false };
    return { ...resolved, ...authority, snapshot_fingerprint: snapshot.snapshot_fingerprint };
  };
  journal = new HostLifecycleJournal({
    path: join(directory, 'host-lifecycle.sqlite'),
    coordinatorPath,
    resolveIdentity: resolveJournalIdentity,
    resolveRootIdentity: input => resolveRegisteredHostRootIdentity(registry, input),
    verifyMutationReceipt: ({ event, identity }) => event.receipt_signature === receiptSignature(event, identity),
    verifyRootInventoryAttestation: ({ attestation, identity }) => verifySignedRootInventoryAttestation({
      attestation, identity, adapterToken: ADAPTER_TOKEN,
    }),
  });
  journal.setAuthorityGeneration(AUTHORITY_ID, AUTHORITY_GENERATION);
  const server = createApiServer({
    engine,
    token: API_TOKEN,
    adapterTokens: { [ADAPTER_ID]: ADAPTER_TOKEN },
    hostRootInventoryJournal: journal,
    hostLifecycleJournal: journal,
    resolveHostRootIdentity: input => resolveAdapterHostRootIdentity(registry, input),
    resolveHostLifecycleIdentity: input => {
      const resolved = resolveAdapterHostLifecycleIdentity(registry, input);
      if (resolved.authorized !== true) return { authorized: false };
      return resolveJournalIdentity(resolved);
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    journal.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
    if (previousCoordinatorPath === undefined) delete process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH;
    else process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH = previousCoordinatorPath;
  });

  const base = 'http://127.0.0.1:' + server.address().port;
  const headers = {
    authorization: 'Bearer ' + API_TOKEN,
    'x-adapter-id': ADAPTER_ID,
    'x-adapter-token': ADAPTER_TOKEN,
    'content-type': 'application/json',
  };
  const rootBody = {
    host_installation_id: INSTALLATION,
    authenticated_account_id: ACCOUNT,
    root_id: ROOT_ID,
    event_id: '55555555-5555-4555-8555-555555555555',
    entries: [{
      path: 'chats/main.jsonl',
      identity: { dev: '1', ino: '101', mode: 33188, size: 64, mtimeMs: 1, ctimeMs: 1 },
      sha256: DIGEST('chat-content'),
    }],
  };
  const post = (route, body, extraHeaders = headers) => fetch(base + route, {
    method: 'POST', headers: extraHeaders, body: JSON.stringify(body),
  });

  const malformed = await post('/v1/host-root-inventory/baseline', { ...rootBody, entries: {} });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, 'INVALID_HOST_ROOT_INVENTORY');

  const wrongRoot = await post('/v1/host-root-inventory/baseline', { ...rootBody, root_id: DIGEST('other-root') });
  assert.equal(wrongRoot.status, 403);
  assert.equal((await wrongRoot.json()).error.code, 'HOST_ROOT_INVENTORY_NOT_AUTHORIZED');

  const baseline = await post('/v1/host-root-inventory/baseline', rootBody);
  assert.equal(baseline.status, 200);
  const baselinePayload = await baseline.json();
  assert.equal(baselinePayload.inventory_status, 'REVIEW_ONLY');
  assert.equal(baselinePayload.reconciliation.status, 'BASELINED_REVIEW_ONLY');
  assert.equal(baselinePayload.reconciliation.integrity_status, 'INTEGRITY_OK');

  const observation = await post('/v1/host-root-inventory/observe', {
    ...rootBody,
    event_id: '66666666-6666-4666-8666-666666666666',
  });
  assert.equal(observation.status, 200);
  assert.equal((await observation.json()).inventory_status, 'REVIEW_ONLY');
  assert.equal(journal.getAuthoritySnapshot({
    adapter_id: ADAPTER_ID,
    host_installation_id: INSTALLATION,
    authenticated_account_id: ACCOUNT,
    root_id: ROOT_ID,
    ...authority,
  }).authority_status, 'REVIEW_ONLY');

  const rootReconciliation = journal.verifyRootInventory({
    host_installation_id: INSTALLATION,
    authenticated_account_id: ACCOUNT,
    root_id: ROOT_ID,
  });
  const completenessAttestation = createSignedRootInventoryAttestation({
    adapterId: ADAPTER_ID,
    adapterToken: ADAPTER_TOKEN,
    identity: {
      adapter_id: ADAPTER_ID,
      host_installation_id: INSTALLATION,
      authenticated_account_id: ACCOUNT,
      root_id: ROOT_ID,
    },
    reconciliation: {
      ...rootReconciliation,
      integrity_status: rootReconciliation.integrity_status ?? rootReconciliation.status,
      journal_head_sha256: rootReconciliation.journal_head_sha256 ?? rootReconciliation.head_sha256,
      lifecycle_sequence: rootReconciliation.lifecycle_sequence ?? 0,
      lifecycle_head_sha256: rootReconciliation.lifecycle_head_sha256 ?? '0'.repeat(64),
    },
    snapshotAlignment: 'SHARED_VSS_SNAPSHOT',
    snapshotSha256: DIGEST('test-vss-snapshot'),
    sourceIdentity: {
      status: 'CURRENT_IDENTITIES_VERIFIED',
      manifest_sha256: DIGEST('test-source-manifest'),
      patch_blob_sha: PINNED_PATCH_BUNDLE_SHA256,
      host_handler_blob_sha: PINNED_HOST_HANDLER_GIT_BLOB_SHA,
    },
  });
  const completenessBody = {
    host_installation_id: INSTALLATION,
    authenticated_account_id: ACCOUNT,
    root_id: ROOT_ID,
    attestation: completenessAttestation,
  };
  const invalidAttestation = {
    ...completenessAttestation,
    signature: DIGEST('invalid-proof-signature'),
  };
  const invalidProof = await post('/v1/host-root-inventory/attest', {
    ...completenessBody,
    attestation: invalidAttestation,
  });
  assert.equal(invalidProof.status, 409);
  assert.equal((await invalidProof.json()).error.code, 'HOST_ROOT_INVENTORY_ATTESTATION_SIGNATURE_INVALID');

  const completed = await post('/v1/host-root-inventory/attest', completenessBody);
  assert.equal(completed.status, 200);
  const completedPayload = await completed.json();
  assert.equal(completedPayload.inventory_status, 'AUTHORITATIVE_COMPLETE');
  assert.equal(completedPayload.reconciliation.integrity_status, 'INTEGRITY_OK');
  assert.equal(completedPayload.reconciliation.manifest_sha256, baselinePayload.reconciliation.manifest_sha256);
  const repeatedCompletion = await post('/v1/host-root-inventory/attest', completenessBody);
  assert.equal(repeatedCompletion.status, 200);
  assert.equal((await repeatedCompletion.json()).reconciliation.duplicate, true);
  assert.equal(journal.getAuthoritySnapshot({
    adapter_id: ADAPTER_ID,
    host_installation_id: INSTALLATION,
    authenticated_account_id: ACCOUNT,
    root_id: ROOT_ID,
    ...authority,
  }).status, 'INTEGRITY_OK');

  // A complete VSS scan of a changed manifest must be re-attestable. Core
  // preserves the previous proof chain but grants authority only for sequence 2.
  const changedEntries = [{
    ...rootBody.entries[0],
    sha256: DIGEST('chat-content-after-save'),
  }];
  const changedObservation = await post('/v1/host-root-inventory/observe', {
    ...rootBody,
    event_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    entries: changedEntries,
  });
  assert.equal(changedObservation.status, 200);
  const changedObservationPayload = await changedObservation.json();
  assert.equal(changedObservationPayload.reconciliation.status, 'NON_READY');
  assert.equal(changedObservationPayload.reconciliation.sequence, 2);
  assert.equal(journal.getAuthoritySnapshot({
    adapter_id: ADAPTER_ID,
    host_installation_id: INSTALLATION,
    authenticated_account_id: ACCOUNT,
    root_id: ROOT_ID,
    ...authority,
  }).authority_status, 'REVIEW_ONLY');

  const refreshedProof = {
    ...completenessProof,
    event_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    root_inventory_sequence: 2,
    manifest_sha256: changedObservationPayload.reconciliation.manifest_sha256,
  };
  const refreshedSignature = createHmac('sha256', ADAPTER_TOKEN)
    .update(canonical(refreshedProof), 'utf8').digest('hex');
  const refreshed = await post('/v1/host-root-inventory/attest', {
    ...completenessBody,
    proof: refreshedProof,
    proof_signature: refreshedSignature,
  });
  assert.equal(refreshed.status, 200);
  const refreshedPayload = await refreshed.json();
  assert.equal(refreshedPayload.inventory_status, 'AUTHORITATIVE_COMPLETE');
  assert.equal(refreshedPayload.reconciliation.sequence, 2);
  assert.equal(refreshedPayload.reconciliation.completeness_sequence, 2);
  assert.equal(journal.getAuthoritySnapshot({
    adapter_id: ADAPTER_ID,
    host_installation_id: INSTALLATION,
    authenticated_account_id: ACCOUNT,
    root_id: ROOT_ID,
    ...authority,
  }).status, 'INTEGRITY_OK');

  const changedSourceProof = {
    ...refreshedProof,
    event_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    source_files_sha256: DIGEST('changed-pinned-source'),
  };
  const changedSourceSignature = createHmac('sha256', ADAPTER_TOKEN)
    .update(canonical(changedSourceProof), 'utf8').digest('hex');
  const sourceDrift = await post('/v1/host-root-inventory/attest', {
    ...completenessBody,
    proof: changedSourceProof,
    proof_signature: changedSourceSignature,
  });
  assert.equal(sourceDrift.status, 409);
  assert.equal((await sourceDrift.json()).error.code, 'HOST_ROOT_INVENTORY_COMPLETENESS_SOURCE_CHANGED');

  const prepared = {
    host_installation_id: INSTALLATION,
    authenticated_account_id: ACCOUNT,
    host_session_id: SESSION,
    conversation_uuid: CONVERSATION,
    event_id: '77777777-7777-4777-8777-777777777777',
    event_type: 'MUTATION_PREPARED',
    mutation_id: '88888888-8888-4888-8888-888888888888',
    operation: 'edit-message',
    mutation_digest: DIGEST('prepared-mutation'),
    occurred_at: '2026-11-02T00:00:00.000Z',
  };
  const preparedResponse = await post('/v1/host-lifecycle/events', prepared);
  assert.equal(preparedResponse.status, 201);
  assert.equal((await preparedResponse.json()).lifecycle.status, 'appended');

  const statusUrl = new URL(base + '/v1/host-lifecycle/status');
  statusUrl.searchParams.set('host_installation_id', INSTALLATION);
  statusUrl.searchParams.set('authenticated_account_id', ACCOUNT);
  statusUrl.searchParams.set('host_session_id', SESSION);
  statusUrl.searchParams.set('conversation_uuid', CONVERSATION);
  const pendingStatus = await fetch(statusUrl, { headers: {
    authorization: 'Bearer ' + API_TOKEN,
    'x-adapter-id': ADAPTER_ID,
    'x-adapter-token': ADAPTER_TOKEN,
  } });
  assert.equal(pendingStatus.status, 200);
  assert.equal((await pendingStatus.json()).lifecycle.status, 'PENDING_MUTATION');

  const committed = {
    ...prepared,
    event_id: '99999999-9999-4999-8999-999999999999',
    event_type: 'MUTATION_COMMITTED',
    receipt_digest: DIGEST('durable-mutation-receipt'),
    occurred_at: '2026-11-02T00:00:01.000Z',
  };
  const lifecycleIdentity = resolveJournalIdentity({
    adapterId: ADAPTER_ID,
    host_installation_id: INSTALLATION,
    authenticated_account_id: ACCOUNT,
    host_session_id: SESSION,
    conversation_uuid: CONVERSATION,
  });
  committed.receipt_signature = receiptSignature(committed, lifecycleIdentity);
  const committedResponse = await post('/v1/host-lifecycle/events', committed);
  assert.equal(committedResponse.status, 201);
  assert.equal((await committedResponse.json()).lifecycle.status, 'appended');

  const finalStatus = await fetch(statusUrl, { headers: {
    authorization: 'Bearer ' + API_TOKEN,
    'x-adapter-id': ADAPTER_ID,
    'x-adapter-token': ADAPTER_TOKEN,
  } });
  assert.equal(finalStatus.status, 200);
  assert.equal((await finalStatus.json()).lifecycle.status, 'NO_PENDING_MUTATION');

  const wrongAccountStatusUrl = new URL(statusUrl);
  wrongAccountStatusUrl.searchParams.set('authenticated_account_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  const wrongAccountStatus = await fetch(wrongAccountStatusUrl, { headers: {
    authorization: 'Bearer ' + API_TOKEN,
    'x-adapter-id': ADAPTER_ID,
    'x-adapter-token': ADAPTER_TOKEN,
  } });
  assert.equal(wrongAccountStatus.status, 403);
  assert.equal((await wrongAccountStatus.json()).error.code, 'HOST_LIFECYCLE_NOT_AUTHORIZED');

  const changedManifest = await post('/v1/host-root-inventory/observe', {
    ...rootBody,
    event_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    entries: [{
      path: 'chats/main.jsonl',
      identity: { dev: '1', ino: '101', mode: 33188, size: 65, mtimeMs: 2, ctimeMs: 2 },
      sha256: DIGEST('changed-chat-content'),
    }],
  });
  assert.equal(changedManifest.status, 409);
  assert.equal((await changedManifest.json()).inventory_status, 'NON_READY');
  assert.equal(journal.getAuthoritySnapshot({
    adapter_id: ADAPTER_ID,
    host_installation_id: INSTALLATION,
    authenticated_account_id: ACCOUNT,
    root_id: ROOT_ID,
    ...authority,
  }).authority_status, 'REVIEW_ONLY');

  journal.close();
  journal = new HostLifecycleJournal({
    path: join(directory, 'host-lifecycle.sqlite'),
    coordinatorPath,
    resolveIdentity: resolveJournalIdentity,
    resolveRootIdentity: input => resolveRegisteredHostRootIdentity(registry, input),
    verifyMutationReceipt: ({ event, identity }) => event.receipt_signature === receiptSignature(event, identity),
    verifyCompletenessProof: ({ proof, proof_signature }) => proof_signature === createHmac('sha256', ADAPTER_TOKEN)
      .update(canonical(proof), 'utf8').digest('hex'),
  });
  journal.setAuthorityGeneration(AUTHORITY_ID, AUTHORITY_GENERATION);
  assert.equal(journal.verifyRootInventory({
    host_installation_id: INSTALLATION,
    authenticated_account_id: ACCOUNT,
    root_id: ROOT_ID,
  }).status, 'INTEGRITY_OK');
  assert.equal(journal.getAuthoritySnapshot({
    adapter_id: ADAPTER_ID,
    host_installation_id: INSTALLATION,
    authenticated_account_id: ACCOUNT,
    root_id: ROOT_ID,
    ...authority,
  }).authority_status, 'REVIEW_ONLY');
});
