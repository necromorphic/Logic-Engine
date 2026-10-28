import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  fetchVerifiedRemoteAnchorHead,
  verifyRemoteAnchorEnvelope,
} from '../src/security/remote-accepted-head-client.js';

const installationId = 'install-test-01';
const epochId = 'epoch-01';
const coreDigest = 'a'.repeat(64);
const providerDigest = 'b'.repeat(64);
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

function makeEnvelope(overrides = {}) {
  const record = {
    installation_id: installationId,
    epoch_id: epochId,
    key_id: 'key-01',
    sequence: 1,
    previous_record_digest: null,
    core_head_digest: coreDigest,
    provider_readiness_digest: providerDigest,
    contract_version: 1,
    record_type: 'ADVANCE',
    recovery_reason: null,
    ...overrides,
  };
  const bytes = Buffer.from(JSON.stringify({
    installation_id: record.installation_id,
    epoch_id: record.epoch_id,
    key_id: record.key_id,
    sequence: record.sequence,
    previous_record_digest: record.previous_record_digest,
    core_head_digest: record.core_head_digest,
    provider_readiness_digest: record.provider_readiness_digest,
    contract_version: record.contract_version,
    record_type: record.record_type,
    recovery_reason: record.recovery_reason,
  }));
  return {
    record,
    signature: sign(null, bytes, privateKey).toString('base64url'),
  };
}

test('verifies a signed current head and returns a frozen normalized result', () => {
  const result = verifyRemoteAnchorEnvelope({
    envelope: makeEnvelope(),
    installationId,
    publicKey: publicPem,
  });
  assert.equal(result.installationId, installationId);
  assert.equal(result.sequence, 1);
  assert.equal(result.keyId, 'key-01');
  assert.equal(result.contractVersion, 1);
  assert.equal(result.recoveryReason, null);
  assert.equal(result.coreHeadDigest, coreDigest);
  assert.equal(result.providerReadinessDigest, providerDigest);
  assert.equal(result.recordType, 'ADVANCE');
  assert.match(result.recordDigest, /^[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(result), true);
});

test('rejects altered records, bad signatures, and wrong installation identity', () => {
  const envelope = makeEnvelope();
  assert.throws(() => verifyRemoteAnchorEnvelope({
    envelope: { ...envelope, record: { ...envelope.record, core_head_digest: 'c'.repeat(64) } },
    installationId,
    publicKey: publicPem,
  }), /REMOTE_ANCHOR_SIGNATURE_INVALID/);
  assert.throws(() => verifyRemoteAnchorEnvelope({
    envelope,
    installationId: 'another-installation',
    publicKey: publicPem,
  }), /REMOTE_ANCHOR_IDENTITY_MISMATCH/);
  assert.throws(() => verifyRemoteAnchorEnvelope({
    envelope: { ...envelope, signature: Buffer.alloc(64).toString('base64url') },
    installationId,
    publicKey: publicPem,
  }), /REMOTE_ANCHOR_SIGNATURE_INVALID/);
});

test('requires an explicit recovery reason for recovery records', () => {
  const envelope = makeEnvelope({ record_type: 'RECOVERY', recovery_reason: 'operator-approved restore' });
  const result = verifyRemoteAnchorEnvelope({ envelope, installationId, publicKey: publicPem });
  assert.equal(result.recordType, 'RECOVERY');
  assert.equal(result.recoveryReason, 'operator-approved restore');
  assert.throws(() => verifyRemoteAnchorEnvelope({
    envelope: makeEnvelope({ record_type: 'RECOVERY', recovery_reason: null }),
    installationId,
    publicKey: publicPem,
  }), /REMOTE_ANCHOR_RECOVERY_REASON_INVALID/);
});

test('rejects unknown fields, invalid chain metadata, and sequence rollback', () => {
  const envelope = makeEnvelope();
  assert.throws(() => verifyRemoteAnchorEnvelope({
    envelope: { ...envelope, record: { ...envelope.record, trusted: true } },
    installationId,
    publicKey: publicPem,
  }), /REMOTE_ANCHOR_RECORD_FIELDS_INVALID/);
  assert.throws(() => verifyRemoteAnchorEnvelope({
    envelope: makeEnvelope({ sequence: 2 }),
    installationId,
    publicKey: publicPem,
  }), /REMOTE_ANCHOR_CHAIN_INVALID/);
  assert.throws(() => verifyRemoteAnchorEnvelope({
    envelope,
    installationId,
    publicKey: publicPem,
    minimumSequence: 2,
  }), /REMOTE_ANCHOR_ROLLBACK_DETECTED/);
});

test('fetch client requires HTTPS and fails closed on HTTP, invalid response, and oversized body', async () => {
  const common = {
    installationId,
    serviceToken: 'x'.repeat(40),
    publicKey: publicPem,
    fetchImpl: async () => new Response(JSON.stringify(makeEnvelope()), { status: 200 }),
  };
  await assert.rejects(() => fetchVerifiedRemoteAnchorHead({
    ...common, endpoint: 'http://anchor.example',
  }), /Invalid remote anchor client configuration/);

  await assert.rejects(() => fetchVerifiedRemoteAnchorHead({
    ...common, endpoint: 'https://anchor.example', fetchImpl: async () => new Response('', { status: 503 }),
  }), /REMOTE_ANCHOR_UNAVAILABLE/);

  await assert.rejects(() => fetchVerifiedRemoteAnchorHead({
    ...common, endpoint: 'https://anchor.example', fetchImpl: async () => new Response('not json', { status: 200 }),
  }), /REMOTE_ANCHOR_RESPONSE_INVALID/);

  await assert.rejects(() => fetchVerifiedRemoteAnchorHead({
    ...common, endpoint: 'https://anchor.example', fetchImpl: async () => new Response('x'.repeat(16385), { status: 200 }),
  }), /REMOTE_ANCHOR_RESPONSE_TOO_LARGE/);
});

test('fetch client uses bearer auth and verifies returned signature', async () => {
  let requestedUrl;
  let requestedOptions;
  const result = await fetchVerifiedRemoteAnchorHead({
    endpoint: 'https://anchor.example/base/',
    installationId,
    serviceToken: 's'.repeat(40),
    publicKey: publicPem,
    fetchImpl: async (url, options) => {
      requestedUrl = url;
      requestedOptions = options;
      return new Response(JSON.stringify(makeEnvelope()), { status: 200 });
    },
  });
  assert.equal(requestedUrl.href, 'https://anchor.example/base/v1/installations/install-test-01/head');
  assert.equal(requestedOptions.headers.authorization, 'Bearer ' + 's'.repeat(40));
  assert.equal(requestedOptions.redirect, 'error');
  assert.equal(result.sequence, 1);
});
