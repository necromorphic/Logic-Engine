import { randomUUID } from 'node:crypto';

const HOST_SESSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createHostInventoryHandler({
  enumerate,
  pinnedHostCommit,
  hostBuildClaim,
}) {
  if (typeof enumerate !== 'function'
    || typeof pinnedHostCommit !== 'string' || !/^[a-f0-9]{40}$/.test(pinnedHostCommit)
    || typeof hostBuildClaim !== 'string') {
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
          chats: directories.chats,
          groups: directories.groups,
          groupChats: directories.groupChats,
        },
        hostCommit: pinnedHostCommit,
      });
      if (!Array.isArray(inventory.files)) {
        return response.status(503).json({
          status: 'NON_READY',
          code: 'SOURCE_INVENTORY_INVALID',
        });
      }
      const responseInventory = {
        ...inventory,
        // The browser only receives the selected conversation's logical identities.
        // Do not send every chat locator or file identity to the browser.
        files: inventory.files.filter(file =>
          file?.logical_identity?.conversation_uuid === requestedConversationUuid)
          .map(file => ({ logical_identity: file.logical_identity })),
        requested_conversation_uuid: requestedConversationUuid,
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
