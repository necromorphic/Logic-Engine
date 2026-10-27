import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const clientPath = fileURLToPath(new URL('./accepted-head-client.js', import.meta.url));

function invoke(input, timeoutMs) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10000) {
    throw new TypeError('Invalid accepted-head IPC timeout.');
  }
  const result = spawnSync(process.execPath, [clientPath], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    timeout: timeoutMs + 500,
    windowsHide: true,
    maxBuffer: 8192,
    env: { PATH: process.env.PATH || '', SystemRoot: process.env.SystemRoot || '', WINDIR: process.env.WINDIR || '' },
  });
  if (result.error || result.status !== 0) {
    throw new Error('ACCEPTED_HEAD_AUTHORITY_UNAVAILABLE');
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error('ACCEPTED_HEAD_AUTHORITY_INVALID_RESPONSE');
  }
}

function validDigest(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function validDomain(domain) {
  return domain === 'core' || domain === 'provider';
}

/**
 * Synchronous client for existing synchronous SQLite mutation boundaries.
 * The caller must hold the shared coordinator. The authority service must never
 * acquire that coordinator. A successful advance remains pending until finalize.
 */
export function advanceAcceptedHeadSync({
  domain, operationId, operationDigest, expectedHead, token, port, timeoutMs = 1500,
}) {
  if (!validDomain(domain) || typeof operationId !== 'string' || !operationId.trim()
    || !validDigest(operationDigest) || !Number.isSafeInteger(expectedHead) || expectedHead < 0
    || typeof token !== 'string' || token.length < 32
    || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TypeError('Invalid accepted-head client configuration.');
  }
  const response = invoke({
    action: 'advance',
    domain,
    operation_id: operationId,
    operation_digest: operationDigest,
    expected_head: expectedHead,
    token,
    port,
    timeout_ms: timeoutMs,
  }, timeoutMs);
  if (!response || response.ok !== true || response.result?.domain !== domain
    || response.result?.operation_id !== operationId
    || !Number.isSafeInteger(response.result?.head) || response.result.head < 1
    || !['pending', 'committed'].includes(response.result.status)) {
    throw new Error('ACCEPTED_HEAD_AUTHORITY_UNAVAILABLE');
  }
  return Object.freeze({
    domain,
    head: response.result.head,
    operation_id: operationId,
    replayed: response.result.replayed === true,
    status: response.result.status,
  });
}

export function enrollAcceptedHeadSync({
  domain, operationId, operationDigest, token, port, timeoutMs = 1500,
}) {
  if (!validDomain(domain) || typeof operationId !== 'string' || !operationId.trim()
    || !validDigest(operationDigest) || typeof token !== 'string' || token.length < 32
    || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TypeError('Invalid accepted-head client configuration.');
  }
  const response = invoke({
    action: 'enroll',
    domain,
    operation_id: operationId,
    operation_digest: operationDigest,
    expected_head: 0,
    token,
    port,
    timeout_ms: timeoutMs,
  }, timeoutMs);
  if (!response || response.ok !== true || response.result?.domain !== domain
    || response.result?.operation_id !== operationId
    || response.result?.head !== 1
    || !['pending', 'committed'].includes(response.result.status)) {
    throw new Error('ACCEPTED_HEAD_AUTHORITY_UNAVAILABLE');
  }
  return Object.freeze({
    domain,
    head: response.result.head,
    operation_id: operationId,
    replayed: response.result.replayed === true,
    status: response.result.status,
  });
}

export function finalizeAcceptedHeadSync({
  domain, operationId, operationDigest, token, port, timeoutMs = 1500,
}) {
  if (!validDomain(domain) || typeof operationId !== 'string' || !operationId.trim()
    || !validDigest(operationDigest) || typeof token !== 'string' || token.length < 32
    || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TypeError('Invalid accepted-head client configuration.');
  }
  const response = invoke({
    action: 'finalize',
    domain,
    operation_id: operationId,
    operation_digest: operationDigest,
    token,
    port,
    timeout_ms: timeoutMs,
  }, timeoutMs);
  if (!response || response.ok !== true || response.result?.domain !== domain
    || response.result?.operation_id !== operationId
    || !Number.isSafeInteger(response.result?.head) || response.result.head < 1
    || response.result.status !== 'committed') {
    throw new Error('ACCEPTED_HEAD_AUTHORITY_UNAVAILABLE');
  }
  return Object.freeze({
    domain,
    head: response.result.head,
    operation_id: operationId,
    replayed: response.result.replayed === true,
    status: 'committed',
  });
}

/**
 * Synchronously reads current heads. Any unresolved operation makes the
 * authority non-ready; callers must not dispatch until explicit recovery.
 */
export function getAcceptedHeadStatusSync({ port, token, timeoutMs = 1500 }) {
  if (typeof token !== 'string' || token.length < 32 || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TypeError('Invalid accepted-head client configuration.');
  }
  const response = invoke({
    action: 'heads',
    token,
    port,
    timeout_ms: timeoutMs,
  }, timeoutMs);
  const heads = response?.heads;
  const pending = response?.pending;
  const enrolled = response?.enrolled;
  if (response?.ok !== true || !Number.isSafeInteger(heads?.core) || heads.core < 0
    || !Number.isSafeInteger(heads?.provider) || heads.provider < 0
    || typeof pending?.core !== 'boolean' || typeof pending?.provider !== 'boolean'
    || typeof enrolled?.core !== 'boolean' || typeof enrolled?.provider !== 'boolean') {
    throw new Error('ACCEPTED_HEAD_AUTHORITY_UNAVAILABLE');
  }
  return Object.freeze({
    heads: Object.freeze({ core: heads.core, provider: heads.provider }),
    pending: Object.freeze({ core: pending.core, provider: pending.provider }),
    enrolled: Object.freeze({ core: enrolled.core, provider: enrolled.provider }),
  });
}

export function getAcceptedHeadsSync({ port, token, timeoutMs = 1500 }) {
  const status = getAcceptedHeadStatusSync({ port, token, timeoutMs });
  if (status.pending.core || status.pending.provider || !status.enrolled.core || !status.enrolled.provider) {
    throw new Error('ACCEPTED_HEAD_AUTHORITY_UNAVAILABLE');
  }
  return status.heads;
}
