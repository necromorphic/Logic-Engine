import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSignedRootInventoryAttestation,
  verifySignedRootInventoryAttestation,
  PINNED_PATCH_BUNDLE_SHA256,
  PINNED_HOST_HANDLER_GIT_BLOB_SHA,
} from '../server-plugin/st-source-attestation.mjs';

const token = 'deployment-adapter-token-at-least-16';
const identity = Object.freeze({
  adapter_id: 'st-host-adapter',
  host_installation_id: '11111111-1111-4111-8111-111111111111',
  authenticated_account_id: '22222222-2222-4222-8222-222222222222',
  root_id: 'a'.repeat(64),
});
const sourceIdentity = Object.freeze({
  status: 'CURRENT_IDENTITIES_VERIFIED',
  manifest_sha256: 'b'.repeat(64),
  patch_blob_sha: PINNED_PATCH_BUNDLE_SHA256,
  host_handler_blob_sha: PINNED_HOST_HANDLER_GIT_BLOB_SHA,
});
const reconciliation = Object.freeze({
  integrity_status: 'INTEGRITY_OK',
  sequence: 1,
  manifest_sha256: 'c'.repeat(64),
  journal_head_sha256: 'd'.repeat(64),
  lifecycle_sequence: 1,
  lifecycle_head_sha256: 'e'.repeat(64),
});

function issue() {
  return createSignedRootInventoryAttestation({
    adapterId: identity.adapter_id,
    adapterToken: token,
    identity,
    reconciliation,
    snapshotAlignment: 'SHARED_VSS_SNAPSHOT',
    snapshotSha256: 'f'.repeat(64),
    sourceIdentity,
    now: () => 1_800_000_000_000,
    createNonce: () => '33333333-3333-4333-8333-333333333333',
  });
}

test('Host root attestation verifier accepts the exact signed deployment identity', () => {
  const attestation = issue();
  assert.equal(verifySignedRootInventoryAttestation({
    attestation, identity, adapterToken: token,
  }), true);
});

test('Host root attestation verifier rejects tampering and identity substitution', () => {
  const attestation = issue();
  assert.equal(verifySignedRootInventoryAttestation({
    attestation: { ...attestation, snapshot_sha256: '9'.repeat(64) },
    identity,
    adapterToken: token,
  }), false);
  assert.equal(verifySignedRootInventoryAttestation({
    attestation,
    identity: { ...identity, authenticated_account_id: '44444444-4444-4444-8444-444444444444' },
    adapterToken: token,
  }), false);
  assert.equal(verifySignedRootInventoryAttestation({
    attestation,
    identity,
    adapterToken: 'different-deployment-adapter-token',
  }), false);
});

test('Host root attestation verifier rejects accessors and malformed signatures', () => {
  const attestation = issue();
  const accessor = { ...attestation };
  Object.defineProperty(accessor, 'signature', {
    enumerable: true,
    get() { throw new Error('must not execute'); },
  });
  assert.equal(verifySignedRootInventoryAttestation({
    attestation: accessor, identity, adapterToken: token,
  }), false);
  assert.equal(verifySignedRootInventoryAttestation({
    attestation: { ...attestation, signature: 'not-a-signature' },
    identity,
    adapterToken: token,
  }), false);
});
