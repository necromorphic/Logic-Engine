import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readFile, lstat, realpath, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { scanHostArtifactRoots } from './logic-engine-host-inventory.mjs';
import { scanPersistedConversationInventories } from './logic-engine-persisted-conversation-inventory.mjs';

const MUTATIONS = new Map([
    ['POST /api/chats/save', 'chat-save'],
    ['POST /api/chats/rename', 'chat-rename'],
    ['POST /api/chats/delete', 'chat-delete'],
    ['POST /api/chats/group/import', 'group-chat-import'],
    ['POST /api/chats/import', 'chat-import'],
    ['POST /api/chats/group/delete', 'group-chat-delete'],
    ['POST /api/chats/group/save', 'group-chat-save'],
    ['POST /api/characters/create', 'character-create'],
    ['POST /api/characters/rename', 'character-rename'],
    ['POST /api/characters/edit-avatar', 'character-edit-avatar'],
    ['POST /api/characters/edit', 'character-edit'],
    ['POST /api/characters/edit-attribute', 'character-edit-attribute'],
    ['POST /api/characters/merge-attributes', 'character-merge-attributes'],
    ['POST /api/characters/delete', 'character-delete'],
    ['POST /api/characters/import', 'character-import'],
    ['POST /api/characters/duplicate', 'character-duplicate'],
    ['POST /api/groups/create', 'group-create'],
    ['POST /api/groups/edit', 'group-edit'],
    ['POST /api/groups/delete', 'group-delete'],
    ['POST /api/backups/chat/delete', 'backup-delete'],
    ['POST /api/data-maid/delete', 'data-maid-delete'],
    ['POST /api/users/reset-step2', 'user-root-reset'],
]);

const ENROLLMENT_MARKER_NAME = '.logic-engine-host-enrollment-marker';
const SAVE_CAPABILITY_TTL_MS = 15_000;
const saveCapabilities = new Map();
const digest = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value);
const stableValue = value => {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
    }
    return value;
};
function hasEnrolledChatUnderCharacter(registry, avatarUrl) {
    if (typeof avatarUrl !== 'string' || !avatarUrl) return false;
    const characterDirectory = path.parse(avatarUrl).name;
    if (!characterDirectory || characterDirectory === '.' || characterDirectory === '..') return false;
    const prefix = characterDirectory + '/';
    return registry.conversations.some(conversation => conversation.domain === 'chats'
        && typeof conversation.sourcePath === 'string'
        && conversation.sourcePath.startsWith(prefix));
}

async function targetUserHasEnrolledState(directories) {
    const rootPath = directories?.root;
    const chatRootPath = directories?.chats;
    if (typeof rootPath !== 'string' || !path.isAbsolute(rootPath)
        || typeof chatRootPath !== 'string' || !path.isAbsolute(chatRootPath)) {
        throw new Error('HOST_JOURNAL_UNAVAILABLE');
    }
    const resolvedRoot = path.resolve(rootPath);
    const resolvedChatRoot = path.resolve(chatRootPath);
    if (path.dirname(resolvedChatRoot) !== resolvedRoot) throw new Error('HOST_TARGET_USER_SCOPE_MISMATCH');
    try {
        const rootStat = await lstat(resolvedRoot);
        if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('HOST_TARGET_USER_ROOT_UNSAFE');
    } catch (error) {
        if (error?.code === 'ENOENT') return false;
        throw error;
    }
    const chatStat = await lstat(resolvedChatRoot);
    if (!chatStat.isDirectory() || chatStat.isSymbolicLink()) throw new Error('HOST_TARGET_USER_CHAT_ROOT_UNSAFE');
    const canonicalRoot = await realpath(resolvedRoot);
    const canonicalChatRoot = await realpath(resolvedChatRoot);
    if (path.dirname(canonicalChatRoot) !== canonicalRoot) throw new Error('HOST_TARGET_USER_CANONICAL_SCOPE_MISMATCH');
    const userRoot = canonicalRoot;
    const markerPath = path.join(userRoot, ENROLLMENT_MARKER_NAME);
    const stateDirectory = path.join(userRoot, '.logic-engine-host');
    let markerExists = false;
    try {
        const markerStat = await lstat(markerPath);
        if (!markerStat.isFile() || markerStat.isSymbolicLink()) throw new Error('HOST_TARGET_USER_MARKER_UNSAFE');
        markerExists = true;
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
    let stateExists = false;
    try {
        const stateStat = await lstat(stateDirectory);
        if (!stateStat.isDirectory() || stateStat.isSymbolicLink()) throw new Error('HOST_TARGET_USER_STATE_UNSAFE');
        stateExists = true;
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
    if (!stateExists) {
        if (markerExists) throw new Error('HOST_TARGET_USER_ENROLLMENT_STATE_LOST');
        return false;
    }
    let registry;
    try {
        registry = await readRegistry(path.join(stateDirectory, 'enrollments.json'));
    } catch {
        throw new Error('HOST_TARGET_USER_REGISTRY_UNAVAILABLE');
    }
    if (registry.conversations.length > 0) return true;
    throw new Error('HOST_TARGET_USER_ENROLLMENT_STATE_AMBIGUOUS');
}


const validHostUuid = value => typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const hostTextDigest = value => digest(JSON.stringify(String(value)));
const sameFileIdentity = (a, b) => a.dev === b.dev
    && (a.ino === b.ino || (process.platform === 'win32' && (!a.ino || !b.ino)));
const sameFileStat = (a, b) => (process.platform === 'win32' || sameFileIdentity(a, b))
    && a.size === b.size && a.mtimeMs === b.mtimeMs;

function purgeExpiredSaveCapabilities(now = Date.now()) {
    for (const [token, capability] of saveCapabilities) {
        if (capability.expiresAt <= now) saveCapabilities.delete(token);
    }
}

function resolveSaveTarget(route, payload) {
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.chat) || !payload.chat.length) {
        throw new Error('HOST_SAVE_PAYLOAD_INVALID');
    }
    if (route === '/api/chats/save') {
        if (typeof payload.avatar_url !== 'string' || typeof payload.file_name !== 'string') {
            throw new Error('HOST_SAVE_TARGET_INVALID');
        }
        const avatar = payload.avatar_url.replace(/\.png$/i, '');
        const fileName = payload.file_name;
        if (!avatar || path.isAbsolute(avatar) || avatar.includes('\\')
            || avatar.split('/').some(part => !part || part === '.' || part === '..')
            || path.parse(fileName).name !== fileName || fileName.includes('/') || fileName.includes('\\')
            || !fileName || fileName === '.' || fileName === '..') {
            throw new Error('HOST_SAVE_TARGET_INVALID');
        }
        return { route, operation: 'chat-save', domain: 'chats', sourcePath: avatar + '/' + fileName + '.jsonl' };
    }
    if (route === '/api/chats/group/save') {
        if (typeof payload.id !== 'string' || path.parse(payload.id).name !== payload.id
            || !payload.id || payload.id === '.' || payload.id === '..'
            || payload.id.includes('/') || payload.id.includes('\\')) {
            throw new Error('HOST_SAVE_TARGET_INVALID');
        }
        return { route, operation: 'group-chat-save', domain: 'group_chats', sourcePath: payload.id + '.jsonl' };
    }
    throw new Error('HOST_SAVE_ROUTE_UNSUPPORTED');
}

function projectHostChatRecords(records, expectedConversationUuid) {
    if (!Array.isArray(records) || !records.length
        || !records.every(record => record && typeof record === 'object' && !Array.isArray(record))) {
        throw new Error('HOST_SAVE_CHAT_MALFORMED');
    }
    const marker = records[0]?.chat_metadata?.logic_engine_conversation_id;
    if (!validHostUuid(marker) || marker !== expectedConversationUuid) {
        throw new Error('HOST_SAVE_CONVERSATION_MARKER_MISMATCH');
    }
    const messageIds = new Set();
    const versionIds = new Set();
    const messages = [];
    for (const message of records.slice(1)) {
        const identity = message?._logicEngineLifecycle;
        const nativeVersions = Array.isArray(message?.swipes) && message.swipes.length
            ? message.swipes : [message?.mes ?? ''];
        const activeVersionIndex = message?.swipe_id === undefined ? 0 : message.swipe_id;
        if (!identity || !validHostUuid(identity.messageId) || messageIds.has(identity.messageId)
            || !Array.isArray(identity.versions) || identity.versions.length !== nativeVersions.length
            || !Number.isInteger(activeVersionIndex) || activeVersionIndex < 0
            || activeVersionIndex >= nativeVersions.length
            || identity.activeVersionIndex !== activeVersionIndex
            || typeof message.mes !== 'string' || nativeVersions.some(value => typeof value !== 'string')
            || message.mes !== nativeVersions[activeVersionIndex]) {
            throw new Error('HOST_SAVE_MESSAGE_IDENTITY_INVALID');
        }
        messageIds.add(identity.messageId);
        const versions = [];
        for (let index = 0; index < nativeVersions.length; index++) {
            const version = identity.versions[index];
            if (!version || !validHostUuid(version.versionId) || versionIds.has(version.versionId)
                || typeof version.payloadDigest !== 'string'
                || !/^[a-f0-9]{64}$/.test(version.payloadDigest)
                || version.payloadDigest !== hostTextDigest(nativeVersions[index])
                || (version.parentVersionId != null && !validHostUuid(version.parentVersionId))) {
                throw new Error('HOST_SAVE_VERSION_IDENTITY_INVALID');
            }
            versionIds.add(version.versionId);
            versions.push({
                versionId: version.versionId,
                payloadSha256: version.payloadDigest,
                parentVersionId: version.parentVersionId ?? null,
            });
        }
        messages.push({ messageId: identity.messageId, activeVersionIndex, versions });
    }
    const inventory = {
        conversation_id: null,
        domain: null,
        locator: null,
        message_count: messages.length,
        version_count: messages.reduce((sum, message) => sum + message.versions.length, 0),
        versions: messages.flatMap(message => message.versions.map((version, index) => ({
            message_id: message.messageId,
            version_id: version.versionId,
            payload_sha256: version.payloadSha256,
            parent_version_id: version.parentVersionId,
            active: index === message.activeVersionIndex,
        }))).sort((a, b) => a.message_id.localeCompare(b.message_id) || a.version_id.localeCompare(b.version_id)),
    };
    return { messages, inventory };
}

