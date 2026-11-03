import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { enumerateHostDataInventory } from './host-data-inventory.mjs';

const HOST_SESSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function resolveHostDataDirectories(directories) {
  if (!directories || typeof directories !== 'object' || Array.isArray(directories)) return null;
  const resolved = {};
  for (const key of ['root', 'chats', 'groups', 'groupChats']) {
    const value = directories[key];
    if (typeof value !== 'string' || !value.trim()) return null;
    const absolute = path.resolve(value);
    if (!path.isAbsolute(absolute)) return null;
    resolved[key] = absolute;
  }
  return Object.freeze(resolved);
}

function getAuthenticatedHostIdentity(request, { requireDirectories = false, requireSessionIdentity = false } = {}) {
  const user = request?.user;
  const session = request?.session;
  const directories = requireDirectories
    ? resolveHostDataDirectories(user?.directories)
    : user?.directories;
  const userHandle = user?.profile?.handle;
  // ST default-user mode intentionally omits session.handle. A present value
  // must still match the authenticated middleware-populated profile handle.
  if (!session || (requireDirectories && !directories)
    || typeof userHandle !== 'string' || !userHandle.trim()
    || (session.handle !== undefined
      && (typeof session.handle !== 'string' || session.handle !== userHandle))) return null;
  if (requireSessionIdentity
    && (typeof session.logicEngineSessionId !== 'string'
      || !HOST_SESSION_UUID.test(session.logicEngineSessionId)
      || session.logicEngineSessionHandle !== userHandle)) return null;
  return { userHandle, session, directories };
}

