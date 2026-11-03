import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { lstat, open } from 'node:fs/promises';
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
  verifySourceIdentity = null,
  persistRootInventory = null,
}) {
  if (typeof enumerate !== 'function'
    || typeof pinnedHostCommit !== 'string' || !/^[a-f0-9]{40}$/.test(pinnedHostCommit)
    || typeof hostBuildClaim !== 'string'
    || (verifySourceIdentity !== null && typeof verifySourceIdentity !== 'function')
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
    if (hostBuildClaim && hostBuildClaim !== pinnedHostCommit) {
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
      let sourceIdentity = { status: 'NON_READY', code: 'HOST_SOURCE_IDENTITY_VERIFIER_UNAVAILABLE' };
      if (typeof verifySourceIdentity === 'function') {
        try { sourceIdentity = await verifySourceIdentity(); } catch {}
      }
      let rootInventory = null;
      if (typeof persistRootInventory === 'function') {
        try {
          rootInventory = await persistRootInventory({
            userHandle,
            rootPath: directories.root,
            entries: filesystem.entries,
            snapshotAlignment: inventory.snapshot_alignment,
            snapshotSha256: filesystem.snapshot_sha256,
            sourceIdentity,
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
      const rootInventoryAuthoritative = rootInventoryPersisted
        && rootInventory.status === 'AUTHORITATIVE_COMPLETE';
      const sourceSnapshotAttested = rootInventoryAuthoritative
        && sourceIdentity?.status === 'CURRENT_IDENTITIES_VERIFIED'
        && inventory.snapshot_alignment === 'SHARED_VSS_SNAPSHOT';
      const coveredSourceBlockers = new Set([
        'NO_PRE_ENROLLMENT_DELETED_HISTORY',
        'NO_COMPLETE_MESSAGE_OR_SWIPE_REVISION_HISTORY',
        'NO_HOST_INSTALLATION_BINDING',
        'NO_CORE_WORLD_OR_SESSION_AUTHORIZATION',
        'NO_ACCEPTED_HEAD_AUTHORITY',
        'IMPORT_EXPORT_COPY_BRANCH_RESTORE_UNSUPPORTED',
        'NO_APPLICATION_LEVEL_ATOMIC_SNAPSHOT',
        'PLATFORM_SPECIFIC_RACE_RESISTANCE_REQUIRES_SECURITY_REVIEW',
      ]);
      const sourceBlockers = sourceSnapshotAttested
        ? source.blockers.filter(code => !coveredSourceBlockers.has(code))
        : source.blockers;
      const blockers = [
        ...sourceBlockers,
        ...(rootInventoryPersisted ? [] : [
          'NO_DURABLE_FULL_ROOT_BASELINE',
          'NO_FULL_ROOT_PER_FILE_DIFF',
        ]),
        ...(rootInventoryPersisted && rootInventory.status === 'NON_READY'
          ? ['ROOT_INVENTORY_DELTA_UNRESOLVED'] : []),
        ...(sourceIdentity?.status === 'CURRENT_IDENTITIES_VERIFIED'
          ? [] : ['UNVERIFIED_PINNED_SOURCE_IDENTITY']),
        ...(sourceIdentity?.status === 'CURRENT_IDENTITIES_VERIFIED'
          ? [] : ['UNVERIFIED_MUTATION_ROUTE_COVERAGE']),
        ...(sourceIdentity?.status === 'CURRENT_IDENTITIES_VERIFIED'
          && inventory.snapshot_alignment === 'SHARED_VSS_SNAPSHOT'
          ? [] : ['UNVERIFIED_MUTATION_RUNTIME_ACCEPTANCE']),
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
        host_build_claim_type: hostBuildClaim ? 'DEPLOYMENT_ASSERTION_ONLY' : 'ABSENT',
        host_source_identity_status: sourceIdentity?.status ?? 'NON_READY',
        ...(sourceIdentity?.manifest_sha256 ? { host_source_manifest_sha256: sourceIdentity.manifest_sha256 } : {}),
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
export function createHostSessionHandler({ createId = randomUUID, revokeSession = null } = {}) {
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

    const sendSession = sessionId => response.status(200).json({
      host_session_id: sessionId,
      host_session_identity: 'SIGNED_AUTHENTICATED_ST_SESSION',
      host_user_handle: userHandle,
    });
    const issueReplacement = () => {
      const sessionId = createId();
      if (typeof sessionId !== 'string' || !HOST_SESSION_UUID.test(sessionId)) {
        return response.status(503).json({
          status: 'NON_READY',
          code: 'HOST_SESSION_ID_GENERATION_FAILED',
        });
      }
      session.logicEngineSessionId = sessionId;
      session.logicEngineSessionHandle = userHandle;
      return sendSession(sessionId);
    };

    let sessionId = currentId;
    if (sessionId && session.logicEngineSessionHandle !== userHandle) {
      if (typeof revokeSession !== 'function') {
        return response.status(503).json({ status: 'NON_READY', code: 'HOST_SESSION_REVOCATION_UNAVAILABLE' });
      }
      return Promise.resolve()
        .then(() => revokeSession(request, 'session_rotation'))
        .then(revoked => revoked === true
          ? issueReplacement()
          : response.status(503).json({
            status: 'NON_READY',
            code: 'HOST_SESSION_REVOCATION_UNAVAILABLE',
          }))
        .catch(() => response.status(503).json({
          status: 'NON_READY',
          code: 'HOST_SESSION_REVOCATION_UNAVAILABLE',
        }));
    }
    if (!sessionId) return issueReplacement();
    return sendSession(sessionId);
  };
}

/**
 * Fail-closed guard for ST mutation routes that do not yet have an operation-
 * specific persisted lifecycle receipt. These routes may change the enrolled
 * account root or the installed source, so they cannot run while Host authority
 * is configured. This is a route guard, not an inventory completeness proof.
 */
export function createHostUnsupportedMutationGuard({
  code = 'HOST_MUTATION_ROUTE_UNSUPPORTED',
} = {}) {
  if (typeof code !== 'string' || !/^[A-Z0-9_]{1,96}$/.test(code)) {
    throw new TypeError('Host unsupported mutation guard code is invalid.');
  }
  return function hostUnsupportedMutationGuard(request, response, next) {
    response.set('Cache-Control', 'no-store, private');
    response.set('Vary', 'Cookie');
    const hostConfigured = Boolean(process.env.LOGIC_ENGINE_HOST_IDENTITY_DIR);
    const hostSessionActive = typeof request?.session?.logicEngineSessionId === 'string'
      && request.session.logicEngineSessionId.length > 0;
    if (!hostConfigured && !hostSessionActive) return next();
    return response.status(503).json({
      status: 'NON_READY',
      code,
    });
  };
}

/**
 * Fail-closed guard for bulk or non-lineage-aware mutations. A pre-mutation
 * filesystem scan cannot authorize a write: it cannot prove route coverage,
 * prevent a concurrent write, or produce a post-mutation receipt. Until the
 * route has an operation-specific lifecycle receipt, reject it whenever Host
 * authority is configured or a Host session is present.
 */
export function createHostBulkMutationGuard({
  enumerate = enumerateHostDataInventory,
  pinnedHostCommit,
} = {}) {
  if (typeof enumerate !== 'function' || typeof pinnedHostCommit !== 'string'
    || !/^[a-f0-9]{40}$/.test(pinnedHostCommit)) {
    throw new TypeError('Host bulk mutation guard configuration is invalid.');
  }
  return function hostBulkMutationGuard(request, response, next) {
    response.set('Cache-Control', 'no-store, private');
    response.set('Vary', 'Cookie');
    const hostConfigured = Boolean(process.env.LOGIC_ENGINE_HOST_IDENTITY_DIR);
    const hostSessionActive = typeof request?.session?.logicEngineSessionId === 'string'
      && request.session.logicEngineSessionId.length > 0;
    if (!hostConfigured && !hostSessionActive) return next();
    return response.status(503).json({
      status: 'NON_READY',
      code: 'HOST_BULK_MUTATION_UNSUPPORTED',
    });
  };
}

export async function assertHostStartupMigrationAllowed({
  directories,
  pinnedHostCommit,
  enumerate = enumerateHostDataInventory,
} = {}) {
  if (typeof enumerate !== 'function'
    || typeof pinnedHostCommit !== 'string'
    || !/^[a-f0-9]{40}$/.test(pinnedHostCommit)) {
    throw new Error('HOST_LIFECYCLE_STARTUP_MIGRATION_CONFIGURATION_INVALID');
  }
  if (process.env.LOGIC_ENGINE_HOST_IDENTITY_DIR) {
    throw new Error('HOST_LIFECYCLE_STARTUP_MIGRATION_BLOCKED');
  }\n  const resolved = resolveHostDataDirectories(directories);
  if (!resolved) throw new Error('HOST_LIFECYCLE_STARTUP_MIGRATION_DIRECTORIES_INVALID');

  let inventory;
  try {
    inventory = await enumerate({ directories: resolved, hostCommit: pinnedHostCommit });
  } catch {
    throw new Error('HOST_LIFECYCLE_STARTUP_MIGRATION_INVENTORY_UNAVAILABLE');
  }
  if (inventory?.filesystem?.status !== 'complete'
    || inventory?.source?.status !== 'DOUBLE_SCAN_CANDIDATE'
    || !Array.isArray(inventory.source.files)) {
    throw new Error('HOST_LIFECYCLE_STARTUP_MIGRATION_INVENTORY_NON_READY');
  }
  const hasEnrolledConversation = inventory.source.files.some(file =>
    typeof file?.logical_identity?.conversation_uuid === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(file.logical_identity.conversation_uuid));
  if (hasEnrolledConversation) {
    throw new Error('HOST_LIFECYCLE_STARTUP_MIGRATION_BLOCKED');
  }
  return true;
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
async function inspectSaveTargetEnrollment(directories, isGroup, locatorParts) {
  const root = path.resolve(directories.root);
  const base = path.resolve(isGroup ? directories.groupChats : directories.chats);
  const baseRelative = path.relative(root, base);
  if (!baseRelative || baseRelative === '..' || baseRelative.startsWith('..' + path.sep)
    || path.isAbsolute(baseRelative)) return 'unknown';

  let parent = base;
  const parentSegments = locatorParts.slice(0, -1);
  for (const segment of parentSegments) {
    const stat = await lstat(parent, { bigint: true }).catch(() => null);
    if (!stat?.isDirectory() || stat.isSymbolicLink()) return 'unknown';
    parent = path.join(parent, segment);
  }
  const finalParentStat = await lstat(parent, { bigint: true }).catch(() => null);
  if (!finalParentStat?.isDirectory() || finalParentStat.isSymbolicLink()) return 'unknown';

  const targetPath = path.join(parent, locatorParts.at(-1));
  const initial = await lstat(targetPath, { bigint: true }).catch(error =>
    error?.code === 'ENOENT' ? null : undefined);
  if (initial === null) return 'missing';
  if (!initial || initial.isSymbolicLink() || !initial.isFile() || initial.size === 0n) return 'unknown';

  let handle;
  try {
    handle = await open(targetPath, 'r');
    const opened = await handle.stat({ bigint: true });
    const sameFile = initial.ino !== 0n && opened.ino !== 0n
      && initial.ino === opened.ino
      && initial.mode === opened.mode
      && initial.size === opened.size
      && initial.mtimeNs === opened.mtimeNs
      && initial.ctimeNs === opened.ctimeNs
      && (initial.dev === 0n || opened.dev === 0n || initial.dev === opened.dev);
    if (!sameFile) return 'unknown';

    const maxHeaderBytes = 16 * 1024 * 1024;
    const chunks = [];
    let offset = 0;
    let header = null;
    while (offset <= maxHeaderBytes) {
      const buffer = Buffer.alloc(Math.min(64 * 1024, maxHeaderBytes + 1 - offset));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
      if (bytesRead === 0) {
        header = Buffer.concat(chunks);
        break;
      }
      const chunk = buffer.subarray(0, bytesRead);
      const newline = chunk.indexOf(0x0a);
      if (newline >= 0) {
        chunks.push(chunk.subarray(0, newline));
        header = Buffer.concat(chunks);
        break;
      }
      chunks.push(Buffer.from(chunk));
      offset += bytesRead;
      if (offset > maxHeaderBytes) return 'unknown';
    }
    if (!header?.length) return 'unknown';
    if (header[header.length - 1] === 0x0d) header = header.subarray(0, -1);
    if (header.length >= 3 && header[0] === 0xef && header[1] === 0xbb && header[2] === 0xbf) {
      header = header.subarray(3);
    }
    const record = JSON.parse(header.toString('utf8'));
    if (!record || typeof record !== 'object' || Array.isArray(record)) return 'unknown';
    const metadata = record.chat_metadata;
    if (metadata === undefined) return 'unenrolled';
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return 'unknown';
    const conversationUuid = metadata.logic_engine_conversation_id;
    if (conversationUuid === undefined || conversationUuid === null) return 'unenrolled';
    return typeof conversationUuid === 'string' && HOST_SESSION_UUID.test(conversationUuid)
      ? 'enrolled' : 'unknown';
  } catch {
    return 'unknown';
  } finally {
    await handle?.close().catch(() => {});
  }
}

export function createHostLifecycleSaveGuard({ enumerate = enumerateHostDataInventory, pinnedHostCommit } = {}) {
  if (typeof enumerate !== 'function' || typeof pinnedHostCommit !== 'string' || !/^[a-f0-9]{40}$/.test(pinnedHostCommit)) throw new TypeError('Host lifecycle save guard configuration is invalid.');
  const supported = new Set(['create-message', 'message-send', 'message-receive', 'create-swipe', 'select-swipe', 'delete-swipe', 'delete-message', 'edit-message']);
  return async function hostLifecycleSaveGuard(request, response, next) {
    response.set('Cache-Control', 'no-store, private');
    response.set('Vary', 'Cookie');
    const userHandle = request?.user?.profile?.handle;
    const session = request?.session;
    if (typeof userHandle !== 'string' || !userHandle.trim() || (session?.handle !== undefined && session.handle !== userHandle) || session?.logicEngineSessionHandle !== userHandle || !HOST_SESSION_UUID.test(session?.logicEngineSessionId ?? '')) return response.sendStatus(403);
    const directories = resolveHostDataDirectories(request?.user?.directories);
    if (!directories) return response.sendStatus(403);

    const body = request?.body;
    const isGroup = request?.path === '/group/save' || request?.originalUrl?.split('?')[0]?.endsWith('/group/save');
    const locator = isGroup
      ? (typeof body?.id === 'string' ? body.id : '')
      : (typeof body?.avatar_url === 'string' && typeof body?.file_name === 'string'
        ? body.avatar_url.replace(/\.png$/i, '') + '/' + body.file_name + '.jsonl' : '');
    const slash = String.fromCharCode(92);
    const locatorParts = locator.split('/');
    if (!locator || locator.includes(slash)
      || locatorParts.length !== (isGroup ? 1 : 2)
      || locatorParts.some(part => !part || part === '.' || part === '..')) {
      return response.status(400).json({ status: 'NON_READY', code: 'HOST_LIFECYCLE_SAVE_TARGET_INVALID' });
    }

    const submittedHeader = Array.isArray(body?.chat) ? body.chat[0] : null;
    const submittedConversationUuid = submittedHeader?.chat_metadata?.logic_engine_conversation_id;

    // Ordinary SillyTavern chats are not Host-enrolled and must remain writable
    // even when VSS is unavailable. Inspect only the exact target: if it is
    // absent or its stable first JSONL record has no Host conversation identity,
    // the lifecycle receipt guard does not apply. Any enrolled or ambiguous
    // target still goes through the full shared VSS inventory below.
    if (submittedConversationUuid === undefined || submittedConversationUuid === null) {
      const targetEnrollment = await inspectSaveTargetEnrollment(directories, isGroup, locatorParts);
      if (targetEnrollment === 'missing' || targetEnrollment === 'unenrolled') return next();
    }

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
    const kind = isGroup ? 'group-chat' : 'character-chat';
    const targets = inventory.source.files.filter(file => file?.kind === kind && file?.locator === locator);
    if (targets.length > 1) return response.status(503).json({ status: 'NON_READY', code: 'HOST_LIFECYCLE_SAVE_TARGET_AMBIGUOUS' });
    const target = targets[0];
    const anyEnrolled = inventory.source.files.some(file => typeof file?.logical_identity?.conversation_uuid === 'string' && HOST_SESSION_UUID.test(file.logical_identity.conversation_uuid));
    if (!target) return anyEnrolled ? response.status(409).json({ status: 'NON_READY', code: 'HOST_LIFECYCLE_SAVE_TARGET_NOT_ENROLLED' }) : next();
    const conversationUuid = target.logical_identity?.conversation_uuid;
    if (typeof conversationUuid !== 'string' || !HOST_SESSION_UUID.test(conversationUuid)) return response.status(409).json({ status: 'NON_READY', code: 'HOST_LIFECYCLE_SAVE_TARGET_IDENTITY_INVALID' });
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
