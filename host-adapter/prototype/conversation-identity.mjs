const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MARKER_PREFIX = 'logic-engine-host-lifecycle:';
const INSTALLATION_KEY = 'logic-engine-host-installation-id';
const locatorKey = locator => 'logic-engine-host-lifecycle-locator:' + locator;
const validUuid = value => typeof value === 'string' && UUID.test(value);

/**
 * Resolve a stable Host conversation identity without treating the mutable
 * SillyTavern filename as identity. Persistence and collision checks are
 * injected so the logic can be tested independently of a browser.
 *
 * This is an identity/lineage guard, not a trust authority. The result remains
 * review-only until Core authorizes the adapter/conversation/world binding.
 */
export async function resolveStableHostConversationIdentity({
  locator,
  metadata,
  storage,
  saveMetadata,
  getCurrentLocator = () => locator,
  getCurrentMetadata = () => metadata,
  pendingRenameId = null,
  cryptoProvider = globalThis.crypto,
}) {
  if (typeof locator !== 'string' || !locator.trim()) return { status: 'NON_READY', reason: 'NO_ACTIVE_CONVERSATION' };
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw Error('NON_READY: current Host chat metadata is unavailable');
  }
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function'
    || typeof storage.removeItem !== 'function' || typeof storage.key !== 'function') {
    throw Error('NON_READY: Host identity storage unavailable');
  }
  if (typeof saveMetadata !== 'function') throw TypeError('saveMetadata is required');
  if (typeof cryptoProvider?.randomUUID !== 'function') throw Error('NON_READY: crypto.randomUUID unavailable');

  let installationId = storage.getItem(INSTALLATION_KEY);
  if (installationId !== null && !validUuid(installationId)) {
    throw Error('NON_READY: malformed Host installation identity');
  }
  if (!installationId) {
    installationId = cryptoProvider.randomUUID();
    storage.setItem(INSTALLATION_KEY, installationId);
    if (storage.getItem(INSTALLATION_KEY) !== installationId) {
      throw Error('NON_READY: Host installation identity save failed');
    }
  }

  const existing = metadata.logic_engine_conversation_id;
  const legacyMarker = MARKER_PREFIX + locator;
  const currentLocatorKey = locatorKey(locator);
  const mappedId = storage.getItem(currentLocatorKey);

  if (existing !== undefined && !validUuid(existing)) {
    throw Error('NON_READY: malformed stable Host conversation identity');
  }
  if (mappedId && (!validUuid(existing) || mappedId !== installationId + ':' + existing)) {
    throw Error('NON_READY: Host locator metadata is missing or inconsistent');
  }

  if (validUuid(existing)) {
    const resolvedId = installationId + ':' + existing;
    const activeMarker = MARKER_PREFIX + resolvedId;
    if (storage.getItem(legacyMarker) && legacyMarker !== activeMarker) {
      throw Error('NON_READY: legacy Host enrollment marker conflicts with installation identity');
    }
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (typeof key !== 'string') continue;
      const value = storage.getItem(key);
      if (key.startsWith(MARKER_PREFIX) && key.endsWith(':' + existing) && key !== activeMarker) {
        throw Error('NON_READY: Host conversation identity is already enrolled elsewhere');
      }
      if (key.startsWith(MARKER_PREFIX) && typeof value === 'string'
        && value.endsWith(':' + locator) && key !== activeMarker) {
        throw Error('NON_READY: Host locator is associated with another conversation identity');
      }
    }
    if (!mappedId && storage.getItem(activeMarker) && pendingRenameId !== resolvedId) {
      throw Error('NON_READY: enrolled Host conversation has no matching locator binding');
    }
    return { status: 'READY_FOR_REVIEW', conversationId: resolvedId, installationId, conversationUuid: existing };
  }

  if (mappedId) throw Error('NON_READY: Host locator is bound but its stable metadata identity is missing');
  if (storage.getItem(legacyMarker)) throw Error('NON_READY: legacy identity migration required');
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    const value = typeof key === 'string' ? storage.getItem(key) : null;
    if (typeof key === 'string' && key.startsWith(MARKER_PREFIX)
      && typeof value === 'string' && value.endsWith(':' + locator)) {
      throw Error('NON_READY: enrolled Host locator has no stable metadata identity');
    }
  }

  const originalMetadata = metadata;
  const conversationUuid = cryptoProvider.randomUUID();
  metadata.logic_engine_conversation_id = conversationUuid;
  if (getCurrentMetadata() !== originalMetadata || getCurrentLocator() !== locator) {
    delete originalMetadata.logic_engine_conversation_id;
    throw Error('NON_READY: Host conversation changed during identity enrollment');
  }
  try {
    await saveMetadata();
  } catch (error) {
    delete originalMetadata.logic_engine_conversation_id;
    throw Error('NON_READY: durable Host conversation identity could not be saved: ' + (error?.message || error));
  }
  if (getCurrentMetadata() !== originalMetadata || getCurrentLocator() !== locator
    || originalMetadata.logic_engine_conversation_id !== conversationUuid) {
    throw Error('NON_READY: Host conversation identity changed during persistence');
  }
  return {
    status: 'READY_FOR_REVIEW',
    conversationId: installationId + ':' + conversationUuid,
    installationId,
    conversationUuid,
    created: true,
  };
}

export function hostLocatorHasEnrollment(locator, storage) {
  if (typeof locator !== 'string' || !locator.trim() || !storage
    || typeof storage.getItem !== 'function' || typeof storage.key !== 'function') return true;
  if (storage.getItem(locatorKey(locator)) || storage.getItem(MARKER_PREFIX + locator)) return true;
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    const value = typeof key === 'string' ? storage.getItem(key) : null;
    if (typeof key === 'string' && key.startsWith(MARKER_PREFIX)
      && typeof value === 'string' && value.endsWith(':' + locator)) return true;
  }
  return false;
}

export function hasAnyHostEnrollment(storage) {
  if (!storage || typeof storage.getItem !== 'function') return true;
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (typeof key === 'string' && key.startsWith(MARKER_PREFIX) && storage.getItem(key)) return true;
  }
  return false;
}

export const stableHostIdentityContract = Object.freeze({
  installationKey: INSTALLATION_KEY,
  markerPrefix: MARKER_PREFIX,
  identityMetadataKey: 'logic_engine_conversation_id',
  locatorBindingPrefix: 'logic-engine-host-lifecycle-locator:',
  authority: 'NON_AUTHORITATIVE',
});