export function createHostInventoryHandler({
  enumerate,
  pinnedHostCommit,
  hostBuildClaim,
  persistRootInventory = null,
}) {
  if (typeof enumerate !== 'function'
    || typeof pinnedHostCommit !== 'string' || !/^[a-f0-9]{40}$/.test(pinnedHostCommit)
    || typeof hostBuildClaim !== 'string'
    || (persistRootInventory !== null && typeof persistRootInventory !== 'function')) {
    throw new TypeError('Host inventory handler configuration is invalid.');
  }

  return async function hostInventoryHandler(request, response) {
    response.set('Cache-Control', 'no-store, private');
    response.set('Vary', 'Cookie');
    const identity = getAuthenticatedHostIdentity(request, { requireDirectories: true, requireSessionIdentity: true });
    if (!identity) return response.sendStatus(403);
    const { userHandle, directories, session } = identity;
    const sessionId = session.logicEngineSessionId;

    // This is an operator-supplied deployment claim, not runtime source attestation.
    if (hostBuildClaim !== pinnedHostCommit) {
      return response.status(503).json({
        status: 'NON_READY',
        code: 'HOST_BUILD_NOT_PINNED',
      });
    }

    try {
      const requestedConversationUuid = request?.query?.conversation_uuid;
      if (typeof requestedConversationUuid !== 'string' || !HOST_SESSION_UUID.test(requestedConversationUuid)) {
        return response.status(400).json({
          status: 'NON_READY',
          code: 'HOST_CONVERSATION_UUID_INVALID',
        });
      }
      const inventory = await enumerate({
        directories: {
          root: directories.root,
          chats: directories.chats,
          groups: directories.groups,
          groupChats: directories.groupChats,
        },
        hostCommit: pinnedHostCommit,
      });
      if (inventory?.filesystem?.status !== 'complete'
        || !Array.isArray(inventory?.source?.files)
        || !Array.isArray(inventory?.source?.blockers)) {
        return response.status(503).json({
          status: 'NON_READY',
          code: 'SOURCE_INVENTORY_INVALID',
        });
      }
      const source = inventory.source;
      const filesystem = inventory.filesystem;
      let rootInventory = null;
      if (typeof persistRootInventory === 'function') {
        try {
          rootInventory = await persistRootInventory({
            userHandle,
            rootPath: directories.root,
            entries: filesystem.entries,
          });
        } catch {
          rootInventory = { status: 'NON_READY', reason: 'ROOT_INVENTORY_PERSISTENCE_FAILED' };
        }
      }
      const rootInventoryPersisted = rootInventory?.integrity_status === 'INTEGRITY_OK'
        && Number.isSafeInteger(rootInventory?.sequence)
        && rootInventory.sequence > 0
        && typeof rootInventory.manifest_sha256 === 'string'
        && /^[a-f0-9]{64}$/.test(rootInventory.manifest_sha256);
      const blockers = [
        ...source.blockers,
        ...(rootInventoryPersisted ? [] : [
          'NO_DURABLE_FULL_ROOT_BASELINE',
          'NO_FULL_ROOT_PER_FILE_DIFF',
        ]),
        ...(rootInventoryPersisted && rootInventory.status === 'NON_READY'
          ? ['ROOT_INVENTORY_DELTA_UNRESOLVED'] : []),
        'NO_GLOBAL_SILLYTAVERN_DATA_ROOT_COVERAGE',
        'NO_SEMANTIC_CHARACTER_PERSONA_IDENTITY',
        'UNVERIFIED_MUTATION_ROUTE_COVERAGE',
        'UNVERIFIED_MUTATION_RUNTIME_ACCEPTANCE',
        ...(inventory.snapshot_alignment === 'SHARED_VSS_SNAPSHOT'
          ? [] : ['NO_SHARED_POINT_IN_TIME_SNAPSHOT']),
      ];
      const responseInventory = {
        ...source,
        blockers: [...new Set(blockers)],
        filesystem_inventory: {
          status: filesystem.status,
          snapshot_sha256: filesystem.snapshot_sha256,
          file_count: filesystem.file_count,
          total_bytes: filesystem.total_bytes,
          scope: filesystem.scope ?? 'single-root-regular-files-only',
          snapshot_id: filesystem.snapshot_id ?? null,
          snapshot_provider: filesystem.snapshot_provider ?? null,
          snapshot_consistency: filesystem.snapshot_consistency ?? null,
          reparse_points: filesystem.reparse_points ?? null,
          snapshot_alignment: inventory.snapshot_alignment ?? 'UNKNOWN',
        },
        // The browser only receives the selected conversation's logical identities.
        // Do not send every chat locator or file identity to the browser.
        files: source.files.filter(file =>
          file?.logical_identity?.conversation_uuid === requestedConversationUuid)
          .map(file => ({ logical_identity: file.logical_identity })),
        requested_conversation_uuid: requestedConversationUuid,
        ...(rootInventoryPersisted ? {
          root_inventory_reconciliation: {
            status: rootInventory.status,
            integrity_status: rootInventory.integrity_status,
            sequence: rootInventory.sequence,
            manifest_sha256: rootInventory.manifest_sha256,
            ...(rootInventory.delta_sha256 ? { delta_sha256: rootInventory.delta_sha256 } : {}),
            ...(rootInventory.counts ? { counts: rootInventory.counts } : {}),
            ...(rootInventory.reason ? { reason: rootInventory.reason } : {}),
          },
        } : {
          root_inventory_reconciliation: {
            status: 'NON_READY',
            reason: rootInventory?.reason ?? 'ROOT_INVENTORY_PERSISTENCE_UNAVAILABLE',
          },
        }),
      };
      return response.status(200).json({
        ...responseInventory,
        host_user_handle: userHandle,
        host_build_claim: hostBuildClaim,
        host_build_claim_type: 'DEPLOYMENT_ASSERTION_NOT_RUNTIME_ATTESTATION',
      });
    } catch {
      // Never return absolute paths, chat IDs, file counts, or per-source failures on denial.
      return response.status(503).json({
        status: 'NON_READY',
        code: 'SOURCE_INVENTORY_UNAVAILABLE',
      });
    }
  };
}


/**
 * Issues a server-generated identity inside SillyTavern's authenticated,
 * signed cookie session. It is stable for that login session and rotates when
 * the authenticated account changes. It is not an installation attestation.
 */
