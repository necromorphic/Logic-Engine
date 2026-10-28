import { createHash, createPrivateKey, createPublicKey, sign, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import {
  serializeRemoteAnchorRecord,
  verifyRemoteAnchorEnvelope,
} from './remote-accepted-head-client.js';

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const MAX_BODY_BYTES = 4096;

function fail(status, code) {
  const error = new Error(code);
  error.status = status;
  throw error;
}

function validId(value) {
  return typeof value === 'string' && ID.test(value);
}

function sameSecret(expected, received) {
  if (typeof expected !== 'string' || expected.length < 32 || typeof received !== 'string') return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(received, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function reply(response, status, body) {
  const bytes = Buffer.from(JSON.stringify(body), 'utf8');
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': bytes.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(bytes);
}

async function readJsonBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) fail(413, 'BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks, total).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'REQUEST_INVALID');
    return value;
  } catch (error) {
    if (error?.status) throw error;
    fail(400, 'REQUEST_INVALID');
  }
}

function exactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, i) => key === wanted[i]);
}

function getCredentials(credentials, installationId) {
  const entry = credentials[installationId];
  if (!entry || typeof entry !== 'object' || typeof entry.token !== 'string' || entry.token.length < 32) {
    fail(403, 'DENIED');
  }
  return entry;
}

/**
 * Create the remote accepted-head protocol handler.
 *
 * Store contract (mandatory):
 * - getHead(installationId) returns the latest immutable signed envelope or null.
 * - appendIfHead({ installationId, expectedSequence, expectedDigest, envelope })
 *   atomically appends only if the currently stored head still matches both
 *   expected values; returns true on append and false on compare-and-append conflict.
 * - The production store MUST itself be rollback-resistant and append-only.
 *   A normal local/remote SQLite database does not satisfy that requirement.
 *
 * This module provides protocol validation and signing, not the durable store,
 * TLS termination, secret provisioning, deployment, or proof against rollback
 * of the service's own storage.
 */