function sameHostVersion(a, b) {
    return a.versionId === b.versionId && a.payloadSha256 === b.payloadSha256
        && a.parentVersionId === b.parentVersionId;
}
function sameHostMessage(a, b, { includeActive = true } = {}) {
    return a.messageId === b.messageId
        && (!includeActive || a.activeVersionIndex === b.activeVersionIndex)
        && a.versions.length === b.versions.length
        && a.versions.every((version, index) => sameHostVersion(version, b.versions[index]));
}
function classifyHostSaveTransition(before, after) {
    const oldMessages = before.messages;
    const newMessages = after.messages;

    // Metadata-only/no-op saves do not alter the persisted conversation inventory.
    if (oldMessages.length === newMessages.length
        && oldMessages.every((message, index) => sameHostMessage(message, newMessages[index]))) {
        return 'no-op';
    }

    // Only append one complete new message; never delete or reorder existing messages.
    if (newMessages.length === oldMessages.length + 1
        && oldMessages.every((message, index) => sameHostMessage(message, newMessages[index]))
        && newMessages.at(-1).versions.length === 1
        && newMessages.at(-1).versions[0].parentVersionId === null) {
        return 'create-message';
    }

    if (oldMessages.length !== newMessages.length
        || oldMessages.some((message, index) => message.messageId !== newMessages[index].messageId)) return null;

    const changed = oldMessages.map((oldMessage, index) => ({ oldMessage, newMessage: newMessages[index] }))
        .filter(({ oldMessage, newMessage }) => !sameHostMessage(oldMessage, newMessage));
    if (changed.length !== 1) return null;
    const { oldMessage, newMessage } = changed[0];

    // Active-version selection is safe only when the full version lineage is preserved.
    if (oldMessage.versions.length === newMessage.versions.length
        && oldMessage.versions.every((version, index) => sameHostVersion(version, newMessage.versions[index]))
        && oldMessage.activeVersionIndex !== newMessage.activeVersionIndex) {
        return 'swipe-select';
    }

    // A new version must be appended while every previous version remains byte/digest-identical.
    if (newMessage.versions.length === oldMessage.versions.length + 1
        && oldMessage.versions.every((version, index) => sameHostVersion(version, newMessage.versions[index]))) {
        const appended = newMessage.versions.at(-1);
        const parent = oldMessage.versions[oldMessage.activeVersionIndex];
        if (appended.parentVersionId === parent.versionId
            && newMessage.activeVersionIndex === newMessage.versions.length - 1) {
            return 'append-version';
        }
    }

    // Deletions, replacement edits, in-place mutation, and reordering remain unsupported
    // until a separately reviewed tombstone/history-retention contract exists.
    return null;
}

async function readStableHostChatFile(filePath, expectedDigest = null) {
    const before = await lstat(filePath);
    if (before.isSymbolicLink() || !before.isFile()) throw new Error('HOST_SAVE_SOURCE_UNSAFE');
    const handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
        const opened = await handle.stat();
        if (!opened.isFile() || !sameFileStat(before, opened)) throw new Error('HOST_SAVE_SOURCE_CHANGED');
        const bytes = await handle.readFile();
        const afterHandle = await handle.stat();
        const afterPath = await lstat(filePath);
        const pathBytes = await readFile(filePath);
        if (!sameFileStat(opened, afterHandle) || !sameFileStat(opened, afterPath)
            || bytes.length !== afterHandle.size || digest(pathBytes) !== digest(bytes)) {
            throw new Error('HOST_SAVE_SOURCE_CHANGED');
        }
        const fileDigest = digest(bytes);
        if (expectedDigest && expectedDigest !== fileDigest) throw new Error('HOST_SAVE_SOURCE_CHANGED');
        const text = bytes.toString('utf8');
        const records = text.split(/\r?\n/).filter(line => line.trim().length > 0).map(line => JSON.parse(line));
        return { bytes, fileDigest, records };
    } finally {
        await handle.close().catch(() => {});
    }
}

function payloadFileDigest(payload) {
    // SillyTavern serializes chat records as JSONL joined by newlines, without
    // a trailing line terminator; bind the exact bytes written by the native route.
    return digest(payload.chat.map(record => JSON.stringify(record)).join('\n'));
}

function targetArtifactDigest(snapshot, target) {
    const artifactId = target.domain + ':' + target.sourcePath;
    return snapshot.artifacts.find(item => item.artifactId === artifactId)?.sha256 ?? null;
}


function finalizeProjectedHostInventory(projected, enrollment) {
    const inventory = {
        ...projected.inventory,
        conversation_id: enrollment.conversationId,
        domain: enrollment.domain,
        locator: enrollment.sourcePath,
    };
    inventory.inventory_sha256 = digest(canonical(stableValue(inventory)));
    return { ...projected, inventory };
}

function overallProjectedInventoryDigest(beforeInventory, projectedInventory, conversationId) {
    const inventories = beforeInventory.inventories
        .map(item => item.conversation_id === conversationId ? projectedInventory : item)
        .sort((a, b) => a.conversation_id.localeCompare(b.conversation_id));
    return digest(canonical(stableValue(inventories)));
}

function consumeHostSaveCapability(request, target, before, headerToken) {
    purgeExpiredSaveCapabilities();
    if (typeof headerToken !== 'string' || headerToken.length < 32) {
        throw new Error('HOST_SAVE_CAPABILITY_REQUIRED');
    }
    const key = digest(headerToken);
    const capability = saveCapabilities.get(key);
    if (!capability) throw new Error('HOST_SAVE_CAPABILITY_INVALID');
    // Consume before validating scope: a token can never be replayed on another
    // path/session, including after a failed attempt.
    saveCapabilities.delete(key);
    if (capability.expiresAt <= Date.now()) throw new Error('HOST_SAVE_CAPABILITY_EXPIRED');
    const userHandle = request.user?.profile?.handle;
    if (typeof request.sessionID !== 'string' || request.sessionID !== capability.sessionId
        || typeof userHandle !== 'string' || userHandle !== capability.userHandle
        || (request.baseUrl + request.path) !== capability.route
        || target.route !== capability.route
        || target.domain !== capability.domain || target.sourcePath !== capability.sourcePath) {
        throw new Error('HOST_SAVE_CAPABILITY_SCOPE_MISMATCH');
    }
    if (!before.complete || !before.conversationInventory?.complete
        || before.conversationInventory.inventory_sha256 !== capability.preStateInventoryDigest
        || targetArtifactDigest(before, target) !== capability.preStateFileDigest) {
        throw new Error('HOST_SAVE_CAPABILITY_STALE_PRESTATE');
    }
    const payloadDigest = digest(canonical(stableValue(request.body ?? null)));
    if (payloadDigest !== capability.payloadDigest
        || payloadFileDigest(request.body ?? {}) !== capability.postStateFileDigest) {
        throw new Error('HOST_SAVE_CAPABILITY_BODY_MISMATCH');
    }
    const enrollment = capability.enrollment;
    const projected = finalizeProjectedHostInventory(
        projectHostChatRecords(request.body.chat, enrollment.conversationId.split(':')[1]),
        enrollment,
    );
    const proposedInventoryDigest = overallProjectedInventoryDigest(
        before.conversationInventory,
        projected.inventory,
        enrollment.conversationId,
    );
    if (proposedInventoryDigest !== capability.postStateInventoryDigest) {
        throw new Error('HOST_SAVE_CAPABILITY_POSTSTATE_MISMATCH');
    }
    return capability;
}

function operationTargetsEnrolledHistory(operation, request, registry) {
    const body = request.body ?? {};
    if (operation === 'group-delete') {
        // SillyTavern's group-delete route reads group metadata and unlinks every
        // chat in its `chats` array. Until identity-preserving tombstones exist,
        // reject the operation if any enrolled group-chat history could be affected.
        return registry.conversations.some(conversation => conversation.domain === 'group_chats');
    }
    if (operation === 'chat-save' || operation === 'group-chat-save') {
        const route = operation === 'chat-save' ? '/api/chats/save' : '/api/chats/group/save';
        let target;
        try {
            target = resolveSaveTarget(route, body);
        } catch {
            return registry.conversations.some(conversation => conversation.domain
                === (operation === 'chat-save' ? 'chats' : 'group_chats'));
        }
        const markerUuid = body.chat?.[0]?.chat_metadata?.logic_engine_conversation_id;
        return registry.conversations.some(conversation =>
            (conversation.domain === target.domain && conversation.sourcePath === target.sourcePath)
            || conversation.conversationId.split(':')[1] === markerUuid);
    }
    if (operation === 'chat-import') {
        return registry.conversations.some(conversation => conversation.domain === 'chats');
    }
    if (operation === 'group-chat-import') {
        return registry.conversations.some(conversation => conversation.domain === 'group_chats');
    }
    if (operation === 'user-root-reset') {
        // This route deletes the entire current user's data root, including the
        // enrollment marker and journal. It is denied while any history is enrolled.
        return registry.conversations.length > 0;
    }
    if (operation === 'data-maid-delete' || operation === 'backup-delete') {
        // Backup deletion can destroy the only remaining copy of an enrolled
        // chat version. Until backups have an identity-preserving lifecycle,
        // reject the operation whenever any Host conversation is enrolled.
        return registry.conversations.length > 0;
    }
    if (operation === 'chat-delete') {
        const characterDirectory = path.parse(String(body.avatar_url ?? '').replace('.png', '')).name;
        const chatName = path.parse(String(body.chatfile ?? '')).name;
        if (!characterDirectory || !chatName) return false;
        return registry.conversations.some(conversation => conversation.domain === 'chats'
            && conversation.sourcePath === characterDirectory + '/' + chatName + '.jsonl');
    }
    if (operation === 'group-chat-delete') {
        const chatName = path.parse(String(body.id ?? '')).name;
        if (!chatName) return false;
        return registry.conversations.some(conversation => conversation.domain === 'group_chats'
            && typeof conversation.sourcePath === 'string'
            && !conversation.sourcePath.includes('/')
            && path.parse(conversation.sourcePath).name === chatName);
    }
    if (operation === 'chat-rename') {
        const isGroup = Boolean(body.is_group);
        const domain = isGroup ? 'group_chats' : 'chats';
        const sourceName = path.parse(String(body.original_file ?? '')).name;
        if (!sourceName) return false;
        const characterDirectory = path.parse(String(body.avatar_url ?? '').replace('.png', '')).name;
        return registry.conversations.some(conversation => {
            if (conversation.domain !== domain || typeof conversation.sourcePath !== 'string'
                || path.parse(conversation.sourcePath).name !== sourceName) return false;
            return isGroup
                ? !conversation.sourcePath.includes('/')
                : Boolean(characterDirectory) && conversation.sourcePath.startsWith(characterDirectory + '/');
        });
    }
    if (operation === 'character-rename' || operation === 'character-delete') {
        return hasEnrolledChatUnderCharacter(registry, body.avatar_url);
    }
    return false;
}

