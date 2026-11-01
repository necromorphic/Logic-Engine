/**
 * Transport and status mapping for the Logic-Engine bridge settings panel.
 * This module is intentionally DOM-free so it can be unit tested under Node.
 */

export const CONNECTION_STATES = Object.freeze({
  idle: 'idle',
  checking: 'checking',
  connected: 'connected',
  unavailable: 'unavailable',
  error: 'error',
});

/**
 * Failure kinds are deliberately limited to the two states the UI must show
 * besides "connected":
 * - "unavailable": the engine could not be reached at all (offline, refused,
 *   timeout, DNS failure);
 * - "error": the engine was reached or the address is invalid, but the result
 *   is not a valid Logic-Engine /health response.
 */
export class HealthCheckError extends Error {
  constructor(kind, message, options = undefined) {
    super(message, options);
    this.name = 'HealthCheckError';
    this.kind = kind;
  }
}

export function normalizeEngineUrl(value) {
  if (typeof value !== 'string' || !value.trim()) throw new HealthCheckError('error', 'укажите адрес движка');
  let url;
  try { url = new URL(value.trim()); } catch { throw new HealthCheckError('error', 'некорректный адрес движка'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new HealthCheckError('error', 'нужен базовый HTTP(S)-адрес без логина, пути, параметров и фрагмента');
  }
  return url.origin;
}

function unavailable(message, cause) {
  return new HealthCheckError('unavailable', message, cause ? { cause } : undefined);
}

export async function fetchHealth(baseUrl, fetchImpl = fetch, lifecycleSignal = null) {
  const url = normalizeEngineUrl(baseUrl) + '/health';
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: lifecycleSignal
        ? AbortSignal.any([lifecycleSignal, AbortSignal.timeout(2500)])
        : AbortSignal.timeout(2500),
    });
  } catch (error) {
    // Disabling the extension is not a connection failure and must not paint the panel.
    if (lifecycleSignal?.aborted) throw error;
    if (error?.name === 'TimeoutError') throw unavailable('движок не ответил за 2,5 с', error);
    throw unavailable('движок недоступен: соединение не установлено', error);
  }
  if (!response.ok) throw new HealthCheckError('error', `движок ответил HTTP ${response.status}`);
  let body;
  try {
    body = await response.json();
  } catch (error) {
    throw new HealthCheckError('error', 'ответ движка не является корректным JSON', { cause: error });
  }
  if (body?.ok !== true || body?.service !== 'logic-engine' || body?.protocol_version !== 'v1') {
    throw new HealthCheckError('error', 'ответ не соответствует контракту Logic-Engine /health');
  }
  return body;
}

export function describeHealthResult(body) {
  return {
    state: CONNECTION_STATES.connected,
    text: `Подключено: ${body.service}, протокол ${body.protocol_version}.`,
  };
}

export function describeHealthFailure(error) {
  if (error?.kind === 'unavailable') {
    return { state: CONNECTION_STATES.unavailable, text: `Недоступно: ${error.message}.` };
  }
  const message = error?.message || 'неизвестная ошибка';
  return { state: CONNECTION_STATES.error, text: `Ошибка: ${message}.` };
}
