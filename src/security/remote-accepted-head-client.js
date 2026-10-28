import { createHash, verify as verifySignature } from 'node:crypto';

const RECORD_KEYS = [
  'installation_id',
  'epoch_id',
  'key_id',
  'sequence',
  'previous_record_digest',
  'core_head_digest',
  'provider_readiness_digest',
  'contract_version',
  'record_type',
  'recovery_reason',
];
const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;

function fail(code) {
  throw new Error(code);
}

function validId(value) {
  return typeof value === 'string' && ID.test(value);
}

function canonicalRecord(record) {
  // Fixed field order is the wire-level signing contract. Do not sign arbitrary
  // JSON property order or accept unknown fields.
  return JSON.stringify({
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
  });
}

function validateRecord(record, expectedInstallationId) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) fail('REMOTE_ANCHOR_RECORD_INVALID');
  const keys = Object.keys(record).sort();
  if (keys.length !== RECORD_KEYS.length || keys.some((key, index) => key !== [...RECORD_KEYS].sort()[index])) {
    fail('REMOTE_ANCHOR_RECORD_FIELDS_INVALID');
  }
  if (!validId(record.installation_id) || record.installation_id !== expectedInstallationId
    || !validId(record.epoch_id) || !validId(record.key_id)) fail('REMOTE_ANCHOR_IDENTITY_MISMATCH');
  if (!Number.isSafeInteger(record.sequence) || record.sequence < 1) fail('REMOTE_ANCHOR_SEQUENCE_INVALID');
  if (!Number.isSafeInteger(record.contract_version) || record.contract_version < 1) {
    fail('REMOTE_ANCHOR_CONTRACT_VERSION_INVALID');
  }
  if (record.sequence === 1) {
    if (record.previous_record_digest !== null) fail('REMOTE_ANCHOR_CHAIN_INVALID');
  } else if (typeof record.previous_record_digest !== 'string' || !DIGEST.test(record.previous_record_digest)) {
    fail('REMOTE_ANCHOR_CHAIN_INVALID');
  }
  if (typeof record.core_head_digest !== 'string' || !DIGEST.test(record.core_head_digest)
    || typeof record.provider_readiness_digest !== 'string' || !DIGEST.test(record.provider_readiness_digest)) {
    fail('REMOTE_ANCHOR_DIGEST_INVALID');
  }
  if (!['ADVANCE', 'RECOVERY', 'REENROLL'].includes(record.record_type)) fail('REMOTE_ANCHOR_RECORD_TYPE_INVALID');
  if (record.record_type === 'RECOVERY') {
    if (typeof record.recovery_reason !== 'string' || record.recovery_reason.trim().length < 1
      || record.recovery_reason.length > 256 || /[\x00-\x1f\x7f]/.test(record.recovery_reason)) {
      fail('REMOTE_ANCHOR_RECOVERY_REASON_INVALID');
    }
  } else if (record.recovery_reason !== null) {
    fail('REMOTE_ANCHOR_RECOVERY_REASON_INVALID');
  }
}

function decodeSignature(signature) {
  if (typeof signature !== 'string' || !/^[A-Za-z0-9_-]{80,100}$/.test(signature)) {
    fail('REMOTE_ANCHOR_SIGNATURE_INVALID');
  }
  return Buffer.from(signature, 'base64url');
}

async function readBoundedBody(response, maxBytes) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    fail('REMOTE_ANCHOR_RESPONSE_INVALID');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch {}
        fail('REMOTE_ANCHOR_RESPONSE_TOO_LARGE');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

/**
 * Verify one signed remote accepted-head record.
 *
 * This verifies record integrity and issuer identity only. It does not prove
 * that the remote service's own history cannot be rolled back; that property
 * must be guaranteed and tested by the remote authority deployment.
 */
export function verifyRemoteAnchorEnvelope({
  envelope,
  installationId,
  publicKey,
  minimumSequence = 0,
}) {
  if (!validId(installationId) || typeof publicKey !== 'string' || !publicKey.includes('PUBLIC KEY')
    || !Number.isSafeInteger(minimumSequence) || minimumSequence < 0) {
    throw new TypeError('Invalid remote anchor verifier configuration.');
  }
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)
    || Object.keys(envelope).sort().join(',') !== 'record,signature') {
    fail('REMOTE_ANCHOR_ENVELOPE_INVALID');
  }
  const { record, signature } = envelope;
  validateRecord(record, installationId);
  if (record.sequence < minimumSequence) fail('REMOTE_ANCHOR_ROLLBACK_DETECTED');

  const bytes = Buffer.from(canonicalRecord(record), 'utf8');
  const signatureBytes = decodeSignature(signature);
  let valid = false;
  try {
    valid = verifySignature(null, bytes, publicKey, signatureBytes);
  } catch {
    fail('REMOTE_ANCHOR_KEY_INVALID');
  }
  if (!valid) fail('REMOTE_ANCHOR_SIGNATURE_INVALID');

  return Object.freeze({
    installationId: record.installation_id,
    epochId: record.epoch_id,
    keyId: record.key_id,
    sequence: record.sequence,
    contractVersion: record.contract_version,
    recoveryReason: record.recovery_reason,
    previousRecordDigest: record.previous_record_digest,
    coreHeadDigest: record.core_head_digest,
    providerReadinessDigest: record.provider_readiness_digest,
    recordType: record.record_type,
    recordDigest: createHash('sha256').update(bytes).digest('hex'),
  });
}

/**
 * Fetch and verify the current remote anchor head. HTTPS is mandatory. The
 * service token authenticates the installation to the service; the pinned
 * Ed25519 public key independently authenticates the returned record.
 */
export async function fetchVerifiedRemoteAnchorHead({
  endpoint,
  installationId,
  serviceToken,
  publicKey,
  minimumSequence = 0,
  timeoutMs = 3000,
  fetchImpl = globalThis.fetch,
}) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new TypeError('Invalid remote anchor endpoint.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash
    || !validId(installationId) || typeof serviceToken !== 'string'
    || serviceToken.length < 32 || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10000
    || typeof fetchImpl !== 'function') {
    throw new TypeError('Invalid remote anchor client configuration.');
  }

  url.pathname = url.pathname.replace(/\/$/, '') + '/v1/installations/' + encodeURIComponent(installationId) + '/head';
  url.search = '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        authorization: 'Bearer ' + serviceToken,
        accept: 'application/json',
        'cache-control': 'no-store',
      },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response || response.status !== 200) fail('REMOTE_ANCHOR_UNAVAILABLE');
    const declaredLength = response.headers?.get?.('content-length');
    if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > 16384)) {
      fail('REMOTE_ANCHOR_RESPONSE_TOO_LARGE');
    }
    const raw = await readBoundedBody(response, 16384);
    let envelope;
    try {
      envelope = JSON.parse(raw);
    } catch {
      fail('REMOTE_ANCHOR_RESPONSE_INVALID');
    }
    return verifyRemoteAnchorEnvelope({ envelope, installationId, publicKey, minimumSequence });
  } catch (error) {
    if (error?.message?.startsWith('REMOTE_ANCHOR_')) throw error;
    throw new Error('REMOTE_ANCHOR_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
  }
}
