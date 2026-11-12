const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MARKER_PREFIX = 'logic-engine-host-lifecycle:';
const LOCATOR_PREFIX = 'logic-engine-host-lifecycle-locator:';
const INSTALLATION_KEY = 'logic-engine-host-installation-id';
const locatorKey = locator => LOCATOR_PREFIX + locator;
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
  hostSessionId,
  hostInstallationId,
  authenticatedAccountId,
  metadata,
  storage,
  saveMetadata,
  getCurrentLocator = () => locator,
  getCurrentMetadata = () => metadata,
  pendingRenameId = null,
  verifyPersistedIdentity = null,
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
  if (verifyPersistedIdentity !== null && typeof verifyPersistedIdentity !== 'function') {
    throw TypeError('verifyPersistedIdentity must be a trusted callback');
  }
  if (typeof cryptoProvider?.randomUUID !== 'function') throw Error('NON_READY: crypto.randomUUID unavailable');
  if (!validUuid(hostSessionId)) return { status: 'NON_READY', reason: 'HOST_SESSION_ID_UNAVAILABLE' };
  if (!validUuid(hostInstallationId)) return { status: 'NON_READY', reason: 'HOST_INSTALLATION_ID_UNAVAILABLE' };
  if (!validUuid(authenticatedAccountId)) return { status: 'NON_READY', reason: 'HOST_AUTHENTICATED_ACCOUNT_ID_UNAVAILABLE' };

  // Installation identity is server-owned. localStorage is only a consistency
  // cache and must never mint or override the authenticated server identity.
  const cachedInstallationId = storage.getItem(INSTALLATION_KEY);
  if (cachedInstallationId !== null && !validUuid(cachedInstallationId)) {
    throw Error('NON_READY: malformed cached Host installation identity');
  }
  if (cachedInstallationId && cachedInstallationId !== hostInstallationId) {
    if (hostLocatorHasEnrollment(locator, storage)) {
      throw Error('NON_READY: enrolled Host installation identity migration required');
    }
    storage.setItem(INSTALLATION_KEY, hostInstallationId);
    if (storage.getItem(INSTALLATION_KEY) !== hostInstallationId) {
      throw Error('NON_READY: Host installation identity cache update failed');
    }
  } else if (!cachedInstallationId) {
    storage.setItem(INSTALLATION_KEY, hostInstallationId);
    if (storage.getItem(INSTALLATION_KEY) !== hostInstallationId) {
      throw Error('NON_READY: Host installation identity cache save failed');
    }
  }
  const installationId = hostInstallationId;
  const accountId = authenticatedAccountId;

  const existing = metadata.logic_engine_conversation_id;
  const legacyMarker = MARKER_PREFIX + locator;
  const currentLocatorKey = locatorKey(locator);
  const mappedId = storage.getItem(currentLocatorKey);
  const markerValueMatchesLocator = value => typeof value === 'string'
    && ['enrolled:', 'enrolling:', 'NON_READY:'].some(prefix => value === prefix + locator);
  const verifyServerPersistence = async conversationUuid => {
    if (typeof verifyPersistedIdentity !== 'function') return false;
    try { return await verifyPersistedIdentity(conversationUuid) === true; } catch { return false; }
  };
  const persistConversationUuid = async (conversationUuid, { requireServerVerification = false } = {}) => {
    const originalMetadata = metadata;
    const hadPriorIdentity = Object.hasOwn(originalMetadata, 'logic_engine_conversation_id');
    const priorIdentity = originalMetadata.logic_engine_conversation_id;
    originalMetadata.logic_engine_conversation_id = conversationUuid;
    if (getCurrentMetadata() !== originalMetadata || getCurrentLocator() !== locator) {
      delete originalMetadata.logic_engine_conversation_id;
      throw Error('NON_READY: Host conversation changed during identity recovery');
    }
    try {
      await saveMetadata();
    } catch (error) {
      if (hadPriorIdentity) originalMetadata.logic_engine_conversation_id = priorIdentity;
      else delete originalMetadata.logic_engine_conversation_id;
      throw Error('NON_READY: durable Host conversation identity could not be saved: ' + (error?.message || error));
    }
    if (getCurrentMetadata() !== originalMetadata || getCurrentLocator() !== locator
      || originalMetadata.logic_engine_conversation_id !== conversationUuid) {
      throw Error('NON_READY: Host conversation identity changed during persistence');
    }
    if (requireServerVerification && !(await verifyServerPersistence(conversationUuid))) {
      throw Error('NON_READY: server did not confirm the recovered conversation identity in the persisted chat');
    }
  };

  if (existing !== undefined && existing !== null && !validUuid(existing)) {
    throw Error('NON_READY: malformed stable Host conversation identity');
  }

  if (validUuid(existing)) {
    const resolvedId = installationId + ':' + accountId + ':' + existing;
    const activeMarker = MARKER_PREFIX + resolvedId;
    if (mappedId && mappedId !== resolvedId) {
      throw Error('NON_READY: Host locator metadata is missing or inconsistent');
    }
    if (mappedId && typeof verifyPersistedIdentity === 'function'
      && !(await verifyServerPersistence(existing))) {
      throw Error('NON_READY: server did not confirm the current conversation identity in the persisted chat');
    }
    if (storage.getItem(legacyMarker) && legacyMarker !== activeMarker) {
      throw Error('NON_READY: legacy Host enrollment marker conflicts with installation identity');
    }
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (typeof key !== 'string') continue;
      const value = storage.getItem(key);
      if (key.startsWith(MARKER_PREFIX) && key.endsWith(':' + accountId + ':' + existing) && key !== activeMarker) {
        throw Error('NON_READY: Host conversation identity is already enrolled elsewhere');
      }
      if (key.startsWith(MARKER_PREFIX) && typeof value === 'string'
        && value.endsWith(':' + locator) && key !== activeMarker) {
        throw Error('NON_READY: Host locator is associated with another conversation identity');
      }
      if (key.startsWith(LOCATOR_PREFIX) && value === resolvedId && key !== currentLocatorKey) {
        throw Error('NON_READY: Host conversation identity is already mapped to another locator');
      }
    }
    if (!mappedId && storage.getItem(activeMarker)) {
      const markerValue = storage.getItem(activeMarker);
      if (!markerValueMatchesLocator(markerValue) || pendingRenameId !== resolvedId) {
        if (!markerValueMatchesLocator(markerValue)) {
          throw Error('NON_READY: enrolled Host conversation marker does not match the active locator');
        }
        // An exact marker/metadata pair can repair only its missing locator cache.
        if (!(await verifyServerPersistence(existing))) {
          throw Error('NON_READY: server confirmation is required before repairing a Host locator binding');
        }
        storage.setItem(currentLocatorKey, resolvedId);
        if (storage.getItem(currentLocatorKey) !== resolvedId) {
          throw Error('NON_READY: Host locator binding repair failed');
        }
      }
    }
    return { status: 'READY_FOR_REVIEW', conversationId: resolvedId, hostSessionId, installationId, conversationUuid: existing };
  }

  if (mappedId) {
    const prefix = installationId + ':' + accountId + ':';
    const conversationUuid = mappedId.startsWith(prefix) ? mappedId.slice(prefix.length) : null;
    const markerKey = MARKER_PREFIX + mappedId;
    const markerValue = storage.getItem(markerKey);
    if (!validUuid(conversationUuid) || !markerValueMatchesLocator(markerValue)) {
      throw Error('NON_READY: Host locator binding and enrollment marker do not form a valid recovery pair');
    }
    if (storage.getItem(legacyMarker) !== null) {
      throw Error('NON_READY: legacy filename marker conflicts with the stable enrollment mapping');
    }
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (typeof key !== 'string' || key === markerKey || key === currentLocatorKey) continue;
      const value = storage.getItem(key);
      if ((key.startsWith(MARKER_PREFIX) && key.endsWith(':' + accountId + ':' + conversationUuid))
        || (key.startsWith(MARKER_PREFIX) && typeof value === 'string' && value.endsWith(':' + locator))
        || (key.startsWith(LOCATOR_PREFIX) && value === mappedId)) {
        throw Error('NON_READY: Host enrollment recovery pair is duplicated or associated elsewhere');
      }
    }
    if (typeof verifyPersistedIdentity !== 'function') {
      throw Error('NON_READY: server confirmation is required before restoring missing chat identity metadata');
    }
    await persistConversationUuid(conversationUuid);
    if (!(await verifyServerPersistence(conversationUuid))) {
      throw Error('NON_READY: server did not confirm the restored conversation identity in the persisted chat');
    }
    return {
      status: 'READY_FOR_REVIEW',
      conversationId: mappedId,
      hostSessionId,
      installationId,
      conversationUuid,
      recoveredFromVerifiedEnrollmentPair: true,
    };
  }

  if (storage.getItem(legacyMarker)) throw Error('NON_READY: legacy identity migration required');
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    const value = typeof key === 'string' ? storage.getItem(key) : null;
    if (typeof key === 'string' && key.startsWith(MARKER_PREFIX)
      && typeof value === 'string' && value.endsWith(':' + locator)) {
      throw Error('NON_READY: enrolled Host locator has no stable metadata identity');
    }
  }

  const conversationUuid = cryptoProvider.randomUUID();
  await persistConversationUuid(conversationUuid);
  return {
    status: 'READY_FOR_REVIEW',
    conversationId: installationId + ':' + accountId + ':' + conversationUuid,
    hostSessionId,
    installationId,
    conversationUuid,
    created: true,
  };
}

export function hostLocatorHasEnrollment(locator, storage) {
  if (typeof locator !== 'string' || !locator.trim() || !storage
    || typeof storage.getItem !== 'function' || typeof storage.key !== 'function') return true;
  if (storage.getItem(locatorKey(locator)) !== null || storage.getItem(MARKER_PREFIX + locator) !== null) return true;
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
    if (typeof key === 'string' && (key.startsWith(MARKER_PREFIX) || key.startsWith(LOCATOR_PREFIX))) return true;
  }
  return false;
}

export const stableHostIdentityContract = Object.freeze({
  installationKey: INSTALLATION_KEY,
  sessionIdentityKey: 'logicEngineSessionId',
  conversationIdFormat: 'installationId:accountId:conversationUuid',
  markerPrefix: MARKER_PREFIX,
  identityMetadataKey: 'logic_engine_conversation_id',
  locatorBindingPrefix: 'logic-engine-host-lifecycle-locator:',
  authority: 'NON_AUTHORITATIVE',
});