export function createHostSessionHandler({ createId = randomUUID } = {}) {
  if (typeof createId !== 'function') throw new TypeError('createId must be a function');
  return function hostSessionHandler(request, response) {
    response.set('Cache-Control', 'no-store, private');
    response.set('Vary', 'Cookie');
    const identity = getAuthenticatedHostIdentity(request);
    if (!identity) return response.sendStatus(403);
    const { session, userHandle } = identity;

    const currentId = session.logicEngineSessionId;
    if (currentId !== undefined && !HOST_SESSION_UUID.test(currentId)) {
      return response.status(503).json({
        status: 'NON_READY',
        code: 'HOST_SESSION_ID_INVALID',
      });
    }

    let sessionId = currentId;
    if (!sessionId || session.logicEngineSessionHandle !== userHandle) {
      sessionId = createId();
      if (typeof sessionId !== 'string' || !HOST_SESSION_UUID.test(sessionId)) {
        return response.status(503).json({
          status: 'NON_READY',
          code: 'HOST_SESSION_ID_GENERATION_FAILED',
        });
      }
      session.logicEngineSessionId = sessionId;
      session.logicEngineSessionHandle = userHandle;
    }

    return response.status(200).json({
      host_session_id: sessionId,
      host_session_identity: 'SIGNED_AUTHENTICATED_ST_SESSION',
      host_user_handle: userHandle,
    });
  };
}

export function createHostBulkMutationGuard({
  enumerate = enumerateHostDataInventory,
  pinnedHostCommit,
} = {}) {
  if (typeof enumerate !== 'function' || typeof pinnedHostCommit !== 'string'
    || !/^[a-f0-9]{40}$/.test(pinnedHostCommit)) {
    throw new TypeError('Host bulk mutation guard configuration is invalid.');
  }
  return async function hostBulkMutationGuard(request, response, next) {
    response.set('Cache-Control', 'no-store, private');
    response.set('Vary', 'Cookie');
    // Character-card CRUD does not mutate chat files. Keep ordinary ST character editing
    // independent of full-root VSS inventory; destructive character deletion remains guarded.
    const route = `${request?.baseUrl ?? ''}${request?.path ?? ''}`.split('?')[0];
    if (request?.method === 'POST'
      && /\/characters\/(?:create|rename|edit|edit-avatar|edit-attribute|merge-attributes|import|duplicate)$/.test(route)) {
      return next();
    }
    const identity = getAuthenticatedHostIdentity(request, { requireDirectories: true });
    if (!identity) return response.sendStatus(403);
    const { directories } = identity;
    if (!['root', 'chats', 'groups', 'groupChats'].every(key =>
      typeof directories[key] === 'string' && path.isAbsolute(directories[key]))) {
      return response.sendStatus(403);
    }
    let inventory;
    try {
      inventory = await enumerate({
        directories: {
          root: directories.root,
          chats: directories.chats,
          groups: directories.groups,
          groupChats: directories.groupChats,
        },
        hostCommit: pinnedHostCommit,
      });
    } catch {
      return response.status(503).json({
        status: 'NON_READY',
        code: 'HOST_BULK_MUTATION_INVENTORY_UNAVAILABLE',
      });
    }
    if (inventory?.filesystem?.status !== 'complete'
      || inventory?.source?.status !== 'DOUBLE_SCAN_CANDIDATE'
      || !Array.isArray(inventory?.source?.files)) {
      return response.status(503).json({
        status: 'NON_READY',
        code: 'HOST_BULK_MUTATION_INVENTORY_INCOMPLETE',
      });
    }
    const hasEnrolledConversation = inventory.source.files.some(file =>
      typeof file?.logical_identity?.conversation_uuid === 'string'
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(file.logical_identity.conversation_uuid));
    if (hasEnrolledConversation) {
      return response.status(409).json({
        status: 'NON_READY',
        code: 'HOST_LIFECYCLE_BULK_MUTATION_BLOCKED',
      });
    }
    return next();
  };
}

