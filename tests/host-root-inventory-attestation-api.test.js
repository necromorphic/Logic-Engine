import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash, createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { HostLifecycleJournal } from '../src/application/host-lifecycle-journal.js';
import { createApiServer } from '../src/api/server.js';

const API_TOKEN = 'host-root-api-token-long-enough';
const ADAPTER_TOKEN = 'host-root-adapter-token-long-enough';
const ADAPTER_ID = 'st-host-adapter';
const INSTALLATION = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '22222222-2222-4222-8222-222222222222';
const ROOT_ID = createHash('sha256').update('host-root-test').digest('hex');
const AUTHORITY_ID = 'host-root-test-authority';
const AUTHORITY_GENERATION = 1;
const digest = value => createHash('sha256').update(value).digest('hex');
const SOURCE_MANIFEST_SHA256 = digest('pinned-source-manifest');
let trustedSourceManifestSha256 = SOURCE_MANIFEST_SHA256;
const canonical = value => value && typeof value === 'object'
  ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
  : JSON.stringify(value);
const sign = attestation => {
  const { signature: _signature, ...proof } = attestation;
  return createHmac('sha256', ADAPTER_TOKEN).update(canonical(proof), 'utf8').digest('hex');
};
const post = (base, pathname, body) => fetch(base + pathname, {
  method: 'POST',
  headers: {
    authorization: 'Bearer ' + API_TOKEN,
    'x-adapter-id': ADAPTER_ID,
    'x-adapter-token': ADAPTER_TOKEN,
    'content-type': 'application/json',
  },
  body: JSON.stringify(body),
});

