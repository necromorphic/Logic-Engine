import { randomUUID } from 'node:crypto';
import path from 'node:path';

const HOST_SESSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    const user = request?.user;
    const directories = user?.directories;
    const userHandle = user?.profile?.handle;
    const sessionHandle = request?.session?.handle;
    const sessionId = request?.session?.logicEngineSessionId;
    const sessionIdentityHandle = request?.session?.logicEngineSessionHandle;
    if (!directories || typeof userHandle !== 'string' || !userHandle.trim()
      || typeof sessionHandle !== 'string' || sessionHandle !== userHandle
      || typeof sessionId !== 'string' || !HOST_SESSION_UUID.test(sessionId)
      || sessionIdentityHandle !== userHandle) {
      return response.sendStatus(403);
    }

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
    const session = request?.session;
    const userHandle = request?.user?.profile?.handle;
    if (!session || typeof userHandle !== 'string' || !userHandle.trim()
      || typeof session.handle !== 'string' || session.handle !== userHandle) {
      return response.sendStatus(403);
    }

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
    const directories = request?.user?.directories;
    if (!directories || !['root', 'chats', 'groups', 'groupChats'].every(key =>
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

export function createHostIdentityHandler({ identityStore }) {
  if (!identityStore || typeof identityStore.resolveAuthenticatedAccount !== 'function') {
    throw new TypeError('A server-owned Host identity store is required.');
  }
  return async function hostIdentityHandler(request, response) {
    response.set('Cache-Control', 'no-store, private');
    response.set('Vary', 'Cookie');
    const userHandle = request?.user?.profile?.handle;
    const session = request?.session;
    if (typeof userHandle !== 'string' || !userHandle.trim()
      || session?.handle !== userHandle
      || typeof session?.logicEngineSessionId !== 'string'
      || !HOST_SESSION_UUID.test(session.logicEngineSessionId)
      || session?.logicEngineSessionHandle !== userHandle) {
      return response.sendStatus(403);
    }
    try {
      const identity = await identityStore.resolveAuthenticatedAccount(userHandle);
      return response.status(200).json({ ...identity, host_session_id: session.logicEngineSessionId });
    } catch {
      return response.status(503).json({ status: 'NON_READY', code: 'HOST_IDENTITY_UNAVAILABLE' });
    }
  };
}