export function createHostIdentityHandler({
  identityStore,
  getDataRoot = () => typeof globalThis.DATA_ROOT === 'string' && globalThis.DATA_ROOT.trim()
    ? path.resolve(globalThis.DATA_ROOT) : null,
}) {
  if (!identityStore || typeof identityStore.resolveAuthenticatedAccount !== 'function'
    || typeof identityStore.assertOutsideRoot !== 'function'
    || typeof getDataRoot !== 'function') {
    throw new TypeError('A server-owned Host identity store and trusted SillyTavern data-root resolver are required.');
  }
  return async function hostIdentityHandler(request, response) {
    response.set('Cache-Control', 'no-store, private');
    response.set('Vary', 'Cookie');
    const userHandle = request?.user?.profile?.handle;
    const session = request?.session;
    if (typeof userHandle !== 'string' || !userHandle.trim()
      || (session?.handle !== undefined && session.handle !== userHandle)
      || typeof session?.logicEngineSessionId !== 'string'
      || !HOST_SESSION_UUID.test(session.logicEngineSessionId)
      || session?.logicEngineSessionHandle !== userHandle) {
      return response.sendStatus(403);
    }
    try {
      const dataRoot = getDataRoot();
      if (typeof dataRoot !== 'string' || !path.isAbsolute(dataRoot)) {
        return response.status(503).json({ status: 'NON_READY', code: 'HOST_IDENTITY_DATA_ROOT_UNAVAILABLE' });
      }
      await identityStore.assertOutsideRoot(dataRoot);
      const identity = await identityStore.resolveAuthenticatedAccount(userHandle);
      return response.status(200).json({ ...identity, host_session_id: session.logicEngineSessionId });
    } catch (error) {
      // Expose only a bounded diagnostic token. Never return filesystem paths,
      // account handles, or raw exception text to the browser.
      const message = typeof error?.message === 'string' ? error.message : '';
      const reason = /^[A-Z0-9_]{1,96}$/.test(message)
        ? message
        : ['EACCES', 'EPERM', 'ENOENT', 'EEXIST', 'EINVAL', 'ENOTDIR', 'EISDIR'].includes(error?.code)
          ? error.code
          : 'UNKNOWN';
      return response.status(503).json({
        status: 'NON_READY',
        code: 'HOST_IDENTITY_UNAVAILABLE',
        reason,
      });
    }
  };
}
export function createHostLifecycleSaveGuard({ enumerate = enumerateHostDataInventory, pinnedHostCommit } = {}) {
  if (typeof enumerate !== 'function' || typeof pinnedHostCommit !== 'string' || !/^[a-f0-9]{40}$/.test(pinnedHostCommit)) throw new TypeError('Host lifecycle save guard configuration is invalid.');
  const supported = new Set(['create-message', 'message-send', 'message-receive', 'create-swipe', 'select-swipe', 'delete-swipe', 'delete-message', 'edit-message']);
  return async function hostLifecycleSaveGuard(request, response, next) {
    response.set('Cache-Control', 'no-store, private');
    response.set('Vary', 'Cookie');
    // Ordinary, unenrolled ST saves carry no stable conversation identity and no
    // prepared lifecycle permit. They must not depend on the VSS inventory service.
    // Any lifecycle-marked or prepared save still takes the fail-closed path below.
    const initialBody = request?.body;
    const initialHeader = Array.isArray(initialBody?.chat) ? initialBody.chat[0] : null;
    const initialConversationUuid = initialHeader?.chat_metadata?.logic_engine_conversation_id;
    const initialPermit = request?.session?.logicEngineHostPreparedMutation;
    if (initialConversationUuid === undefined && !initialPermit) return next();
    const userHandle = request?.user?.profile?.handle;
    const session = request?.session;
    if (typeof userHandle !== 'string' || !userHandle.trim() || (session?.handle !== undefined && session.handle !== userHandle) || session?.logicEngineSessionHandle !== userHandle || !HOST_SESSION_UUID.test(session?.logicEngineSessionId ?? '')) return response.sendStatus(403);
    const directories = resolveHostDataDirectories(request?.user?.directories);
    if (!directories) return response.sendStatus(403);
    let inventory;
    try { inventory = await enumerate({ directories: { root: directories.root, chats: directories.chats, groups: directories.groups, groupChats: directories.groupChats }, hostCommit: pinnedHostCommit }); }
    catch (error) {
      const reason = typeof error?.message === 'string' && /^[A-Z0-9_]{1,96}$/.test(error.message)
        ? error.message : 'UNKNOWN';
      return response.status(503).json({ status: 'NON_READY', code: 'HOST_LIFECYCLE_SAVE_INVENTORY_UNAVAILABLE', reason });
    }
    if (inventory?.filesystem?.status !== 'complete' || inventory?.source?.status !== 'DOUBLE_SCAN_CANDIDATE' || !Array.isArray(inventory?.source?.files)) {
      const safeCode = value => typeof value === 'string' && /^[A-Z0-9_]{1,96}$/.test(value) ? value : null;
      return response.status(503).json({
        status: 'NON_READY',
        code: 'HOST_LIFECYCLE_SAVE_INVENTORY_INCOMPLETE',
        filesystem_status: safeCode(inventory?.filesystem?.status),
        filesystem_code: safeCode(inventory?.filesystem?.code),
        source_status: safeCode(inventory?.source?.status),
        source_code: safeCode(inventory?.source?.code),
      });
    }
    const body = request?.body;
    const isGroup = request?.path === '/group/save' || request?.originalUrl?.split('?')[0]?.endsWith('/group/save');
    const locator = isGroup ? (typeof body?.id === 'string' ? body.id : '') : (typeof body?.avatar_url === 'string' && typeof body?.file_name === 'string' ? body.avatar_url.replace(/\.png$/i, '') + '/' + body.file_name + '.jsonl' : '');
    const slash = String.fromCharCode(92);
    const locatorParts = locator.split('/');
    if (!locator || locator.includes(slash)
      || locatorParts.length !== (isGroup ? 1 : 2)
      || locatorParts.some(part => !part || part === '.' || part === '..')) {
      return response.status(400).json({ status: 'NON_READY', code: 'HOST_LIFECYCLE_SAVE_TARGET_INVALID' });
    }
    const kind = isGroup ? 'group-chat' : 'character-chat';
    const targets = inventory.source.files.filter(file => file?.kind === kind && file?.locator === locator);
    if (targets.length > 1) return response.status(503).json({ status: 'NON_READY', code: 'HOST_LIFECYCLE_SAVE_TARGET_AMBIGUOUS' });
    const target = targets[0];
    const anyEnrolled = inventory.source.files.some(file => typeof file?.logical_identity?.conversation_uuid === 'string' && HOST_SESSION_UUID.test(file.logical_identity.conversation_uuid));
    if (!target) return anyEnrolled ? response.status(409).json({ status: 'NON_READY', code: 'HOST_LIFECYCLE_SAVE_TARGET_NOT_ENROLLED' }) : next();
    const conversationUuid = target.logical_identity?.conversation_uuid;
    if (typeof conversationUuid !== 'string' || !HOST_SESSION_UUID.test(conversationUuid)) return response.status(409).json({ status: 'NON_READY', code: 'HOST_LIFECYCLE_SAVE_TARGET_IDENTITY_INVALID' });
    const submittedHeader = Array.isArray(body?.chat) ? body.chat[0] : null;
    const submittedConversationUuid = submittedHeader?.chat_metadata?.logic_engine_conversation_id;
    if (submittedConversationUuid !== conversationUuid) {
      return response.status(409).json({ status: 'NON_READY', code: 'HOST_LIFECYCLE_SAVE_PAYLOAD_IDENTITY_MISMATCH' });
    }
    const permit = session.logicEngineHostPreparedMutation;
    if (!permit || permit.protocol_version !== 1 || permit.host_session_id !== session.logicEngineSessionId || permit.conversation_uuid !== conversationUuid || !supported.has(permit.operation) || !HOST_SESSION_UUID.test(permit.mutation_id ?? '') || !HOST_SESSION_UUID.test(permit.event_id ?? '') || !/^[a-f0-9]{64}$/.test(permit.mutation_digest ?? '')) return response.status(409).json({ status: 'NON_READY', code: 'HOST_LIFECYCLE_PREPARED_SAVE_REQUIRED' });
    delete session.logicEngineHostPreparedMutation;
    request.logicEngineLifecycleSaveAuthorized = true;
    request.logicEngineLifecycleOperation = permit.operation;
    return next();
  };
}

