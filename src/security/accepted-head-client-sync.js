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

/**
 * Synchronous client for existing synchronous SQLite mutation boundaries.
 * This intentionally blocks the caller until the authority responds, so the
 * caller can abort its local transaction on failure. Invoke while holding the
 * shared coordinator. The authority service must never acquire that coordinator.
 */
export function advanceAcceptedHeadSync({ domain, operationId, token, port, timeoutMs = 1500 }) {
  if (!['core', 'provider'].includes(domain)
    || typeof operationId !== 'string' || !operationId.trim()
    || typeof token !== 'string' || token.length < 32
    || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TypeError('Invalid accepted-head client configuration.');
  }
  const response = invoke({
    action: 'advance',
    domain,
    operation_id: operationId,
    token,
    port,
    timeout_ms: timeoutMs,
  }, timeoutMs);
  if (!response || response.ok !== true || response.result?.domain !== domain
    || response.result?.operation_id !== operationId
    || !Number.isSafeInteger(response.result?.head) || response.result.head < 1) {
    throw new Error('ACCEPTED_HEAD_AUTHORITY_UNAVAILABLE');
  }
  return Object.freeze({
    domain,
    head: response.result.head,
    operation_id: operationId,
    replayed: response.result.replayed === true,
  });
}

/**
 * Synchronously reads current heads through the authority's loopback endpoint.
 * Call only inside the same shared coordinator order as mutations/dispatch-start.
 */
export function getAcceptedHeadsSync({ port, timeoutMs = 1500 }) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TypeError('Invalid accepted-head client configuration.');
  }
  const response = invoke({
    action: 'heads',
    port,
    timeout_ms: timeoutMs,
  }, timeoutMs);
  const heads = response?.heads;
  if (response?.ok !== true || !Number.isSafeInteger(heads?.core) || heads.core < 0
    || !Number.isSafeInteger(heads?.provider) || heads.provider < 0) {
    throw new Error('ACCEPTED_HEAD_AUTHORITY_UNAVAILABLE');
  }
  return Object.freeze({ core: heads.core, provider: heads.provider });
}