export function createRemoteAnchorServer({
  store,
  credentials,
  signingPrivateKey,
  epochId,
  keyId,
  contractVersion = 1,
}) {
  if (!store || typeof store.getHead !== 'function' || typeof store.appendIfHead !== 'function'
    || !credentials || typeof credentials !== 'object' || Array.isArray(credentials)
    || !validId(epochId) || !validId(keyId)
    || !Number.isSafeInteger(contractVersion) || contractVersion < 1) {
    throw new TypeError('Invalid remote anchor server configuration.');
  }

  let privateKey;
  try {
    privateKey = typeof signingPrivateKey === 'string' || Buffer.isBuffer(signingPrivateKey)
      ? createPrivateKey(signingPrivateKey)
      : signingPrivateKey;
    if (!privateKey || privateKey.type !== 'private' || privateKey.asymmetricKeyType !== 'ed25519') {
      throw new Error('wrong key type');
    }
  } catch {
    throw new TypeError('Remote anchor signing key must be an Ed25519 private key.');
  }
  const publicKey = createPublicKey(privateKey);
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

  async function readCurrentHead(installationId) {
    const envelope = await store.getHead(installationId);
    if (envelope === null) return null;
    const verified = verifyRemoteAnchorEnvelope({ envelope, installationId, expectedKeyId: keyId, publicKey: publicPem });
    if (envelope.record.sequence < 1 || verified.recordDigest !== createHash('sha256')
      .update(serializeRemoteAnchorRecord(envelope.record), 'utf8').digest('hex')) {
      fail(503, 'ANCHOR_STORE_INVALID');
    }
    return { envelope, verified };
  }

  async function handleHead(response, installationId) {
    const current = await readCurrentHead(installationId);
    if (!current) fail(404, 'ANCHOR_NOT_ENROLLED');
    reply(response, 200, current.envelope);
  }

  async function handleAppend(request, response, installationId, credential) {
    const contentType = request.headers['content-type'];
    if (typeof contentType !== 'string' || !/^application\/json(?:\s*;|$)/i.test(contentType)) {
      fail(415, 'CONTENT_TYPE_INVALID');
    }
    const body = await readJsonBody(request);
    const expectedFields = [
      'expected_sequence',
      'expected_digest',
      'core_head_digest',
      'provider_readiness_digest',
      'contract_version',
      'record_type',
      'recovery_reason',
    ];
    if (!exactKeys(body, expectedFields)
      || !Number.isSafeInteger(body.expected_sequence) || body.expected_sequence < 0
      || !(body.expected_digest === null || (typeof body.expected_digest === 'string' && DIGEST.test(body.expected_digest)))
      || typeof body.core_head_digest !== 'string' || !DIGEST.test(body.core_head_digest)
      || typeof body.provider_readiness_digest !== 'string' || !DIGEST.test(body.provider_readiness_digest)
      || !Number.isSafeInteger(body.contract_version) || body.contract_version !== contractVersion
      || !['ADVANCE', 'RECOVERY'].includes(body.record_type)) {
      fail(400, 'REQUEST_INVALID');
    }
    if (body.record_type === 'RECOVERY' && credential.allowRecovery !== true) fail(403, 'DENIED');
    if (body.record_type === 'RECOVERY') {
      if (typeof body.recovery_reason !== 'string' || body.recovery_reason.trim().length < 1
        || body.recovery_reason.length > 256 || /[\x00-\x1f\x7f]/.test(body.recovery_reason)) {
        fail(400, 'REQUEST_INVALID');
      }
    } else if (body.recovery_reason !== null) {
      fail(400, 'REQUEST_INVALID');
    }

    const current = await readCurrentHead(installationId);
    const currentSequence = current?.verified.sequence ?? 0;
    const currentDigest = current?.verified.recordDigest ?? null;
    if (body.expected_sequence !== currentSequence || body.expected_digest !== currentDigest) {
      fail(409, 'HEAD_CONFLICT');
    }
    if (currentSequence >= Number.MAX_SAFE_INTEGER) fail(503, 'ANCHOR_SEQUENCE_EXHAUSTED');

    const record = {
      installation_id: installationId,
      epoch_id: epochId,
      key_id: keyId,
      sequence: currentSequence + 1,
      previous_record_digest: currentDigest,
      core_head_digest: body.core_head_digest,
      provider_readiness_digest: body.provider_readiness_digest,
      contract_version: body.contract_version,
      record_type: body.record_type,
      recovery_reason: body.recovery_reason,
    };
    const bytes = Buffer.from(serializeRemoteAnchorRecord(record), 'utf8');
    const envelope = { record, signature: sign(null, bytes, privateKey).toString('base64url') };

    // This CAS is the concurrency boundary. A store that implements it as a
    // separate read then write is invalid and must not be used in production.
    const appended = await store.appendIfHead({
      installationId,
      expectedSequence: currentSequence,
      expectedDigest: currentDigest,
      envelope,
    });
    if (appended !== true) fail(409, 'HEAD_CONFLICT');

    // Read back and verify the exact durable result before acknowledging success.
    const saved = await readCurrentHead(installationId);
    if (!saved || saved.verified.recordDigest !== createHash('sha256').update(bytes).digest('hex')) {
      fail(503, 'ANCHOR_STORE_INVALID');
    }
    reply(response, 201, saved.envelope);
  }

  const server = createServer(async (request, response) => {
    response.setTimeout(3000, () => response.destroy());
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    const match = /^\/v1\/installations\/([A-Za-z0-9][A-Za-z0-9._:-]{0,159})\/(head|records)$/.exec(url.pathname);
    if (!match || url.search || request.headers['transfer-encoding'] && request.headers['content-length']) {
      reply(response, 404, { error: 'NOT_FOUND' });
      return;
    }
    const installationId = decodeURIComponent(match[1]);
    let credential;
    try {
      const authorization = request.headers.authorization;
      const received = typeof authorization === 'string' && authorization.startsWith('Bearer ')
        ? authorization.slice(7) : '';
      credential = getCredentials(credentials, installationId);
      if (!sameSecret(credential.token, received)) fail(403, 'DENIED');

      if (match[2] === 'head' && request.method === 'GET') {
        await handleHead(response, installationId);
        return;
      }
      if (match[2] === 'records' && request.method === 'POST') {
        await handleAppend(request, response, installationId, credential);
        return;
      }
      reply(response, 405, { error: 'METHOD_NOT_ALLOWED' });
    } catch (error) {
      if (response.headersSent || response.destroyed) return;
      const status = Number.isInteger(error?.status) ? error.status : 503;
      const safeCode = /^[A-Z_]+$/.test(error?.message || '') ? error.message : 'ANCHOR_UNAVAILABLE';
      reply(response, status, { error: safeCode });
    }
  });

  return Object.freeze({ server, publicKey: publicPem });
}
