/**
 * Browser-side Extension Gateway transport.
 * Every Host request stays same-origin and enters through SillyTavern's
 * supported server-plugin namespace. This module never calls Core directly.
 */
export const CONNECTION_STATES = Object.freeze({
  idle: 'idle',
  checking: 'checking',
  connected: 'connected',
  unavailable: 'unavailable',
  error: 'error',
});

const GATEWAY_SESSION_PATH = '/api/plugins/logic-engine-extension-gateway/session';
const GATEWAY_IDENTITY_PATH = '/api/plugins/logic-engine-extension-gateway/identity';
const HOST_SESSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class GatewayCheckError extends Error {
  constructor(kind, message, options = undefined) {
    super(message, options);
    this.name = 'GatewayCheckError';
    this.kind = kind;
  }
}

function unavailable(message, cause) {
  return new GatewayCheckError('unavailable', message, cause ? { cause } : undefined);
}

export async function fetchGatewaySession(fetchImpl = fetch, lifecycleSignal = null) {
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required');
  let response;
  try {
    response = await fetchImpl(GATEWAY_SESSION_PATH, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: { accept: 'application/json' },
      signal: lifecycleSignal
        ? AbortSignal.any([lifecycleSignal, AbortSignal.timeout(2500)])
        : AbortSignal.timeout(2500),
    });
  } catch (error) {
    if (lifecycleSignal?.aborted) throw error;
    if (error?.name === 'TimeoutError') throw unavailable('Extension Gateway не ответил за 2,5 с', error);
    throw unavailable('Extension Gateway недоступен', error);
  }
  if (response.status === 401 || response.status === 403) {
    throw new GatewayCheckError('error', 'SillyTavern не подтвердил аутентифицированную сессию');
  }
  if (!response.ok) {
    throw new GatewayCheckError('error', `Extension Gateway ответил HTTP ${response.status}`);
  }
  let body;
  try {
    body = await response.json();
  } catch (error) {
    throw new GatewayCheckError('error', 'ответ Extension Gateway не является корректным JSON', { cause: error });
  }
  if (typeof body?.host_session_id !== 'string' || !HOST_SESSION_UUID.test(body.host_session_id)
    || body?.host_session_identity !== 'SIGNED_AUTHENTICATED_ST_SESSION'
    || typeof body?.host_user_handle !== 'string' || !body.host_user_handle.trim()) {
    throw new GatewayCheckError('error', 'ответ не соответствует контракту Host session');
  }
  return body;
}

export async function fetchGatewayIdentity(fetchImpl = fetch, lifecycleSignal = null) {
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required');
  let response;
  try {
    response = await fetchImpl(GATEWAY_IDENTITY_PATH, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: { accept: 'application/json' },
      signal: lifecycleSignal
        ? AbortSignal.any([lifecycleSignal, AbortSignal.timeout(2500)])
        : AbortSignal.timeout(2500),
    });
  } catch (error) {
    if (lifecycleSignal?.aborted) throw error;
    if (error?.name === 'TimeoutError') throw unavailable('Host identity store не ответил за 2,5 с', error);
    throw unavailable('Host identity store недоступен', error);
  }
  if (response.status === 401 || response.status === 403) {
    throw new GatewayCheckError('error', 'SillyTavern не подтвердил аутентифицированную identity');
  }
  if (!response.ok) throw new GatewayCheckError('error', `Host identity route ответил HTTP ${response.status}`);
  let body;
  try { body = await response.json(); } catch (error) {
    throw new GatewayCheckError('error', 'ответ Host identity не является корректным JSON', { cause: error });
  }
  if (!HOST_SESSION_UUID.test(body?.host_installation_id ?? '')
    || !HOST_SESSION_UUID.test(body?.authenticated_account_id ?? '')
    || !HOST_SESSION_UUID.test(body?.host_session_id ?? '')
    || body?.identity_source !== 'SERVER_PERSISTED_OPAQUE_IDENTITY') {
    throw new GatewayCheckError('error', 'Host identity не соответствует серверному контракту');
  }
  return body;
}

export function describeGatewayResult(body) {
  return {
    state: CONNECTION_STATES.connected,
    text: `Extension Gateway подключён. Сессия SillyTavern подтверждена; Host/Core transport остаётся NON_READY.`,
    sessionId: body.host_session_id,
  };
}

export function describeGatewayFailure(error) {
  if (error?.kind === 'unavailable') {
    return { state: CONNECTION_STATES.unavailable, text: `Недоступно: ${error.message}.` };
  }
  return { state: CONNECTION_STATES.error, text: `Ошибка: ${error?.message || 'неизвестная ошибка'}.` };
}