const safeUserDirectories = request => {
    const directories = request.user?.directories;
    const roots = [
        { domain: 'chats', path: directories?.chats },
        { domain: 'characters', path: directories?.characters },
        { domain: 'groups', path: directories?.groups },
        { domain: 'group_chats', path: directories?.groupChats },
        { domain: 'backups', path: directories?.backups },
    ];
    if (roots.some(root => typeof root.path !== 'string' || !path.isAbsolute(root.path))) {
        throw new Error('HOST_STORAGE_ROOTS_UNAVAILABLE');
    }
    return roots;
};

async function statePaths(request) {
    const roots = safeUserDirectories(request);
    const chatRoot = await realpath(roots[0].path);
    const userRoot = path.dirname(chatRoot);
    const rootStat = await lstat(userRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('HOST_STORAGE_ROOT_UNSAFE');
    const stateDirectory = path.join(userRoot, '.logic-engine-host');
    try {
        const stat = await lstat(stateDirectory);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('HOST_STATE_DIRECTORY_UNSAFE');
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        try {
            await mkdir(stateDirectory, { mode: 0o700 });
        } catch (createError) {
            // Concurrent first-time requests may race to create the same state directory.
            if (createError?.code !== 'EEXIST') throw createError;
        }
        const stat = await lstat(stateDirectory);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('HOST_STATE_DIRECTORY_UNSAFE');
    }
    return {
        roots,
        stateDirectory,
        registryPath: path.join(stateDirectory, 'enrollments.json'),
        journalPath: path.join(stateDirectory, 'mutation-ledger.jsonl'),
    };
}

async function atomicWriteJson(filePath, value) {
    const temporaryPath = filePath + '.' + randomUUID() + '.tmp';
    const handle = await open(temporaryPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    try {
        await handle.writeFile(canonical(value) + '\n', 'utf8');
        await handle.sync();
    } finally {
        await handle.close();
    }
    await rename(temporaryPath, filePath);
}

async function readRegistry(registryPath, { allowMissing = false } = {}) {
    try {
        const stat = await lstat(registryPath);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('HOST_REGISTRY_UNSAFE');
        const value = JSON.parse(await readFile(registryPath, 'utf8'));
        if (value?.version !== 1 || !Array.isArray(value.conversations)) throw new Error('HOST_REGISTRY_INVALID');
        return value;
    } catch (error) {
        if (error?.code === 'ENOENT' && allowMissing) return { version: 1, conversations: [] };
        throw error;
    }
}

async function readAndValidateJournal(journalPath) {
    let text;
    try {
        const stat = await lstat(journalPath);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('HOST_JOURNAL_UNSAFE');
        text = await readFile(journalPath, 'utf8');
    } catch (error) {
        if (error?.code === 'ENOENT') throw new Error('HOST_JOURNAL_MISSING');
        throw error;
    }
    const records = [];
    let previousHash = '0'.repeat(64);
    const pending = new Set();
    let degraded = false;
    for (const line of text.split('\n').filter(Boolean)) {
        const record = JSON.parse(line);
        const { recordHash, ...unsigned } = record;
        if (record.previousHash !== previousHash || digest(canonical(unsigned)) !== recordHash) {
            throw new Error('HOST_JOURNAL_CHAIN_INVALID');
        }
        previousHash = recordHash;
        records.push(record);
        if (record.kind === 'intent') pending.add(record.operationId);
        if (record.kind === 'outcome' && ['COMMITTED', 'REJECTED_NO_MUTATION'].includes(record.status)) pending.delete(record.operationId);
        if (record.kind === 'reconciliation') {
            pending.delete(record.operationId);
            degraded = true;
        }
    }
    return {
        records,
        unresolved: pending.size > 0,
        pendingOperations: [...pending],
        degraded,
        lastHash: previousHash,
    };
}

async function appendRecord(journalPath, priorHash, record) {
    const unsigned = { ...record, previousHash: priorHash };
    const recordHash = digest(canonical(unsigned));
    const line = canonical({ ...unsigned, recordHash }) + '\n';
    const noFollow = constants.O_NOFOLLOW ?? 0;
    const handle = await open(journalPath, constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY | noFollow, 0o600);
    try {
        await handle.writeFile(line, 'utf8');
        await handle.sync();
    } finally {
        await handle.close();
    }
    return recordHash;
}

function snapshotDigest(scan) {
    return digest(canonical({
        artifacts: scan.artifacts.map(item => [item.artifactId, item.byteLength, item.sha256]),
        conversationInventoryDigest: scan.conversationInventory?.inventory_sha256 ?? null,
    }));
}

async function scanMutationSnapshot(paths, registry, requirePersistedInventory) {
    const artifacts = await scanHostArtifactRoots(paths.roots);
    if (!artifacts.complete || !requirePersistedInventory) return artifacts;
    const conversationInventory = await scanPersistedConversationInventories(
        paths.roots.filter(root => root.domain === 'chats' || root.domain === 'group_chats'),
        registry.conversations,
    );
    if (!conversationInventory.complete) {
        return {
            ...artifacts,
            status: 'INVENTORY_INCOMPLETE',
            complete: false,
            artifacts: [],
            artifactCount: null,
            conversationInventory,
            errors: conversationInventory.errors,
        };
    }
    return { ...artifacts, conversationInventory };
}

function diffConversationInventories(before, after) {
    const flatten = snapshot => (snapshot?.conversationInventory?.inventories ?? []).flatMap(conversation =>
        conversation.versions.map(version => ({
            conversation_id: conversation.conversation_id,
            message_id: version.message_id,
            version_id: version.version_id,
            payload_sha256: version.payload_sha256,
            parent_version_id: version.parent_version_id,
            active: version.active,
        })),
    );
    const a = new Map(flatten(before).map(item => [JSON.stringify([item.conversation_id, item.message_id, item.version_id]), item]));
    const b = new Map(flatten(after).map(item => [JSON.stringify([item.conversation_id, item.message_id, item.version_id]), item]));
    const keys = [...new Set([...a.keys(), ...b.keys()])].sort();
    return keys.flatMap(key => {
        const oldItem = a.get(key);
        const newItem = b.get(key);
        if (!oldItem) return [{ change: 'ADDED', ...newItem }];
        if (!newItem) return [{ change: 'REMOVED_FROM_CURRENT_SNAPSHOT', ...oldItem }];
        const changes = [];
        if (oldItem.payload_sha256 !== newItem.payload_sha256) changes.push('DIGEST_CHANGED');
        if (oldItem.parent_version_id !== newItem.parent_version_id) changes.push('PARENT_CHANGED');
        if (oldItem.active !== newItem.active) changes.push('ACTIVE_CHANGED');
        return changes.length ? [{ change: changes.join('+'), ...newItem }] : [];
    });
}

function diffSnapshots(before, after) {
    const a = new Map(before.artifacts.map(item => [item.artifactId, item]));
    const b = new Map(after.artifacts.map(item => [item.artifactId, item]));
    const ids = [...new Set([...a.keys(), ...b.keys()])].sort();
    return ids.flatMap(id => {
        const oldItem = a.get(id);
        const newItem = b.get(id);
        if (oldItem?.sha256 === newItem?.sha256 && oldItem?.byteLength === newItem?.byteLength) return [];
        return [{ artifactId: id, beforeSha256: oldItem?.sha256 ?? null, afterSha256: newItem?.sha256 ?? null }];
    });
}

const locks = new Map();
async function acquireUserLock(key) {
    const prior = locks.get(key) ?? Promise.resolve();
    let release;
    const current = new Promise(resolve => { release = resolve; });
    const tail = prior.then(() => current);
    locks.set(key, tail);
    await prior;
    return () => {
        release();
        if (locks.get(key) === tail) locks.delete(key);
    };
}

function fail(response, code, status = 503) {
    if (response.headersSent) return;
    response.status(status).json({ error: { code } });
}

/**
 * Server-side operation journal for direct SillyTavern API mutation routes.
 * It activates only for a user with at least one explicit Host enrollment.
 * A successful pre-snapshot and fsynced intent are required before the handler.
 * The response is held until a post-snapshot and fsynced outcome are recorded.
 */
function verifyEnrolledChatSavePersistence(request, registry, after) {
    if (request.method !== 'POST'
        || (request.baseUrl + request.path !== '/api/chats/save'
            && request.originalUrl?.split('?')[0] !== '/api/chats/save')) return null;

    const body = request.body;
    const cardName = String(body?.avatar_url ?? '').replace('.png', '');
    // Mirror the native route's order: append .jsonl, then sanitize the full
    // filename. This is only a conservative enrollment lookup; native route
    // validation and the persisted scanner remain the actual path/state checks.
    const rawFileName = String(body?.file_name ?? '') + '.jsonl';
    const fileName = rawFileName
        .replace(/[<>:"/\\|?*\u0000-\u001F\u0080-\u009F]/g, '')
        .replace(/^\.+$/g, '')
        .replace(/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?$/i, '')
        .replace(/[. ]+$/g, '')
        .slice(0, 255);
    const sourcePath = cardName + '/' + fileName;
    const headerUuid = body?.chat?.[0]?.chat_metadata?.logic_engine_conversation_id;
    // Match both the requested target and the stable enrolled UUID. The native
    // route sanitizes file_name before writing, so raw request fields alone are
    // not a reliable target identity. The persisted scanner rejects duplicate
    // UUIDs/copy paths and changed headers; this fallback prevents a sanitized
    // filename alias from skipping the persistence receipt check.
    const enrollment = registry.conversations.find(item =>
        item.domain === 'chats' && item.sourcePath === sourcePath)
        ?? (typeof headerUuid === 'string' && headerUuid.length > 0
            ? registry.conversations.find(item =>
                item.domain === 'chats' && item.conversationId.split(':')[1] === headerUuid)
            : undefined);
    if (!enrollment) return null;

    if (!Array.isArray(body?.chat) || body.chat.length < 2) {
        return { ok: false, code: 'HOST_SAVE_PAYLOAD_INVALID' };
    }
    const conversationUuid = enrollment.conversationId.split(':')[1];
    if (headerUuid !== conversationUuid) {
        return { ok: false, code: 'HOST_SAVE_IDENTITY_MISMATCH' };
    }

    const expected = [];
    const seenMessages = new Set();
    const seenVersions = new Set();
    for (const message of body.chat.slice(1)) {
        const identity = message?._logicEngineLifecycle;
        const nativeVersions = Array.isArray(message?.swipes) && message.swipes.length
            ? message.swipes : [message?.mes ?? ''];
        const activeIndex = message?.swipe_id === undefined ? 0 : message.swipe_id;
        if (!identity || typeof identity.messageId !== 'string'
            || seenMessages.has(identity.messageId)
            || !Array.isArray(identity.versions)
            || identity.versions.length !== nativeVersions.length
            || !Number.isInteger(activeIndex) || activeIndex < 0 || activeIndex >= nativeVersions.length
            || identity.activeVersionIndex !== activeIndex
            || typeof message.mes !== 'string' || message.mes !== nativeVersions[activeIndex]) {
            return { ok: false, code: 'HOST_SAVE_IDENTITY_MISMATCH' };
        }
        seenMessages.add(identity.messageId);
        for (let index = 0; index < nativeVersions.length; index++) {
            const version = identity.versions[index];
            if (!version || typeof version.versionId !== 'string'
                || seenVersions.has(version.versionId)
                || typeof version.payloadDigest !== 'string'
                || version.payloadDigest !== digest(JSON.stringify(String(nativeVersions[index])))) {
                return { ok: false, code: 'HOST_SAVE_VERSION_DIGEST_MISMATCH' };
            }
            seenVersions.add(version.versionId);
            expected.push({
                message_id: identity.messageId,
                version_id: version.versionId,
                payload_sha256: version.payloadDigest,
                parent_version_id: version.parentVersionId ?? null,
                active: index === activeIndex,
            });
        }
    }

    const persisted = after.conversationInventory?.inventories
        ?.find(item => item.conversation_id === enrollment.conversationId);
    if (!persisted) return { ok: false, code: 'HOST_SAVE_PERSISTED_INVENTORY_MISSING' };
    const actual = (persisted.versions ?? []).map(version => ({
        message_id: version.message_id,
        version_id: version.version_id,
        payload_sha256: version.payload_sha256,
        parent_version_id: version.parent_version_id ?? null,
        active: version.active,
    }));
    const normalize = values => values
        .map(value => JSON.stringify(value))
        .sort();
    if (JSON.stringify(normalize(expected)) !== JSON.stringify(normalize(actual))) {
        return { ok: false, code: 'HOST_SAVE_PERSISTENCE_MISMATCH' };
    }
    return { ok: true };
}


export function createHostLifecycleMutationMiddleware({ enforce = process.env.LOGIC_ENGINE_HOST_LIFECYCLE_ENFORCE === 'true', requirePersistedInventory = false, getUserDirectories, beforeSavePrestateRecheck = null, beforeSaveNativeHandoff = null } = {}) {
    return async function hostLifecycleMutationMiddleware(request, response, next) {
        const routeKey = request.method + ' ' + request.baseUrl + request.path;
        const originalRouteKey = request.method + ' ' + request.originalUrl?.split('?')[0];
        if (request.method === 'POST'
            && (routeKey === 'POST /api/users/delete' || originalRouteKey === 'POST /api/users/delete')) {
            // Admin deletion removes the target's profile and may also remove its
            // data root. The current request.user registry is not the target's
            // authority; resolve the target using SillyTavern's server-side resolver.
            if (typeof request.body?.handle !== 'string' || !/^[a-z0-9-]{1,128}$/.test(request.body.handle) || typeof getUserDirectories !== 'function') {
                return fail(response, 'HOST_JOURNAL_UNAVAILABLE', 503);
            }
            try {
                const targetDirectories = getUserDirectories(request.body.handle);
                if (await targetUserHasEnrolledState(targetDirectories)) {
                    return fail(response, 'HOST_ENROLLED_HISTORY_PATH_MUTATION_UNSUPPORTED', 409);
                }
            } catch {
                return fail(response, 'HOST_JOURNAL_UNAVAILABLE', 503);
            }
            return next();
        }
        const operation = MUTATIONS.get(routeKey)
            ?? MUTATIONS.get(originalRouteKey);
        if (!operation || !request.user) return next();

        let paths;
        let registry;
        let saveTarget = null;
        let requiresSaveCapability = false;
        const saveCapabilityHeader = request.headers?.['x-logic-engine-save-capability'];
        try {
            const chatRootPath = request.user?.directories?.chats;
            if (typeof chatRootPath !== 'string' || !path.isAbsolute(chatRootPath)) {
                if (enforce) return fail(response, 'HOST_JOURNAL_UNAVAILABLE');
                return next();
            }
            let canonicalChatRoot;
            try {
                canonicalChatRoot = await realpath(chatRootPath);
            } catch {
                if (enforce) return fail(response, 'HOST_JOURNAL_UNAVAILABLE');
                return next();
            }
            const userRoot = path.dirname(canonicalChatRoot);
            const stateDirectory = path.join(userRoot, '.logic-engine-host');
            try {
                const stateStat = await lstat(stateDirectory);
                if (!stateStat.isDirectory() || stateStat.isSymbolicLink()) throw new Error('HOST_STATE_DIRECTORY_UNSAFE');
            } catch (error) {
                if (error?.code === 'ENOENT') {
                    // Enrollment leaves a marker outside the journal directory. If the
                    // journal directory is later removed, never treat that as an
                    // unconfigured installation and pass the native mutation through.
                    try {
                        const markerPath = path.join(userRoot, ENROLLMENT_MARKER_NAME);
                        const markerStat = await lstat(markerPath);
                        if (!markerStat.isFile() || markerStat.isSymbolicLink()) {
                            return fail(response, 'HOST_JOURNAL_UNAVAILABLE');
                        }
                        return fail(response, 'HOST_JOURNAL_UNAVAILABLE');
                    } catch (markerError) {
                        if (markerError?.code !== 'ENOENT') return fail(response, 'HOST_JOURNAL_UNAVAILABLE');
                    }
                    if (enforce) return fail(response, 'HOST_JOURNAL_UNAVAILABLE');
                    return next();
                }
                throw error;
            }
            const registryPath = path.join(stateDirectory, 'enrollments.json');
            registry = await readRegistry(registryPath);
            // A surviving marker means this state was previously enrolled.
            // Validate it before treating an empty registry as a legacy install.
            await assertEnrollmentStateNotLost(request);
            if (registry.conversations.length === 0) {
                if (enforce) return fail(response, 'HOST_ENROLLMENT_REQUIRED', 503);
                return next();
            }
            // Migrate pre-marker enrollments before any covered mutation can proceed.
            await ensureEnrollmentMarker({ roots: safeUserDirectories(request) });
            const isSaveOperation = ['chat-save', 'group-chat-save'].includes(operation);
            const targetsEnrolledHistory = operationTargetsEnrolledHistory(operation, request, registry);
            if (isSaveOperation && targetsEnrolledHistory) {
                if (typeof saveCapabilityHeader !== 'string') {
                    return fail(response, 'HOST_ENROLLED_HISTORY_SAVE_CAPABILITY_REQUIRED', 409);
                }
                try {
                    saveTarget = resolveSaveTarget(
                        operation === 'chat-save' ? '/api/chats/save' : '/api/chats/group/save',
                        request.body ?? {},
                    );
                } catch {
                    return fail(response, 'HOST_SAVE_CAPABILITY_TARGET_INVALID', 409);
                }
                requiresSaveCapability = true;
            } else if (targetsEnrolledHistory) {
                return fail(response, 'HOST_ENROLLED_HISTORY_PATH_MUTATION_UNSUPPORTED', 409);
            } else if (saveCapabilityHeader !== undefined) {
                return fail(response, 'HOST_SAVE_CAPABILITY_SCOPE_MISMATCH', 409);
            }
            paths = await statePaths(request);
        } catch {
            return fail(response, 'HOST_JOURNAL_UNAVAILABLE');
        }

        const userKey = digest(String(request.user.profile?.handle ?? paths.roots[0].path));
        const release = await acquireUserLock(userKey);
        let before;
        let operationId;
        let chain;
        let saveCapability = null;
        try {
            chain = await readAndValidateJournal(paths.journalPath);
            if (chain.unresolved) {
                release();
                return fail(response, 'HOST_JOURNAL_RECONCILIATION_REQUIRED');
            }
            before = await scanMutationSnapshot(paths, registry, requirePersistedInventory);
            if (!before.complete) {
                release();
                return fail(response, 'HOST_INVENTORY_INCOMPLETE');
            }
            if (requiresSaveCapability) {
                // Consume/validate the one-shot token first. A replay must be
                // rejected as such even if the previous accepted write has not
                // yet been acknowledged by the inventory publisher.
                try {
                    saveCapability = consumeHostSaveCapability(request, saveTarget, before, saveCapabilityHeader);
                } catch (error) {
                    release();
                    const code = typeof error?.message === 'string' && error.message.startsWith('HOST_SAVE_CAPABILITY_')
                        ? error.message : 'HOST_SAVE_CAPABILITY_INVALID';
                    return fail(response, code, 409);
                }
                const acceptedInventory = await getHostConversationInventory(request);
                if (!acceptedInventory.complete) {
                    release();
                    return fail(response, 'HOST_SAVE_CAPABILITY_INVENTORY_NOT_READY', 503);
                }
            }
            const suppliedOperationId = request.headers?.['x-logic-engine-operation-id'];
            if (suppliedOperationId !== undefined
                && (typeof suppliedOperationId !== 'string' || !/^[a-zA-Z0-9._:-]{1,128}$/.test(suppliedOperationId))) {
                release();
                return fail(response, 'HOST_OPERATION_ID_INVALID', 400);
            }
            operationId = suppliedOperationId ?? randomUUID();
            const route = request.baseUrl + request.path;
            const requestFingerprint = digest(canonical(stableValue({
                method: request.method,
                route,
                body: request.body ?? null,
            })));
            const priorOperation = chain.records.find(record => record.kind === 'intent' && record.operationId === operationId);
            if (priorOperation) {
                release();
                return fail(response,
                    priorOperation.requestFingerprint === requestFingerprint
                        ? 'HOST_OPERATION_ALREADY_RECORDED'
                        : 'HOST_OPERATION_ID_CONFLICT',
                    409);
            }
            const recordHash = await appendRecord(paths.journalPath, chain.lastHash, {
                version: 1,
                kind: 'intent',
                operationId,
                requestFingerprint,
                operation,
                method: request.method,
                route,
                startedAt: new Date().toISOString(),
                beforeSnapshotDigest: snapshotDigest(before),
                beforeArtifactCount: before.artifactCount,
                beforeArtifacts: before.artifacts.map(item => ({ artifactId: item.artifactId, byteLength: item.byteLength, sha256: item.sha256 })),
                beforeConversationInventoryDigest: before.conversationInventory?.inventory_sha256 ?? null,
                beforeConversationInventories: before.conversationInventory?.inventories ?? null,
            });
            chain.lastHash = recordHash;
        } catch {
            release();
            return fail(response, 'HOST_JOURNAL_PREPARE_FAILED');
        }

        if (saveCapability) {
            let immediateSnapshot = null;
            let preStateStillCurrent = false;
            try {
                // Internal deterministic test seam; production callers leave this unset.
                if (typeof beforeSavePrestateRecheck === 'function') {
                    await beforeSavePrestateRecheck({ request, target: saveTarget, operationId });
                }
                const root = paths.roots.find(item => item.domain === saveTarget.domain)?.path;
                if (!root) throw new Error('HOST_SAVE_CAPABILITY_ROOT_UNAVAILABLE');
                const sourceFilePath = path.resolve(root, ...saveTarget.sourcePath.split('/'));
                const relative = path.relative(root, sourceFilePath);
                if (!relative || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
                    throw new Error('HOST_SAVE_CAPABILITY_PATH_UNSAFE');
                }
                await readStableHostChatFile(sourceFilePath, saveCapability.preStateFileDigest);
                immediateSnapshot = await scanMutationSnapshot(paths, registry, requirePersistedInventory);
                preStateStillCurrent = immediateSnapshot.complete
                    && immediateSnapshot.conversationInventory?.inventory_sha256 === saveCapability.preStateInventoryDigest
                    && targetArtifactDigest(immediateSnapshot, saveTarget) === saveCapability.preStateFileDigest;
            } catch {
                preStateStillCurrent = false;
            }
            if (!preStateStillCurrent) {
                try {
                    await appendRecord(paths.journalPath, chain.lastHash, {
                        version: 1,
                        kind: 'outcome',
                        operationId,
                        status: 'UNRESOLVED',
                        completedAt: new Date().toISOString(),
                        httpStatus: 409,
                        afterSnapshotStatus: 'HOST_SAVE_CAPABILITY_STALE_PRESTATE',
                        afterSnapshotDigest: immediateSnapshot ? snapshotDigest(immediateSnapshot) : null,
                        afterConversationInventoryDigest: immediateSnapshot?.conversationInventory?.inventory_sha256 ?? null,
                    });
                } catch {
                    // Keep the request blocked even if the journal outcome itself cannot be recorded.
                }
                release();
                return fail(response, 'HOST_SAVE_CAPABILITY_STALE_PRESTATE', 409);
            }
        }

        // Buffer the complete response until the post-mutation inventory and
        // durable outcome are known. Buffering only end() is insufficient:
        // handlers can call writeHead(), write(), or flushHeaders() first,
        // irreversibly committing a success response before the scan completes.
        const originalEnd = response.end.bind(response);
        const originalWrite = response.write.bind(response);
        const originalWriteHead = response.writeHead.bind(response);
        const originalFlushHeaders = typeof response.flushHeaders === 'function'
            ? response.flushHeaders.bind(response) : null;
        const bufferedWrites = [];
        let bufferedWriteHead = null;
        let ending = false;
        response.writeHead = function (...args) {
            bufferedWriteHead = args;
            if (args.length && Number.isInteger(args[0])) response.statusCode = args[0];
            return response;
        };
        response.write = function (...args) {
            bufferedWrites.push(args);
            return true;
        };
        if (originalFlushHeaders) response.flushHeaders = function () { return response; };

        const restoreResponseMethods = () => {
            response.end = originalEnd;
            response.write = originalWrite;
            response.writeHead = originalWriteHead;
            if (originalFlushHeaders) response.flushHeaders = originalFlushHeaders;
        };
        const commitBufferedResponse = (endArgs, override) => {
            // Native ServerResponse.end() may call _implicitHeader(), which in turn
            // calls response.writeHead(). Restore native methods before committing.
            restoreResponseMethods();
            if (override) {
                bufferedWrites.length = 0;
                bufferedWriteHead = null;
                response.statusCode = override.status;
                // Express may already have calculated headers for the discarded
                // success body before end() was intercepted. Never retain a stale
                // Content-Length, ETag, encoding, or digest for the replacement 503.
                for (const header of ['Content-Length', 'ETag', 'Content-MD5', 'Content-Encoding', 'Transfer-Encoding']) {
                    response.removeHeader?.(header);
                }
                response.setHeader('Content-Type', 'application/json; charset=utf-8');
                return originalEnd(override.body);
            }
            if (bufferedWriteHead) originalWriteHead(...bufferedWriteHead);
            for (const writeArgs of bufferedWrites) originalWrite(...writeArgs);
            return originalEnd(...endArgs);
        };

        response.end = function (...args) {
            if (ending) return response;
            ending = true;
            void (async () => {
                try {
                    const after = await scanMutationSnapshot(paths, registry, requirePersistedInventory);
                    if (!after.complete) {
                        await appendRecord(paths.journalPath, chain.lastHash, {
                            version: 1,
                            kind: 'outcome',
                            operationId,
                            status: 'UNRESOLVED',
                            completedAt: new Date().toISOString(),
                            httpStatus: response.statusCode,
                            afterSnapshotStatus: after.status,
                            afterConversationInventoryErrors: after.conversationInventory?.errors ?? null,
                        });
                        return commitBufferedResponse(args, {
                            status: 503,
                            body: JSON.stringify({ error: { code: 'HOST_POST_MUTATION_SCAN_INCOMPLETE' } }),
                        });
                    }
                    if (saveCapability && (
                        targetArtifactDigest(after, saveTarget) !== saveCapability.postStateFileDigest
                        || after.conversationInventory?.inventory_sha256 !== saveCapability.postStateInventoryDigest
                    )) {
                        await appendRecord(paths.journalPath, chain.lastHash, {
                            version: 1,
                            kind: 'outcome',
                            operationId,
                            status: 'UNRESOLVED',
                            completedAt: new Date().toISOString(),
                            httpStatus: response.statusCode,
                            afterSnapshotStatus: 'HOST_SAVE_CAPABILITY_POSTSTATE_MISMATCH',
                            afterSnapshotDigest: snapshotDigest(after),
                            afterConversationInventoryDigest: after.conversationInventory?.inventory_sha256 ?? null,
                        });
                        return commitBufferedResponse(args, {
                            status: 503,
                            body: JSON.stringify({ error: { code: 'HOST_SAVE_CAPABILITY_POSTSTATE_MISMATCH' } }),
                        });
                    }
                    const saveSucceeded = response.statusCode >= 200 && response.statusCode < 300;
                    const persistence = saveSucceeded
                        ? verifyEnrolledChatSavePersistence(request, registry, after)
                        : null;
                    if (persistence && !persistence.ok) {
                        chain.lastHash = await appendRecord(paths.journalPath, chain.lastHash, {
                            version: 1,
                            kind: 'outcome',
                            operationId,
                            status: 'UNRESOLVED',
                            completedAt: new Date().toISOString(),
                            httpStatus: response.statusCode,
                            persistenceVerification: persistence.code,
                            afterSnapshotDigest: snapshotDigest(after),
                            afterArtifactCount: after.artifactCount,
                            afterConversationInventoryDigest: after.conversationInventory?.inventory_sha256 ?? null,
                            afterConversationInventories: after.conversationInventory?.inventories ?? null,
                        });
                        return commitBufferedResponse(args, {
                            status: 503,
                            body: JSON.stringify({ error: { code: persistence.code } }),
                        });
                    }
                    const changes = diffSnapshots(before, after);
                    const versionChanges = diffConversationInventories(before, after);
                    const isRejectedNoMutation = response.statusCode >= 400
                        && response.statusCode < 500
                        && changes.length === 0
                        && versionChanges.length === 0;
                    const status = response.statusCode >= 200 && response.statusCode < 300
                        ? 'COMMITTED'
                        : isRejectedNoMutation ? 'REJECTED_NO_MUTATION' : 'UNRESOLVED';
                    const hash = await appendRecord(paths.journalPath, chain.lastHash, {
                        version: 1,
                        kind: 'outcome',
                        operationId,
                        status,
                        completedAt: new Date().toISOString(),
                        httpStatus: response.statusCode,
                        afterSnapshotDigest: snapshotDigest(after),
                        afterArtifactCount: after.artifactCount,
                        changes,
                        afterConversationInventoryDigest: after.conversationInventory?.inventory_sha256 ?? null,
                        afterConversationInventories: after.conversationInventory?.inventories ?? null,
                        versionChanges,
                    });
                    chain.lastHash = hash;
                    return commitBufferedResponse(args, null);
                } catch {
                    return commitBufferedResponse(args, {
                        status: 503,
                        body: JSON.stringify({ error: { code: 'HOST_JOURNAL_COMMIT_FAILED' } }),
                    });
                } finally {
                    release();
                }
            })();
            return response;
        };

        if (saveCapability) {
            try {
                // This is the last asynchronous boundary before entering the native
                // save handler. Re-open the exact target with no-follow/stable-stat
                // checks after the durable intent and inventory scan; do not rely on
                // the earlier prestate scan to cover this final race window.
                if (typeof beforeSaveNativeHandoff === 'function') {
                    await beforeSaveNativeHandoff({ request, target: saveTarget, operationId });
                }
                const root = paths.roots.find(item => item.domain === saveTarget.domain)?.path;
                if (!root) throw new Error('HOST_SAVE_CAPABILITY_ROOT_UNAVAILABLE');
                const sourceFilePath = path.resolve(root, ...saveTarget.sourcePath.split('/'));
                const relative = path.relative(root, sourceFilePath);
                if (!relative || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
                    throw new Error('HOST_SAVE_CAPABILITY_PATH_UNSAFE');
                }
                await readStableHostChatFile(sourceFilePath, saveCapability.preStateFileDigest);
            } catch {
                restoreResponseMethods();
                try {
                    await appendRecord(paths.journalPath, chain.lastHash, {
                        version: 1,
                        kind: 'outcome',
                        operationId,
                        status: 'UNRESOLVED',
                        completedAt: new Date().toISOString(),
                        httpStatus: 409,
                        afterSnapshotStatus: 'HOST_SAVE_CAPABILITY_STALE_PRESTATE_AT_NATIVE_HANDOFF',
                    });
                } catch {
                    // Keep the request blocked even if the journal outcome cannot be recorded.
                }
                release();
                return fail(response, 'HOST_SAVE_CAPABILITY_STALE_PRESTATE_AT_NATIVE_HANDOFF', 409);
            }
        }

        return next();
    };
}

/**
 * Acknowledges an unresolved operation without claiming that its outcome is
 * known. This unblocks future logging but leaves history degraded/non-authoritative.
 */
export async function reconcileHostMutation(request, { operationId, acknowledge, reason }) {
    if (typeof operationId !== 'string' || !operationId || operationId.length > 128
        || acknowledge !== 'I_ACCEPT_UNKNOWN_MUTATION_OUTCOME'
        || typeof reason !== 'string' || !reason.trim() || reason.length > 256) {
        throw new Error('HOST_RECONCILIATION_INVALID');
    }
    const paths = await statePaths(request);
    const userKey = digest(String(request.user?.profile?.handle ?? paths.roots[0].path));
    const release = await acquireUserLock(userKey);
    try {
        const chain = await readAndValidateJournal(paths.journalPath);
        if (!chain.unresolved || !chain.pendingOperations.includes(operationId)) {
            throw new Error('HOST_RECONCILIATION_OPERATION_NOT_PENDING');
        }
        const intent = chain.records.find(record => record.kind === 'intent' && record.operationId === operationId);
        const current = await scanHostArtifactRoots(paths.roots);
        if (!current.complete) throw new Error('HOST_RECONCILIATION_SCAN_INCOMPLETE');
        const before = Array.isArray(intent?.beforeArtifacts) ? { artifacts: intent.beforeArtifacts } : null;
        await appendRecord(paths.journalPath, chain.lastHash, {
            version: 1,
            kind: 'reconciliation',
            operationId,
            status: 'UNCERTAINTY_ACKNOWLEDGED',
            acknowledgedAt: new Date().toISOString(),
            reason: reason.trim(),
            currentSnapshotDigest: snapshotDigest(current),
            currentArtifactCount: current.artifactCount,
            changes: before ? diffSnapshots(before, current) : null,
        });
        return { status: 'RECONCILED_WITH_GAP', historyAuthority: 'NON_AUTHORITATIVE' };
    } finally {
        release();
    }
}

export async function getHostMutationJournalStatus(request) {
    const paths = await statePaths(request);
    const chain = await readAndValidateJournal(paths.journalPath);
    return {
        status: chain.unresolved ? 'RECONCILIATION_REQUIRED' : chain.degraded ? 'NON_READY_HISTORY_GAP' : 'RECORDING',
        historicalCompleteness: 'UNKNOWN',
        authority: 'NON_AUTHORITATIVE',
        pendingOperations: chain.pendingOperations,
        degraded: chain.degraded,
        recordCount: chain.records.length,
    };
}


async function validateEnrolledSourcePath(paths, { conversationId, sourceLocator, domain, sourcePath }) {
    if (typeof sourcePath !== 'string' || !sourcePath || sourcePath.length > 512
        || path.isAbsolute(sourcePath) || sourcePath.includes(String.fromCharCode(92))
        || sourcePath.split('/').some(part => !part || part === '.' || part === '..')
        || path.parse(sourcePath).name !== sourceLocator || path.extname(sourcePath) !== '.jsonl') {
        throw new Error('HOST_ENROLLMENT_SOURCE_PATH_INVALID');
    }
    const identityParts = conversationId.split(':');
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (identityParts.length !== 2 || !uuidPattern.test(identityParts[0]) || !uuidPattern.test(identityParts[1])) {
        throw new Error('HOST_ENROLLMENT_IDENTITY_INVALID');
    }
    const root = paths.roots.find(item => item.domain === domain);
    if (!root) throw new Error('HOST_ENROLLMENT_SOURCE_PATH_INVALID');
    const canonicalRoot = await realpath(root.path);
    let cursor = canonicalRoot;
    const segments = sourcePath.split('/');
    for (let index = 0; index < segments.length; index++) {
        cursor = path.join(cursor, segments[index]);
        const stat = await lstat(cursor);
        if (stat.isSymbolicLink() || (index < segments.length - 1 ? !stat.isDirectory() : !stat.isFile())) {
            throw new Error('HOST_ENROLLMENT_SOURCE_PATH_UNSAFE');
        }
    }
    const handle = await open(cursor, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
        const before = await handle.stat();
        const bytes = await handle.readFile();
        const after = await handle.stat();
        const pathAfter = await lstat(cursor);
        const pathBytes = await readFile(cursor);
        const sourceChanged = {
            descriptorIdentity: process.platform !== 'win32' && !sameFileIdentity(before, after),
            descriptorMetadata: before.size !== after.size || before.mtimeMs !== after.mtimeMs,
            pathIdentity: pathAfter.isSymbolicLink() || !pathAfter.isFile()
                || (process.platform !== 'win32' && !sameFileIdentity(before, pathAfter))
                || pathAfter.size !== after.size || pathAfter.mtimeMs !== after.mtimeMs,
            byteLength: bytes.length !== after.size,
            pathContent: digest(pathBytes) !== digest(bytes),
        };
        if (!before.isFile() || Object.values(sourceChanged).some(Boolean)) {
            const error = new Error('HOST_ENROLLMENT_SOURCE_CHANGED');
            error.cause = sourceChanged;
            throw error;
        }
        const firstLine = bytes.toString('utf8').split(/\r?\n/).find(line => line.trim().length > 0);
        const header = firstLine ? JSON.parse(firstLine) : null;
        if (header?.chat_metadata?.logic_engine_conversation_id !== identityParts[1]) {
            throw new Error('HOST_ENROLLMENT_SOURCE_IDENTITY_MISMATCH');
        }
    } finally {
        await handle.close().catch(() => {});
    }
}

/**
 * Explicit Host enrollment registration. The registry is local Host state, not
 * an external anti-rollback authority and not a Core authorization contract.
 */
async function assertEnrollmentStateNotLost(request) {
    const roots = safeUserDirectories(request);
    const canonicalChatRoot = await realpath(roots[0].path);
    const userRoot = path.dirname(canonicalChatRoot);
    const stateDirectory = path.join(userRoot, '.logic-engine-host');
    const markerPath = path.join(userRoot, ENROLLMENT_MARKER_NAME);
    let markerExists = false;
    try {
        const markerStat = await lstat(markerPath);
        if (!markerStat.isFile() || markerStat.isSymbolicLink()) throw new Error('HOST_ENROLLMENT_MARKER_UNSAFE');
        markerExists = true;
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
    if (!markerExists) return;
    try {
        const stateStat = await lstat(stateDirectory);
        if (!stateStat.isDirectory() || stateStat.isSymbolicLink()) throw new Error('HOST_STATE_DIRECTORY_UNSAFE');
    } catch (error) {
        if (error?.code === 'ENOENT') throw new Error('HOST_ENROLLMENT_STATE_LOST');
        throw error;
    }
    try {
        const registryPath = path.join(stateDirectory, 'enrollments.json');
        const registryStat = await lstat(registryPath);
        if (!registryStat.isFile() || registryStat.isSymbolicLink()) throw new Error('HOST_REGISTRY_UNSAFE');
        const registry = await readRegistry(registryPath);
        if (registry.conversations.length === 0) throw new Error('HOST_ENROLLMENT_STATE_LOST');
    } catch (error) {
        if (error?.code === 'ENOENT') throw new Error('HOST_ENROLLMENT_STATE_LOST');
        throw error;
    }
    try {
        const journalStat = await lstat(path.join(stateDirectory, 'mutation-ledger.jsonl'));
        if (!journalStat.isFile() || journalStat.isSymbolicLink()) throw new Error('HOST_JOURNAL_UNSAFE');
    } catch (error) {
        if (error?.code === 'ENOENT') throw new Error('HOST_ENROLLMENT_STATE_LOST');
        throw error;
    }
}

async function ensureEnrollmentMarker(paths) {
    // This sibling marker detects accidental loss of the journal directory;
    // it is not an independent anti-rollback trust anchor.
    const markerPath = path.join(path.dirname(await realpath(paths.roots[0].path)), ENROLLMENT_MARKER_NAME);
    try {
        const markerStat = await lstat(markerPath);
        if (!markerStat.isFile() || markerStat.isSymbolicLink()) throw new Error('HOST_ENROLLMENT_MARKER_UNSAFE');
        return;
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
    const markerHandle = await open(markerPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    try {
        await markerHandle.writeFile(JSON.stringify({ version: 1, purpose: 'host-enrollment-present' }) + '\n', 'utf8');
        await markerHandle.sync();
    } finally {
        await markerHandle.close();
    }
}

export async function registerHostConversation(request, { conversationId, sourceLocator, sourcePath, domain }) {
    await assertEnrollmentStateNotLost(request);
    if (typeof conversationId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(conversationId)) {
        throw new Error('HOST_ENROLLMENT_INVALID');
    }
    if (typeof sourceLocator !== 'string' || !sourceLocator || sourceLocator.length > 255
        || sourceLocator.includes('/') || sourceLocator.includes('\\') || sourceLocator === '.' || sourceLocator === '..') {
        throw new Error('HOST_ENROLLMENT_INVALID');
    }
    if (!['chats', 'group_chats'].includes(domain)) throw new Error('HOST_ENROLLMENT_INVALID');
    const paths = await statePaths(request);
    if (sourcePath !== undefined) await validateEnrolledSourcePath(paths, { conversationId, sourceLocator, domain, sourcePath });
    const userKey = digest(String(request.user.profile?.handle ?? paths.roots[0].path));
    const release = await acquireUserLock(userKey);
    try {
        // Re-check under the enrollment lock: statePaths() may create a missing
        // directory, so the first check alone cannot distinguish first setup
        // from a concurrent loss of previously enrolled state.
        await assertEnrollmentStateNotLost(request);
        let registryExists = true;
        try {
            const stat = await lstat(paths.registryPath);
            if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('HOST_REGISTRY_UNSAFE');
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
            registryExists = false;
        }
        const registry = await readRegistry(paths.registryPath, { allowMissing: true });
        if (!registryExists) {
            try {
                const journalText = await readFile(paths.journalPath, 'utf8');
                if (journalText.length > 0) throw new Error('HOST_REGISTRY_MISSING_WITH_HISTORY');
            } catch (error) {
                if (error?.code !== 'ENOENT') throw error;
            }
        }
        const existing = registry.conversations.find(item => item.conversationId === conversationId);
        const candidate = { conversationId, sourceLocator, ...(sourcePath === undefined ? {} : { sourcePath }), domain, enrolledAt: new Date().toISOString() };
        if (existing) {
            if (existing.sourceLocator !== sourceLocator || existing.domain !== domain
                || (sourcePath !== undefined && existing.sourcePath !== sourcePath)) throw new Error('HOST_ENROLLMENT_IDENTITY_CONFLICT');
            await ensureEnrollmentMarker(paths);
            return { status: 'ALREADY_ENROLLED' };
        }
        if (!registryExists) {
            const journalHandle = await open(paths.journalPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
            try {
                await journalHandle.sync();
            } finally {
                await journalHandle.close();
            }
        }
        // Persist the loss-detection marker before making enrollment durable.
        // A crash after the registry write must never leave an enrolled history
        // without its sibling marker.
        await ensureEnrollmentMarker(paths);
        registry.conversations.push(candidate);
        registry.conversations.sort((a, b) => a.conversationId.localeCompare(b.conversationId));
        await atomicWriteJson(paths.registryPath, registry);
        return { status: 'ENROLLED' };
    } finally {
        release();
    }
}



/**
 * Record a digest/lifecycle acknowledgement only after Core has accepted the
 * corresponding capture. This lets the server snapshot distinguish an explicit
 * accepted tombstone from an unexplained disappearance in the current file.
 */
export async function recordHostCaptureAcknowledgement(request, capture) {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!request?.user?.directories || !capture || typeof capture !== 'object'
        || typeof capture.conversation_id !== 'string'
        || typeof capture.message_id !== 'string' || !uuidPattern.test(capture.message_id)
        || typeof capture.version_id !== 'string' || !uuidPattern.test(capture.version_id)
        || !Object.hasOwn(capture, 'parent_version_id')
        || !(capture.parent_version_id === null || (typeof capture.parent_version_id === 'string' && uuidPattern.test(capture.parent_version_id)))
        || typeof capture.content_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(capture.content_sha256)
        || typeof capture.active !== 'boolean' || typeof capture.deleted !== 'boolean'
        || (capture.deleted && capture.active)) {
        throw new Error('HOST_CAPTURE_ACK_INVALID');
    }
    const paths = await statePaths(request);
    const registry = await readRegistry(paths.registryPath);
    const enrollment = registry.conversations.find(item => item.conversationId === capture.conversation_id);
    if (!enrollment || typeof enrollment.sourcePath !== 'string') throw new Error('HOST_CAPTURE_ACK_NOT_ENROLLED');
    const userKey = digest(String(request.user.profile?.handle ?? paths.roots[0].path));
    const release = await acquireUserLock(userKey);
    try {
        const chain = await readAndValidateJournal(paths.journalPath);
        if (chain.unresolved || chain.degraded) throw new Error('HOST_CAPTURE_ACK_JOURNAL_UNRESOLVED');
        const prior = [...chain.records].reverse().find(record =>
            record.kind === 'capture_ack'
            && record.conversation_id === capture.conversation_id
            && record.message_id === capture.message_id
            && record.version_id === capture.version_id);
        if (prior) {
            if (prior.content_sha256 !== capture.content_sha256
                || prior.parent_version_id !== capture.parent_version_id) throw new Error('HOST_CAPTURE_ACK_LINEAGE_CONFLICT');
            if (prior.deleted && !capture.deleted) throw new Error('HOST_CAPTURE_ACK_TOMBSTONE_REAPPEARED');
            if (prior.deleted === capture.deleted && prior.active === capture.active) return { status: 'ALREADY_ACKNOWLEDGED' };
        } else if (capture.deleted) {
            throw new Error('HOST_CAPTURE_ACK_TOMBSTONE_UNKNOWN');
        }
        await appendRecord(paths.journalPath, chain.lastHash, {
            version: 1,
            kind: 'capture_ack',
            operationId: randomUUID(),
            conversation_id: capture.conversation_id,
            message_id: capture.message_id,
            version_id: capture.version_id,
            parent_version_id: capture.parent_version_id,
            content_sha256: capture.content_sha256,
            active: capture.active,
            deleted: capture.deleted,
            acknowledgedAt: new Date().toISOString(),
        });
        return { status: 'ACKNOWLEDGED' };
    } finally {
        release();
    }
}


/** Persist a Core conflict response so later inventory scans cannot silently recover. */
export async function recordHostCaptureConflict(request, capture, upstreamStatus) {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (upstreamStatus !== 409 || !request?.user?.directories || !capture || typeof capture !== 'object'
        || typeof capture.conversation_id !== 'string'
        || typeof capture.message_id !== 'string' || !uuidPattern.test(capture.message_id)
        || typeof capture.version_id !== 'string' || !uuidPattern.test(capture.version_id)
        || !Object.hasOwn(capture, 'parent_version_id')
        || !(capture.parent_version_id === null || (typeof capture.parent_version_id === 'string' && uuidPattern.test(capture.parent_version_id)))
        || typeof capture.content_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(capture.content_sha256)
        || typeof capture.active !== 'boolean' || typeof capture.deleted !== 'boolean'
        || (capture.deleted && capture.active)) throw new Error('HOST_CAPTURE_CONFLICT_INVALID');
    const paths = await statePaths(request);
    const registry = await readRegistry(paths.registryPath);
    if (!registry.conversations.some(item => item.conversationId === capture.conversation_id)) throw new Error('HOST_CAPTURE_CONFLICT_NOT_ENROLLED');
    const userKey = digest(String(request.user.profile?.handle ?? paths.roots[0].path));
    const release = await acquireUserLock(userKey);
    try {
        const chain = await readAndValidateJournal(paths.journalPath);
        if (chain.unresolved || chain.degraded) throw new Error('HOST_CAPTURE_CONFLICT_JOURNAL_UNRESOLVED');
        const prior = chain.records.find(record => record.kind === 'capture_conflict'
            && record.conversation_id === capture.conversation_id && record.message_id === capture.message_id
            && record.version_id === capture.version_id && record.content_sha256 === capture.content_sha256
            && record.parent_version_id === capture.parent_version_id);
        if (prior) return { status: 'ALREADY_RECORDED' };
        await appendRecord(paths.journalPath, chain.lastHash, {
            version: 1, kind: 'capture_conflict', operationId: randomUUID(),
            conversation_id: capture.conversation_id, message_id: capture.message_id,
            version_id: capture.version_id, parent_version_id: capture.parent_version_id,
            content_sha256: capture.content_sha256,
            active: capture.active, deleted: capture.deleted, upstreamStatus: 409,
            recordedAt: new Date().toISOString(),
        });
        return { status: 'RECORDED' };
    } finally { release(); }
}

/**
 * Read the persisted JSONL source for every explicitly enrolled conversation.
 * This reports current identities/swipes only; it never upgrades Host trust,
 * historical completeness, or rollback resistance.
 */
export async function getHostConversationInventory(request) {
    const paths = await statePaths(request);
    const registry = await readRegistry(paths.registryPath);
    if (!registry.conversations.length) {
        return {
            status: 'INVENTORY_INCOMPLETE',
            complete: false,
            authority: 'NON_AUTHORITATIVE',
            historicalCompleteness: 'UNKNOWN',
            inventories: [],
            errors: ['NO_ENROLLED_CONVERSATIONS'],
        };
    }
    const journal = await readAndValidateJournal(paths.journalPath);
    if (journal.records.some(record => record.kind === 'capture_conflict'
        && record.upstreamStatus === 409
        && registry.conversations.some(item => item.conversationId === record.conversation_id))) {
        return {
            status: 'INVENTORY_INCOMPLETE',
            complete: false,
            authority: 'NON_AUTHORITATIVE',
            historicalCompleteness: 'UNKNOWN',
            inventories: [],
            errors: ['CORE_CAPTURE_CONFLICT_RECORDED'],
            mutationJournal: { integrity: 'LOCAL_HASH_CHAIN_VALID', recordCount: journal.records.length, headHash: journal.lastHash, unresolved: journal.unresolved, degraded: journal.degraded, snapshotConsistency: 'CORE_CAPTURE_CONFLICT_RECORDED' },
        };
    }
    const journalSummary = {
        integrity: 'LOCAL_HASH_CHAIN_VALID',
        recordCount: journal.records.length,
        headHash: journal.lastHash,
        unresolved: journal.unresolved,
        degraded: journal.degraded,
    };
    if (journal.unresolved || journal.degraded) {
        return {
            status: 'INVENTORY_INCOMPLETE',
            complete: false,
            authority: 'NON_AUTHORITATIVE',
            historicalCompleteness: 'UNKNOWN',
            mutationJournal: { ...journalSummary, snapshotConsistency: 'UNRESOLVED_OR_DEGRADED' },
            inventories: [],
            errors: [journal.unresolved ? 'HOST_MUTATION_JOURNAL_HAS_UNRESOLVED_OPERATIONS' : 'HOST_MUTATION_JOURNAL_IS_DEGRADED'],
        };
    }
    const snapshot = await scanPersistedConversationInventories(
        paths.roots.filter(root => root.domain === 'chats' || root.domain === 'group_chats'),
        registry.conversations,
    );
    if (!snapshot.complete) return { ...snapshot, mutationJournal: { ...journalSummary, snapshotConsistency: 'CURRENT_INVENTORY_INCOMPLETE' } };

    const lastCommittedInventory = [...journal.records].reverse().find(record =>
        record.kind === 'outcome' && record.status === 'COMMITTED'
        && typeof record.afterConversationInventoryDigest === 'string');
    if (lastCommittedInventory && lastCommittedInventory.afterConversationInventoryDigest !== snapshot.inventory_sha256) {
        return {
            ...snapshot,
            status: 'INVENTORY_INCOMPLETE',
            complete: false,
            authority: 'NON_AUTHORITATIVE',
            historicalCompleteness: 'UNKNOWN',
            inventories: [],
            mutationJournal: { ...journalSummary, snapshotConsistency: 'DIVERGES_FROM_LAST_LOCAL_CHECKPOINT' },
            errors: ['CURRENT_SNAPSHOT_DIVERGES_FROM_LAST_COMMITTED_JOURNAL_SNAPSHOT'],
        };
    }
    const currentInventorySha256 = snapshot.inventory_sha256;
    const enrolledIds = new Set(registry.conversations.map(item => item.conversationId));
    const currentVersions = new Map();
    const observedVersions = new Map();
    const captureAcks = new Map();
    const inventoryErrors = [];
    const versionKey = item => JSON.stringify([item.conversation_id, item.message_id, item.version_id]);
    const observeVersion = item => {
        const key = versionKey(item);
        const prior = observedVersions.get(key);
        if (prior && (prior.payload_sha256 !== item.payload_sha256
            || (prior.parent_version_id ?? null) !== (item.parent_version_id ?? null))) {
            inventoryErrors.push('OBSERVED_VERSION_IDENTITY_CONFLICT');
            return;
        }
        observedVersions.set(key, {
            conversation_id: item.conversation_id,
            message_id: item.message_id,
            version_id: item.version_id,
            payload_sha256: item.payload_sha256,
            parent_version_id: item.parent_version_id ?? null,
        });
    };
    for (const record of journal.records) {
        for (const field of ['beforeConversationInventories', 'afterConversationInventories']) {
            if (!Array.isArray(record[field])) continue;
            for (const conversation of record[field]) {
                for (const version of conversation.versions ?? []) {
                    observeVersion({
                        conversation_id: conversation.conversation_id,
                        message_id: version.message_id,
                        version_id: version.version_id,
                        payload_sha256: version.payload_sha256,
                        parent_version_id: version.parent_version_id,
                    });
                }
            }
        }
        if (record.kind !== 'capture_ack') continue;
        if (!enrolledIds.has(record.conversation_id)
            || typeof record.message_id !== 'string' || typeof record.version_id !== 'string'
            || typeof record.content_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(record.content_sha256)
            || typeof record.active !== 'boolean' || typeof record.deleted !== 'boolean'
            || (record.deleted && record.active)) {
            inventoryErrors.push('CAPTURE_ACK_RECORD_INVALID');
            continue;
        }
        const key = versionKey(record);
        const prior = captureAcks.get(key);
        if (prior && prior.content_sha256 !== record.content_sha256) inventoryErrors.push('CAPTURE_ACK_DIGEST_CONFLICT');
        if (prior?.deleted && !record.deleted) inventoryErrors.push('CAPTURE_ACK_TOMBSTONE_REAPPEARED');
        if (record.deleted && !prior) inventoryErrors.push('CAPTURE_ACK_TOMBSTONE_WITHOUT_PRIOR_CAPTURE');
        captureAcks.set(key, record);
        observeVersion({
            conversation_id: record.conversation_id,
            message_id: record.message_id,
            version_id: record.version_id,
            payload_sha256: record.content_sha256,
            parent_version_id: record.parent_version_id ?? null,
        });
    }
    for (const conversation of snapshot.inventories) {
        for (const version of conversation.versions) {
            const key = versionKey({ conversation_id: conversation.conversation_id, ...version });
            currentVersions.set(key, { conversation_id: conversation.conversation_id, ...version, deleted: false });
            const ack = captureAcks.get(key);
            if (!ack) inventoryErrors.push('CURRENT_VERSION_NOT_ACKNOWLEDGED_BY_CORE');
            else if (ack.deleted) inventoryErrors.push('TOMBSTONED_VERSION_REAPPEARED');
            else if (ack.content_sha256 !== version.payload_sha256) inventoryErrors.push('CURRENT_VERSION_DIGEST_DIFFERS_FROM_CORE_ACK');
            else if (ack.active !== version.active) inventoryErrors.push('CURRENT_ACTIVE_POINTER_DIFFERS_FROM_CORE_ACK');
        }
    }
    const completeVersions = [];
    for (const [key, version] of currentVersions) completeVersions.push(version);
    for (const [key, ack] of captureAcks) {
        if (ack.deleted) {
            if (currentVersions.has(key)) inventoryErrors.push('TOMBSTONED_VERSION_REAPPEARED');
            const observed = observedVersions.get(key);
            completeVersions.push({
                conversation_id: ack.conversation_id,
                message_id: ack.message_id,
                version_id: ack.version_id,
                payload_sha256: ack.content_sha256,
                parent_version_id: observed?.parent_version_id ?? null,
                active: false,
                deleted: true,
            });
        } else if (!currentVersions.has(key)) {
            inventoryErrors.push('VERSION_DISAPPEARED_WITHOUT_ACCEPTED_TOMBSTONE');
        }
    }
    for (const [key, observed] of observedVersions) {
        if (!currentVersions.has(key) && !captureAcks.get(key)?.deleted) {
            inventoryErrors.push('OBSERVED_VERSION_DISAPPEARED_WITHOUT_ACCEPTED_TOMBSTONE');
        }
    }
    if (inventoryErrors.length) {
        return {
            ...snapshot,
            status: 'INVENTORY_INCOMPLETE',
            complete: false,
            authority: 'NON_AUTHORITATIVE',
            historicalCompleteness: 'UNKNOWN',
            current_inventory_sha256: currentInventorySha256,
            inventories: [],
            mutationJournal: { ...journalSummary, snapshotConsistency: 'VERSION_HISTORY_INCOMPLETE' },
            errors: [...new Set(inventoryErrors)].sort(),
        };
    }

    completeVersions.sort((a, b) => a.conversation_id.localeCompare(b.conversation_id)
        || a.message_id.localeCompare(b.message_id) || a.version_id.localeCompare(b.version_id));
    const inventoryByConversation = new Map(snapshot.inventories.map(item => [item.conversation_id, item]));
    const allInventories = [];
    for (const [conversationId, current] of inventoryByConversation) {
        const inventory = {
            ...current,
            current_version_count: current.version_count,
            versions: completeVersions.filter(version => version.conversation_id === conversationId)
                .map(({ conversation_id, ...version }) => version),
        };
        inventory.version_count = inventory.versions.length;
        delete inventory.inventory_sha256;
        inventory.inventory_sha256 = digest(canonical(stableValue(inventory)));
        allInventories.push(inventory);
    }
    allInventories.sort((a, b) => a.conversation_id.localeCompare(b.conversation_id));
    return {
        ...snapshot,
        status: 'ENROLLMENT_FORWARD_ONLY_OBSERVED_INVENTORY_NON_AUTHORITATIVE',
        historicalCompleteness: 'ENROLLMENT_FORWARD_ONLY',
        preEnrollmentHistory: 'EXCLUDED',
        current_inventory_sha256: currentInventorySha256,
        inventory_sha256: digest(canonical(stableValue(allInventories))),
        currentVersionCount: snapshot.versionCount,
        versionCount: completeVersions.length,
        inventories: allInventories,
        captureAcknowledgements: 'CORE_ACCEPTED_DIGESTS_AND_TOMBSTONES',
        mutationJournal: {
            ...journalSummary,
            snapshotConsistency: lastCommittedInventory ? 'MATCHES_LAST_COMMITTED_LOCAL_CHECKPOINT' : 'NO_COMMITTED_INVENTORY_CHECKPOINT',
        },
    };
}

/**
 * Prepare an ephemeral, server-owned one-shot capability for an exact
 * enrolled-chat save. The proposed text exists only in request memory; only
 * SHA-256 digests and identity/lineage metadata are retained in the capability.
 */
export async function prepareHostSaveCapability(request, { route, payload } = {}) {
    purgeExpiredSaveCapabilities();
    const target = resolveSaveTarget(route, payload);
    const paths = await statePaths(request);
    const registry = await readRegistry(paths.registryPath);
    if (!registry.conversations.length) return { status: 'NOT_ENROLLED' };

    const proposedHeaderUuid = payload.chat?.[0]?.chat_metadata?.logic_engine_conversation_id;
    const targetEnrollment = registry.conversations.find(item =>
        item.domain === target.domain && item.sourcePath === target.sourcePath);
    const markerEnrollment = registry.conversations.find(item =>
        item.conversationId.split(':')[1] === proposedHeaderUuid);

    if (!targetEnrollment) {
        if (markerEnrollment) throw new Error('HOST_SAVE_CAPABILITY_TARGET_MISMATCH');
        return { status: 'NOT_ENROLLED' };
    }
    if (markerEnrollment && markerEnrollment.conversationId !== targetEnrollment.conversationId) {
        throw new Error('HOST_SAVE_CAPABILITY_TARGET_MISMATCH');
    }
    if (proposedHeaderUuid !== targetEnrollment.conversationId.split(':')[1]) {
        throw new Error('HOST_SAVE_CAPABILITY_TARGET_MISMATCH');
    }
    if (typeof request.sessionID !== 'string' || !request.sessionID
        || typeof request.user?.profile?.handle !== 'string' || !request.user.profile.handle) {
        throw new Error('HOST_SAVE_CAPABILITY_SESSION_REQUIRED');
    }

    const userKey = digest(String(request.user.profile.handle));
    const release = await acquireUserLock(userKey);
    try {
        const chain = await readAndValidateJournal(paths.journalPath);
        if (chain.unresolved || chain.degraded) throw new Error('HOST_SAVE_CAPABILITY_JOURNAL_NOT_READY');
        const before = await scanMutationSnapshot(paths, registry, true);
        if (!before.complete || !before.conversationInventory?.complete) {
            throw new Error('HOST_SAVE_CAPABILITY_INVENTORY_NOT_READY');
        }
        const observedInventory = await getHostConversationInventory(request);
        if (!observedInventory.complete) throw new Error('HOST_SAVE_CAPABILITY_INVENTORY_NOT_READY');

        const currentInventory = before.conversationInventory.inventories.find(
            item => item.conversation_id === targetEnrollment.conversationId,
        );
        if (!currentInventory) throw new Error('HOST_SAVE_CAPABILITY_TARGET_NOT_IN_INVENTORY');
        const root = paths.roots.find(item => item.domain === target.domain)?.path;
        if (!root) throw new Error('HOST_SAVE_CAPABILITY_ROOT_UNAVAILABLE');
        const sourcePath = path.resolve(root, ...target.sourcePath.split('/'));
        const relative = path.relative(root, sourcePath);
        if (!relative || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
            throw new Error('HOST_SAVE_CAPABILITY_PATH_UNSAFE');
        }
        const currentArtifactDigest = targetArtifactDigest(before, target);
        if (typeof currentArtifactDigest !== 'string') throw new Error('HOST_SAVE_CAPABILITY_SOURCE_NOT_IN_INVENTORY');
        const currentFile = await readStableHostChatFile(sourcePath, currentArtifactDigest);
        const expectedUuid = targetEnrollment.conversationId.split(':')[1];
        const currentProjection = finalizeProjectedHostInventory(
            projectHostChatRecords(currentFile.records, expectedUuid),
            targetEnrollment,
        );
        if (canonical(stableValue(currentFile.records[0])) !== canonical(stableValue(payload.chat[0]))) {
            throw new Error('HOST_SAVE_CAPABILITY_HEADER_CHANGED');
        }
        if (currentProjection.inventory.inventory_sha256 !== currentInventory.inventory_sha256) {
            throw new Error('HOST_SAVE_CAPABILITY_PRESTATE_INVENTORY_MISMATCH');
        }

        const proposedProjection = finalizeProjectedHostInventory(
            projectHostChatRecords(payload.chat, expectedUuid),
            targetEnrollment,
        );
        const transition = classifyHostSaveTransition(currentProjection, proposedProjection);
        if (!transition) throw new Error('HOST_SAVE_CAPABILITY_TRANSITION_UNSUPPORTED');

        const postStateInventoryDigest = overallProjectedInventoryDigest(
            before.conversationInventory,
            proposedProjection.inventory,
            targetEnrollment.conversationId,
        );
        const token = randomBytes(32).toString('base64url');
        const expiresAt = Date.now() + SAVE_CAPABILITY_TTL_MS;
        saveCapabilities.set(digest(token), {
            sessionId: request.sessionID,
            userHandle: request.user.profile.handle,
            route,
            operation: transition,
            domain: target.domain,
            sourcePath: target.sourcePath,
            conversationId: targetEnrollment.conversationId,
            enrollment: targetEnrollment,
            preStateFileDigest: currentFile.fileDigest,
            preStateInventoryDigest: before.conversationInventory.inventory_sha256,
            postStateFileDigest: payloadFileDigest(payload),
            postStateInventoryDigest,
            payloadDigest: digest(canonical(stableValue(payload))),
            expiresAt,
        });
        return { status: 'CAPABILITY_ISSUED', token, expiresAt };
    } finally {
        release();
    }
}

