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
    // SillyTavern may expose DEFAULT_USER when accounts are disabled. A user
    // object/profile handle alone is not proof of an authenticated account session.
    if (!directories || typeof userHandle !== 'string' || !userHandle.trim()
      || typeof sessionHandle !== 'string' || !sessionHandle.trim()
      || sessionHandle !== userHandle) {
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
      const inventory = await enumerate({
        directories: {
          chats: directories.chats,
          groups: directories.groups,
          groupChats: directories.groupChats,
        },
        hostCommit: pinnedHostCommit,
      });
      return response.status(200).json({
        ...inventory,
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