test('Core HTTP accepts only a signed, pinned, lifecycle-complete root attestation', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'host-root-attestation-api-'));
  const corePath = join(directory, 'core.sqlite');
  const coordinatorPath = resolve(join(directory, 'coordinator.sqlite'));
  const store = new SQLiteStore(corePath);
  const engine = new LogicEngine(store);
  const resolveHostRootIdentity = input => input.host_installation_id === INSTALLATION
    && input.authenticated_account_id === ACCOUNT && input.root_id === ROOT_ID
    ? {
      authorized: true, adapter_id: ADAPTER_ID,
      host_installation_id: INSTALLATION, authenticated_account_id: ACCOUNT, root_id: ROOT_ID,
      source_manifest_sha256: trustedSourceManifestSha256,
    } : { authorized: false };
  const journal = new HostLifecycleJournal({
    path: join(directory, 'host-lifecycle.sqlite'),
    coordinatorPath,
    resolveIdentity: input => ({
      authorized: true, adapter_id: ADAPTER_ID,
      host_installation_id: input.host_installation_id,
      authenticated_account_id: input.authenticated_account_id,
      host_session_id: input.host_session_id,
      conversation_uuid: input.conversation_uuid,
      authority_id: AUTHORITY_ID,
      generation: AUTHORITY_GENERATION,
      root_id: ROOT_ID,
      snapshot_fingerprint: journal.getAuthoritySnapshot({
        authority_id: AUTHORITY_ID,
        generation: AUTHORITY_GENERATION,
        adapter_id: ADAPTER_ID,
        host_installation_id: input.host_installation_id,
        authenticated_account_id: input.authenticated_account_id,
        root_id: ROOT_ID,
      }).snapshot_fingerprint,
    }),
    resolveRootIdentity: resolveHostRootIdentity,
    verifyRootInventoryAttestation: ({ attestation, identity }) => {
      if (identity.adapter_id !== ADAPTER_ID) return false;
      return attestation.signature === sign(attestation);
    },
  });
  const server = createApiServer({
    engine,
    token: API_TOKEN,
    adapterTokens: { [ADAPTER_ID]: ADAPTER_TOKEN },
    hostRootInventoryJournal: journal,
    resolveHostRootIdentity,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    journal.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const base = 'http://127.0.0.1:' + server.address().port;
  const identity = {
    host_installation_id: INSTALLATION,
    authenticated_account_id: ACCOUNT,
    root_id: ROOT_ID,
  };
  const entries = [{
    path: 'chats/main.jsonl',
    identity: { dev: '1', ino: '101', mode: 33188, size: 64, mtimeMs: 1, ctimeMs: 1 },
    sha256: digest('chat-file'),
  }];
  const baselineResponse = await post(base, '/v1/host-root-inventory/baseline', {
    ...identity, event_id: '55555555-5555-4555-8555-555555555555', entries,
  });
  assert.equal(baselineResponse.status, 200);
  const baselinePayload = await baselineResponse.json();
  assert.equal(baselinePayload.inventory_status, 'REVIEW_ONLY');
  assert.equal(baselinePayload.reconciliation.integrity_status, 'INTEGRITY_OK');

  const lifecycleEvent = journal.append({
    event_id: '77777777-7777-4777-8777-777777777777',
    host_installation_id: INSTALLATION,
    authenticated_account_id: ACCOUNT,
    host_session_id: '88888888-8888-4888-8888-888888888888',
    conversation_uuid: '99999999-9999-4999-8999-999999999999',
    authority_id: AUTHORITY_ID,
    generation: AUTHORITY_GENERATION,
    snapshot_fingerprint: journal.getAuthoritySnapshot({
      authority_id: AUTHORITY_ID,
      generation: AUTHORITY_GENERATION,
      adapter_id: ADAPTER_ID,
      host_installation_id: INSTALLATION,
      authenticated_account_id: ACCOUNT,
      root_id: ROOT_ID,
    }).snapshot_fingerprint,
    occurred_at: new Date().toISOString(),
    event_type: 'VERSION_CREATED',
    message_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    version_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    parent_version_id: null,
    payload_sha256: digest('first-lifecycle-version'),
    active: true,
  });
  assert.equal(lifecycleEvent.sequence, 1);

  const attestation = {
    protocol_version: 1,
    adapter_id: ADAPTER_ID,
    ...identity,
    inventory_sequence: baselinePayload.reconciliation.sequence,
    manifest_sha256: baselinePayload.reconciliation.manifest_sha256,
    inventory_head_sha256: baselinePayload.reconciliation.journal_head_sha256,
    covered_delta_sha256: null,
    coverage_id: 'ST-1.19.0-HOST-LIFECYCLE-P0-V1',
    pinned_host_commit: '06bde939fb1e9c4c8d8641d810f0a916b5bce127',
    patch_blob_sha: '35ae74285a99fc802ee5442dc9000671233967f7d74d169b2ba106c6d991f256',
    host_handler_blob_sha: 'dea9ad6acf7aa7c4bfa04f25a90aeb0db9e242a6',
    source_identity_status: 'CURRENT_IDENTITIES_VERIFIED',
    source_manifest_sha256: SOURCE_MANIFEST_SHA256,
    snapshot_alignment: 'SHARED_VSS_SNAPSHOT',
    snapshot_sha256: digest('vss-snapshot'),
    lifecycle_sequence: lifecycleEvent.sequence,
    lifecycle_head_sha256: lifecycleEvent.event_sha256,
    issued_at: Math.floor(Date.now() / 1000),
    nonce: '66666666-6666-4666-8666-666666666666',
    signature: '',
  };
  attestation.signature = sign(attestation);

  const invalid = await post(base, '/v1/host-root-inventory/attest', {
    ...identity, attestation: { ...attestation, signature: '0'.repeat(64) },
  });
  assert.equal(invalid.status, 409);
  assert.equal((await invalid.json()).error.code, 'HOST_ROOT_INVENTORY_ATTESTATION_SIGNATURE_INVALID');

  const accepted = await post(base, '/v1/host-root-inventory/attest', { ...identity, attestation });
  assert.equal(accepted.status, 200);
  const acceptedPayload = await accepted.json();
  assert.equal(acceptedPayload.inventory_status, 'AUTHORITATIVE_COMPLETE');
  assert.equal(acceptedPayload.reconciliation.status, 'AUTHORITATIVE_COMPLETE');
  assert.equal(acceptedPayload.reconciliation.integrity_status, 'INTEGRITY_OK');
  assert.equal(acceptedPayload.reconciliation.source_manifest_sha256, digest('pinned-source-manifest'));

  const replay = await post(base, '/v1/host-root-inventory/attest', { ...identity, attestation });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).reconciliation.duplicate, true);

  // Rotating the deployment pin invalidates the previously accepted proof
  // immediately, even before a new inventory observation is appended.
  trustedSourceManifestSha256 = digest('rotated-source-manifest-pin');
  const stalePinSnapshot = journal.getAuthoritySnapshot({
    authority_id: AUTHORITY_ID,
    generation: AUTHORITY_GENERATION,
    adapter_id: ADAPTER_ID,
    host_installation_id: INSTALLATION,
    authenticated_account_id: ACCOUNT,
    root_id: ROOT_ID,
  });
  assert.equal(stalePinSnapshot.authority_status, 'REVIEW_ONLY');
  trustedSourceManifestSha256 = SOURCE_MANIFEST_SHA256;

  // The Core deployment registry pins the exact accepted source manifest.
  // A self-consistent replacement manifest must not be able to re-authorize
  // the same Host installation without an explicit deployment config update.
  const unapprovedSourceManifestSha256 = digest('unapproved-source-manifest');
  const refreshResponse = await post(base, '/v1/host-root-inventory/observe', {
    ...identity,
    event_id: '77777777-7777-4777-8777-777777777777',
    entries,
    source_manifest_sha256: unapprovedSourceManifestSha256,
  });
  assert.equal(refreshResponse.status, 409);
  const refreshPayload = await refreshResponse.json();
  const refreshed = refreshPayload.reconciliation;
  assert.equal(refreshed.status, 'NON_READY');
  assert.equal(refreshed.reason, 'HOST_ROOT_INVENTORY_ATTESTATION_REFRESH_REQUIRED');
  assert.equal(refreshed.sequence, baselinePayload.reconciliation.sequence + 1);
  assert.equal(Object.values(refreshed.counts).reduce((sum, count) => sum + count, 0), 0);

  const forgedRefreshAttestation = {
    ...attestation,
    inventory_sequence: refreshed.sequence,
    manifest_sha256: refreshed.manifest_sha256,
    inventory_head_sha256: refreshed.journal_head_sha256,
    covered_delta_sha256: refreshed.delta_sha256,
    source_manifest_sha256: unapprovedSourceManifestSha256,
    lifecycle_sequence: refreshed.lifecycle_sequence,
    lifecycle_head_sha256: refreshed.lifecycle_head_sha256,
    issued_at: Math.floor(Date.now() / 1000),
    nonce: '88888888-8888-4888-8888-888888888888',
    signature: '',
  };
  forgedRefreshAttestation.signature = sign(forgedRefreshAttestation);
  const forgedRefresh = await post(base, '/v1/host-root-inventory/attest', {
    ...identity, attestation: forgedRefreshAttestation,
  });
  assert.equal(forgedRefresh.status, 409);
  assert.equal((await forgedRefresh.json()).error.code, 'HOST_ROOT_INVENTORY_ATTESTATION_INVALID');

  // A reviewed deployment explicitly updates the Core registry pin. Only
  // after that trust-anchor change may the new source manifest be accepted.
  trustedSourceManifestSha256 = unapprovedSourceManifestSha256;
  const approvedRefresh = await post(base, '/v1/host-root-inventory/attest', {
    ...identity, attestation: forgedRefreshAttestation,
  });
  assert.equal(approvedRefresh.status, 200);
  assert.equal((await approvedRefresh.json()).inventory_status, 'AUTHORITATIVE_COMPLETE');

  const snapshot = journal.getAuthoritySnapshot({
    authority_id: AUTHORITY_ID,
    generation: AUTHORITY_GENERATION,
    adapter_id: ADAPTER_ID,
    host_installation_id: INSTALLATION,
    authenticated_account_id: ACCOUNT,
    root_id: ROOT_ID,
  });
  assert.equal(snapshot.status, 'INTEGRITY_OK');
  assert.equal(snapshot.authority_status, 'AUTHORITATIVE_COMPLETE');
  assert.equal(snapshot.source_manifest_sha256, unapprovedSourceManifestSha256);

});
