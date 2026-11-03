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
  const resolveRootIdentity = input => input.host_installation_id === INSTALLATION
    && input.authenticated_account_id === ACCOUNT && input.root_id === ROOT_ID
    ? {
      authorized: true, adapter_id: ADAPTER_ID,
      host_installation_id: INSTALLATION, authenticated_account_id: ACCOUNT, root_id: ROOT_ID,
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
    }),
    resolveRootIdentity,
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
    patch_blob_sha: '8983c17e99290f468abbaad957060fee58e4d4a55de3471f3947a5c4a087723e',
    host_handler_blob_sha: 'bbba9e5579ac4700dc07ff5d0a15428d2c303802',
    source_identity_status: 'CURRENT_IDENTITIES_VERIFIED',
    snapshot_alignment: 'SHARED_VSS_SNAPSHOT',
    snapshot_sha256: digest('vss-snapshot'),
    lifecycle_sequence: baselinePayload.reconciliation.lifecycle_sequence,
    lifecycle_head_sha256: baselinePayload.reconciliation.lifecycle_head_sha256,
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

  const replay = await post(base, '/v1/host-root-inventory/attest', { ...identity, attestation });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).reconciliation.duplicate, true);

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

});