const HOST_CONVERSATION_ID = new RegExp(
  '^' + HOST_SESSION_UUID.source.slice(1, -1) + ':'
    + HOST_SESSION_UUID.source.slice(1, -1) + ':'
    + HOST_SESSION_UUID.source.slice(1, -1) + '$',
  'i',
);

/**
 * Process-local request capability for an in-process Core adapter. The resolver
 * must map the exact authenticated request to canonical server-owned chat state.
 */
export function createHostRequestAuthenticationGate({ resolveConversationId } = {}) {
  if (typeof resolveConversationId !== 'function') {
    throw new TypeError('A trusted Host conversation resolver is required.');
  }
  const authenticatedRequests = new WeakMap();
  async function middleware(request, response, next) {
    response.set('Cache-Control', 'no-store, private');
    response.set('Vary', 'Cookie');
    const identity = getAuthenticatedHostIdentity(request, {
      requireDirectories: true,
      requireSessionIdentity: true,
    });
    if (!identity || (typeof request !== 'object' && typeof request !== 'function') || request === null) {
      return response.sendStatus(403);
    }
    try {
      const binding = await resolveConversationId(request);
      if (binding === null || binding === undefined || binding?.status === 'NON_READY') {
        return response.status(503).json({
          status: 'NON_READY',
          code: binding?.code === 'HOST_INVENTORY_NOT_AUTHORITATIVE'
            ? binding.code : 'HOST_CONTEXT_UNAVAILABLE',
        });
      }
      const sessionId = identity.session.logicEngineSessionId;
      const validUuid = value => typeof value === 'string' && HOST_SESSION_UUID.test(value);
      const exactBinding = binding && typeof binding === 'object' && !Array.isArray(binding)
        && Object.getPrototypeOf(binding) === Object.prototype
        && Object.keys(binding).sort().join(',') ===
          'authenticated_account_id,conversation_id,host_installation_id,host_session_id';
      if (!exactBinding
        || !validUuid(binding.host_installation_id)
        || !validUuid(binding.authenticated_account_id)
        || !validUuid(binding.host_session_id)
        || binding.host_session_id !== sessionId
        || typeof binding.conversation_id !== 'string'
        || !HOST_CONVERSATION_ID.test(binding.conversation_id)) {
        return response.sendStatus(403);
      }
      const parts = binding.conversation_id.split(':');
      if (parts[0] !== binding.host_installation_id
        || parts[1] !== binding.authenticated_account_id
        || !validUuid(parts[2])) return response.sendStatus(403);
      authenticatedRequests.set(request, Object.freeze({
        host_installation_id: binding.host_installation_id,
        authenticated_account_id: binding.authenticated_account_id,
        host_session_id: binding.host_session_id,
        conversation_id: binding.conversation_id,
      }));
      return next();
    } catch {
      return response.sendStatus(403);
    }
  }
  return Object.freeze({
    middleware,
    isAuthenticatedHostRequest(request) {
      return request !== null && (typeof request === 'object' || typeof request === 'function')
        && authenticatedRequests.has(request);
    },
    resolveHostConversationId(request) {
      return request !== null && (typeof request === 'object' || typeof request === 'function')
        ? authenticatedRequests.get(request)?.conversation_id ?? null : null;
    },
    resolveHostContext(request) {
      return request !== null && (typeof request === 'object' || typeof request === 'function')
        ? authenticatedRequests.get(request) ?? null : null;
    },
  });
}
