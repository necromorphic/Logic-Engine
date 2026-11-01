const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[a-f0-9]{64}$/;
const validText = value => typeof value === 'string' && value === value.trim()
  && value.length > 0 && value.length <= 200
  && ![...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);

/**
 * Parse deployment-owned Host root bindings. The registry is an authorization
 * allowlist, not an enrollment API: callers cannot add or change a binding.
 */
export function parseHostRootIdentityRegistry(serialized = '[]') {
  if (typeof serialized !== 'string') throw new TypeError('ENGINE_HOST_ROOT_IDENTITIES must be a JSON array.');
  let records;
  try { records = JSON.parse(serialized); }
  catch { throw new TypeError('ENGINE_HOST_ROOT_IDENTITIES must be valid JSON.'); }
  if (!Array.isArray(records)) throw new TypeError('ENGINE_HOST_ROOT_IDENTITIES must be a JSON array.');
  const seen = new Set();
  return Object.freeze(records.map(record => {
    const allowed = ['adapter_id', 'host_installation_id', 'authenticated_account_id', 'root_id'];
    if (!record || typeof record !== 'object' || Array.isArray(record)
      || Object.keys(record).length !== allowed.length
      || Object.keys(record).some(key => !allowed.includes(key))
      || !validText(record.adapter_id)
      || !UUID.test(record.host_installation_id ?? '')
      || !UUID.test(record.authenticated_account_id ?? '')
      || !DIGEST.test(record.root_id ?? '')) {
      throw new TypeError('ENGINE_HOST_ROOT_IDENTITIES contains an invalid adapter/installation/account/root binding.');
    }
    const normalized = Object.freeze({
      adapter_id: record.adapter_id,
      host_installation_id: record.host_installation_id,
      authenticated_account_id: record.authenticated_account_id,
      root_id: record.root_id,
    });
    const key = JSON.stringify(Object.values(normalized));
    if (seen.has(key)) throw new TypeError('ENGINE_HOST_ROOT_IDENTITIES contains a duplicate binding.');
    seen.add(key);
    return normalized;
  }));
}

export function resolveAdapterHostRootIdentity(registry, input) {
  if (!Array.isArray(registry) || !input || typeof input !== 'object') {
    return Object.freeze({ authorized: false });
  }
  const match = registry.find(record => record.adapter_id === input.adapterId
    && record.host_installation_id === input.host_installation_id
    && record.authenticated_account_id === input.authenticated_account_id
    && record.root_id === input.root_id);
  return match ? Object.freeze({
    authorized: true,
    host_installation_id: match.host_installation_id,
    authenticated_account_id: match.authenticated_account_id,
    root_id: match.root_id,
  }) : Object.freeze({ authorized: false });
}

export function resolveRegisteredHostRootIdentity(registry, input) {
  if (!Array.isArray(registry) || !input || typeof input !== 'object') {
    return Object.freeze({ authorized: false });
  }
  const match = registry.find(record => record.host_installation_id === input.host_installation_id
    && record.authenticated_account_id === input.authenticated_account_id
    && record.root_id === input.root_id);
  return match ? Object.freeze({
    authorized: true,
    host_installation_id: match.host_installation_id,
    authenticated_account_id: match.authenticated_account_id,
    root_id: match.root_id,
  }) : Object.freeze({ authorized: false });
}


/**
 * Resolve the installation/account identity for durable lifecycle events.
 * The adapter credential is checked by the API boundary; the SillyTavern
 * same-origin proxy separately binds the conversation UUID to its signed
 * session and authenticated account before forwarding the event.
 */
export function resolveAdapterHostLifecycleIdentity(registry, input) {
  if (!Array.isArray(registry) || !input || typeof input !== 'object'
    || !validText(input.adapterId)
    || !UUID.test(input.host_installation_id ?? '')
    || !UUID.test(input.authenticated_account_id ?? '')
    || !UUID.test(input.host_session_id ?? '')
    || !UUID.test(input.conversation_uuid ?? '')) {
    return Object.freeze({ authorized: false });
  }
  const match = registry.find(record => record.adapter_id === input.adapterId
    && record.host_installation_id === input.host_installation_id
    && record.authenticated_account_id === input.authenticated_account_id);
  return match ? Object.freeze({
    authorized: true,
    adapter_id: match.adapter_id,
    host_installation_id: match.host_installation_id,
    authenticated_account_id: match.authenticated_account_id,
    host_session_id: input.host_session_id,
    conversation_uuid: input.conversation_uuid,
    root_id: match.root_id,
  }) : Object.freeze({ authorized: false });
}

/** Independent journal-side check after the API's adapter authentication. */
export function resolveRegisteredHostLifecycleIdentity(registry, input) {
  if (!Array.isArray(registry) || !input || typeof input !== 'object'
    || !UUID.test(input.host_installation_id ?? '')
    || !UUID.test(input.authenticated_account_id ?? '')
    || !UUID.test(input.host_session_id ?? '')
    || !UUID.test(input.conversation_uuid ?? '')) {
    return Object.freeze({ authorized: false });
  }
  const match = registry.find(record => record.host_installation_id === input.host_installation_id
    && record.authenticated_account_id === input.authenticated_account_id);
  return match ? Object.freeze({
    authorized: true,
    adapter_id: match.adapter_id,
    host_installation_id: match.host_installation_id,
    authenticated_account_id: match.authenticated_account_id,
    host_session_id: input.host_session_id,
    conversation_uuid: input.conversation_uuid,
    root_id: match.root_id,
  }) : Object.freeze({ authorized: false });
}
