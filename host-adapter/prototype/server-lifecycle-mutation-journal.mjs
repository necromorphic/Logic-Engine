import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readFile, lstat, realpath, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { scanHostArtifactRoots } from './server-inventory-scanner.mjs';
import { scanPersistedConversationInventories } from './persisted-conversation-inventory.mjs';

const MUTATIONS = new Map([
    ['POST /api/chats/save', 'chat-save'],
    ['POST /api/chats/rename', 'chat-rename'],
    ['POST /api/chats/delete', 'chat-delete'],
    ['POST /api/chats/group/import', 'group-chat-import'],
    ['POST /api/chats/import', 'chat-import'],
    ['POST /api/chats/group/delete', 'group-chat-delete'],
    ['POST /api/chats/group/save', 'group-chat-save'],
    ['POST /api/characters/rename', 'character-rename'],
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

]);

// Until identity-preserving, tombstone-aware server handlers exist, these routes
// can destroy or relocate enrolled chat state. Block them before the native
// handler runs; a 503 after deletion would be too late.
const UNSUPPORTED_ENROLLED_MUTATIONS = new Set([
    'chat-rename', 'chat-delete', 'group-chat-import', 'chat-import', 'group-chat-delete',
    'character-rename', 'character-edit', 'character-edit-attribute', 'character-merge-attributes',
    'character-delete', 'character-import', 'character-duplicate',
    'group-create', 'group-edit', 'group-delete', 'backup-delete', 'data-maid-delete',
]);

const digest = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value);
const stableValue = value => {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
    }
    return value;
};
const safeUserDirectories = request => {
    const directories = request.user?.directories;
    const roots = [
        { domain: 'chats', path: directories?.chats },
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
        await mkdir(stateDirectory, { mode: 0o700 });
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
        if (record.kind === 'outcome' && record.status === 'COMMITTED') pending.delete(record.operationId);
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

async function scanMutationSnapshot(paths, registry, requirePersistedInventory, compareCore = false) {
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
    if (compareCore) {
        try {
            await assertCoreInventoryMatchesSnapshot(conversationInventory, registry);
        } catch (error) {
            const code = ['CORE_HOST_INVENTORY_ROLLBACK_OR_DIVERGENCE', 'CORE_HOST_INVENTORY_NOT_READY']
                .includes(error?.message)
                ? error.message
                : 'CORE_HOST_INVENTORY_UNAVAILABLE';
            return {
                ...artifacts,
                status: 'INVENTORY_INCOMPLETE',
                complete: false,
                artifacts: [],
                artifactCount: null,
                conversationInventory: { ...conversationInventory, status: 'INVENTORY_INCOMPLETE', complete: false, inventories: [], errors: [code] },
                errors: [code],
            };
        }
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


async function publishCoreInventorySnapshot(before, after, { requirePersistedInventory = true } = {}) {
    // Artifact-only prototype mode is non-authoritative and has no version records to anchor.
    // Production wiring enables persisted inventory, where missing Core configuration remains a hard failure.
    if (!requirePersistedInventory) return;
    const baseUrl = process.env.LOGIC_ENGINE_CORE_URL;
    const apiToken = process.env.LOGIC_ENGINE_API_TOKEN;
    const adapterId = process.env.LOGIC_ENGINE_ADAPTER_ID;
    const adapterToken = process.env.LOGIC_ENGINE_ADAPTER_TOKEN;
    if (typeof baseUrl !== 'string' || !baseUrl.trim()
        || typeof apiToken !== 'string' || apiToken.length < 16
        || typeof adapterId !== 'string' || !adapterId.trim()
        || typeof adapterToken !== 'string' || adapterToken.length < 16) {
        throw new Error('CORE_HOST_CAPTURE_CONFIGURATION_MISSING');
    }
    const endpoint = new URL('/v1/host-version-ledger/capture', baseUrl);
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
        throw new Error('CORE_HOST_CAPTURE_CONFIGURATION_INVALID');
    }
    const flatten = snapshot => (snapshot?.conversationInventory?.inventories ?? []).flatMap(conversation =>
        (conversation.versions ?? []).map(version => ({
            conversation_id: conversation.conversation_id,
            message_id: version.message_id,
            version_id: version.version_id,
            content_sha256: version.payload_sha256,
            active: version.active,
            deleted: false,
        })),
    );
    const beforeVersions = flatten(before);
    const afterVersions = flatten(after);
    const key = version => JSON.stringify([version.conversation_id, version.message_id, version.version_id]);
    const afterKeys = new Set(afterVersions.map(key));
    const tombstones = beforeVersions
        .filter(version => !afterKeys.has(key(version)))
        .map(version => ({ ...version, active: false, deleted: true }));
    // Publish every current version, not just the diff: this also repairs a
    // previously missed idempotent capture. Inactive versions go first so the
    // active pointer is set last for each message.
    const entries = [
        ...afterVersions.sort((a, b) => Number(a.active) - Number(b.active)
            || a.conversation_id.localeCompare(b.conversation_id)
            || a.message_id.localeCompare(b.message_id)
            || a.version_id.localeCompare(b.version_id)),
        ...tombstones,
    ];
    for (const entry of entries) {
        const response = await fetch(endpoint, {
            method: 'POST',
            redirect: 'error',
            headers: {
                authorization: 'Bearer ' + apiToken,
                'content-type': 'application/json',
                'x-adapter-id': adapterId,
                'x-adapter-token': adapterToken,
            },
            body: JSON.stringify(entry),
            signal: AbortSignal.timeout(5000),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.capture
            || ['conflict', 'non_ready'].includes(payload.capture.status)) {
            throw new Error('CORE_HOST_CAPTURE_REJECTED');
        }
    }
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
export function createHostLifecycleMutationMiddleware({ enforce = process.env.LOGIC_ENGINE_HOST_LIFECYCLE_ENFORCE === 'true', requirePersistedInventory = false, requireCoreInventory = false } = {}) {
    return async function hostLifecycleMutationMiddleware(request, response, next) {
        const operation = MUTATIONS.get(request.method + ' ' + request.baseUrl + request.path)
            ?? MUTATIONS.get(request.method + ' ' + request.originalUrl?.split('?')[0]);
        if (!operation || !request.user) return next();

        let paths;
        let registry;
        let coreConfigured = false;
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
            const stateDirectory = path.join(path.dirname(canonicalChatRoot), '.logic-engine-host');
            try {
                const stateStat = await lstat(stateDirectory);
                if (!stateStat.isDirectory() || stateStat.isSymbolicLink()) throw new Error('HOST_STATE_DIRECTORY_UNSAFE');
            } catch (error) {
                if (error?.code === 'ENOENT') {
                    if (enforce) return fail(response, 'HOST_JOURNAL_UNAVAILABLE');
                    return next();
                }
                throw error;
            }
            const registryPath = path.join(stateDirectory, 'enrollments.json');
            registry = await readRegistry(registryPath);
            if (registry.conversations.length === 0) {
                if (enforce) return fail(response, 'HOST_ENROLLMENT_REQUIRED', 503);
                return next();
            }
            if (UNSUPPORTED_ENROLLED_MUTATIONS.has(operation)) {
                return fail(response, 'HOST_MUTATION_PATH_NOT_PROVEN', 503);
            }
            coreConfigured = Boolean(process.env.LOGIC_ENGINE_CORE_URL && process.env.LOGIC_ENGINE_API_TOKEN
                && process.env.LOGIC_ENGINE_ADAPTER_ID && process.env.LOGIC_ENGINE_ADAPTER_TOKEN);
            if (requireCoreInventory && !coreConfigured) {
                return fail(response, 'CORE_HOST_INVENTORY_CONFIGURATION_MISSING', 503);
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
        try {
            chain = await readAndValidateJournal(paths.journalPath);
            if (chain.unresolved) {
                release();
                return fail(response, 'HOST_JOURNAL_RECONCILIATION_REQUIRED');
            }
            before = await scanMutationSnapshot(paths, registry, requirePersistedInventory, requireCoreInventory && coreConfigured);
            if (!before.complete) {
                release();
                return fail(response, before.errors?.[0] ?? before.conversationInventory?.errors?.[0] ?? 'HOST_INVENTORY_INCOMPLETE');
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
        } catch (error) {
            release();
            const code = typeof error?.message === 'string'
                && /^(CORE_HOST_INVENTORY_[A-Z_]+|CORE_HOST_CAPTURE_[A-Z_]+)$/.test(error.message)
                ? error.message
                : 'HOST_JOURNAL_PREPARE_FAILED';
            return fail(response, code);
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
                    let after = await scanMutationSnapshot(paths, registry, requirePersistedInventory);
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
                    const isSuccess = response.statusCode >= 200 && response.statusCode < 300;
                    const persistence = isSuccess && requirePersistedInventory
                        ? verifyEnrolledChatSavePersistence(request, registry, after)
                        : null;
                    if (persistence && !persistence.ok) {
                        await appendRecord(paths.journalPath, chain.lastHash, {
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
                    try {
                        await publishCoreInventorySnapshot(before, after, { requirePersistedInventory });
                        after = await scanMutationSnapshot(paths, registry, requirePersistedInventory, requirePersistedInventory && coreConfigured);
                        if (!after.complete) {
                            const code = after.errors?.[0] ?? after.conversationInventory?.errors?.[0] ?? 'CORE_HOST_INVENTORY_UNAVAILABLE';
                            const hash = await appendRecord(paths.journalPath, chain.lastHash, {
                                version: 1,
                                kind: 'outcome',
                                operationId,
                                status: 'UNRESOLVED',
                                completedAt: new Date().toISOString(),
                                httpStatus: response.statusCode,
                                coreCaptureStatus: code,
                                afterSnapshotDigest: snapshotDigest(after),
                                afterArtifactCount: after.artifactCount,
                                afterConversationInventoryDigest: after.conversationInventory?.inventory_sha256 ?? null,
                                afterConversationInventories: after.conversationInventory?.inventories ?? null,
                            });
                            chain.lastHash = hash;
                            return commitBufferedResponse(args, {
                                status: 503,
                                body: JSON.stringify({ error: { code } }),
                            });
                        }
                    } catch {
                        const hash = await appendRecord(paths.journalPath, chain.lastHash, {
                            version: 1,
                            kind: 'outcome',
                            operationId,
                            status: 'UNRESOLVED',
                            completedAt: new Date().toISOString(),
                            httpStatus: response.statusCode,
                            coreCaptureStatus: 'FAILED',
                            afterSnapshotDigest: snapshotDigest(after),
                            afterArtifactCount: after.artifactCount,
                            afterConversationInventoryDigest: after.conversationInventory?.inventory_sha256 ?? null,
                            afterConversationInventories: after.conversationInventory?.inventories ?? null,
                        });
                        chain.lastHash = hash;
                        return commitBufferedResponse(args, {
                            status: 503,
                            body: JSON.stringify({ error: { code: 'CORE_HOST_CAPTURE_FAILED' } }),
                        });
                    }
                    const changes = diffSnapshots(before, after);
                    const status = isSuccess ? 'COMMITTED' : 'UNRESOLVED';
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
                        versionChanges: diffConversationInventories(before, after),
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
        if (!before.isFile() || before.dev !== after.dev || before.ino !== after.ino
            || before.size !== after.size || before.mtimeMs !== after.mtimeMs
            || before.ctimeMs !== after.ctimeMs || before.dev !== pathAfter.dev
            || before.ino !== pathAfter.ino || bytes.length !== after.size) {
            throw new Error('HOST_ENROLLMENT_SOURCE_CHANGED');
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
export async function registerHostConversation(request, { conversationId, sourceLocator, sourcePath, domain }) {
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
    registry.conversations.push(candidate);
    registry.conversations.sort((a, b) => a.conversationId.localeCompare(b.conversationId));
    await atomicWriteJson(paths.registryPath, registry);
    return { status: 'ENROLLED' };
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
            if (prior.content_sha256 !== capture.content_sha256) throw new Error('HOST_CAPTURE_ACK_DIGEST_CONFLICT');
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
            && record.version_id === capture.version_id && record.content_sha256 === capture.content_sha256);
        if (prior) return { status: 'ALREADY_RECORDED' };
        await appendRecord(paths.journalPath, chain.lastHash, {
            version: 1, kind: 'capture_conflict', operationId: randomUUID(),
            conversation_id: capture.conversation_id, message_id: capture.message_id,
            version_id: capture.version_id, content_sha256: capture.content_sha256,
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
async function readCoreHostVersionInventory(conversationId) {
    const baseUrl = process.env.LOGIC_ENGINE_CORE_URL;
    const apiToken = process.env.LOGIC_ENGINE_API_TOKEN;
    const adapterId = process.env.LOGIC_ENGINE_ADAPTER_ID;
    const adapterToken = process.env.LOGIC_ENGINE_ADAPTER_TOKEN;
    if (typeof baseUrl !== 'string' || !baseUrl.trim()
        || typeof apiToken !== 'string' || apiToken.length < 16
        || typeof adapterId !== 'string' || !adapterId.trim()
        || typeof adapterToken !== 'string' || adapterToken.length < 16) {
        throw new Error('CORE_HOST_INVENTORY_CONFIGURATION_MISSING');
    }
    const endpoint = new URL('/v1/host-version-ledger/inventory', baseUrl);
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
        throw new Error('CORE_HOST_INVENTORY_CONFIGURATION_INVALID');
    }
    const response = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
            authorization: 'Bearer ' + apiToken,
            'content-type': 'application/json',
            'x-adapter-id': adapterId,
            'x-adapter-token': adapterToken,
        },
        body: JSON.stringify({ conversation_id: conversationId }),
        signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('CORE_HOST_INVENTORY_UNAVAILABLE');
    const payload = await response.json().catch(() => null);
    const inventory = payload?.inventory;
    if (!inventory || inventory.authority !== 'CORE_HOST_VERSION_LEDGER'
        || inventory.conversation_id !== conversationId
        || !Array.isArray(inventory.versions)
        || !['READY', 'NON_READY'].includes(inventory.inventory_status)
        || inventory.versions.some(version => !version
            || typeof version.message_id !== 'string' || typeof version.version_id !== 'string'
            || typeof version.content_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(version.content_sha256)
            || typeof version.active !== 'boolean' || typeof version.deleted !== 'boolean'
            || (version.deleted && version.active))) {
        throw new Error('CORE_HOST_INVENTORY_INVALID');
    }
    return inventory;
}


async function assertCoreInventoryMatchesSnapshot(conversationInventory, registry) {
    const remoteInventories = await Promise.all(registry.conversations.map(item =>
        readCoreHostVersionInventory(item.conversationId)));
    const local = new Map();
    for (const conversation of conversationInventory.inventories ?? []) {
        for (const version of conversation.versions ?? []) {
            local.set(JSON.stringify([conversation.conversation_id, version.message_id, version.version_id]), {
                conversation_id: conversation.conversation_id,
                message_id: version.message_id,
                version_id: version.version_id,
                content_sha256: version.payload_sha256,
                active: version.active,
                deleted: false,
            });
        }
    }
    const remote = new Map();
    for (const inventory of remoteInventories) {
        for (const version of inventory.versions) {
            const item = { conversation_id: inventory.conversation_id, ...version };
            const key = JSON.stringify([item.conversation_id, item.message_id, item.version_id]);
            if (remote.has(key)) throw new Error('CORE_HOST_INVENTORY_ROLLBACK_OR_DIVERGENCE');
            remote.set(key, item);
        }
    }
    for (const [key, item] of remote) {
        const current = local.get(key);
        if (item.deleted) {
            if (current) throw new Error('CORE_HOST_INVENTORY_ROLLBACK_OR_DIVERGENCE');
        } else if (!current || current.content_sha256 !== item.content_sha256 || current.active !== item.active) {
            throw new Error('CORE_HOST_INVENTORY_ROLLBACK_OR_DIVERGENCE');
        }
    }
    for (const [key, item] of local) {
        const current = remote.get(key);
        if (!current || current.deleted || current.content_sha256 !== item.content_sha256 || current.active !== item.active) {
            throw new Error('CORE_HOST_INVENTORY_ROLLBACK_OR_DIVERGENCE');
        }
    }
    if (remoteInventories.some(inventory => inventory.inventory_status !== 'READY')) {
        throw new Error('CORE_HOST_INVENTORY_NOT_READY');
    }
}

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

    // Compare against Core's independently persisted digest ledger. Local chat
    // files and the local journal can be restored together; the Core ledger
    // must therefore be checked before local acknowledgements are trusted.
    let coreInventories;
    try {
        coreInventories = await Promise.all(registry.conversations.map(item =>
            readCoreHostVersionInventory(item.conversationId)));
    } catch {
        return {
            ...snapshot,
            status: 'INVENTORY_INCOMPLETE',
            complete: false,
            authority: 'NON_AUTHORITATIVE',
            historicalCompleteness: 'UNKNOWN',
            inventories: [],
            mutationJournal: { ...journalSummary, snapshotConsistency: 'CORE_ANCHOR_UNAVAILABLE' },
            errors: ['CORE_HOST_INVENTORY_UNAVAILABLE'],
        };
    }
    const localCoreCompare = new Map();
    for (const conversation of snapshot.inventories) {
        for (const version of conversation.versions) {
            const key = JSON.stringify([conversation.conversation_id, version.message_id, version.version_id]);
            localCoreCompare.set(key, { conversation_id: conversation.conversation_id, ...version, deleted: false });
        }
    }
    const remoteCoreCompare = new Map();
    let coreInventoryNotReady = false;
    for (let index = 0; index < coreInventories.length; index++) {
        const inventory = coreInventories[index];
        if (inventory.inventory_status !== 'READY') coreInventoryNotReady = true;
        for (const version of inventory.versions) {
            const item = { conversation_id: inventory.conversation_id, ...version, payload_sha256: version.content_sha256 };
            const key = JSON.stringify([item.conversation_id, item.message_id, item.version_id]);
            if (remoteCoreCompare.has(key)) {
                return {
                    ...snapshot, status: 'INVENTORY_INCOMPLETE', complete: false,
                    authority: 'NON_AUTHORITATIVE', historicalCompleteness: 'UNKNOWN', inventories: [],
                    mutationJournal: { ...journalSummary, snapshotConsistency: 'CORE_ANCHOR_IDENTITY_CONFLICT' },
                    errors: ['CORE_HOST_INVENTORY_IDENTITY_CONFLICT'],
                };
            }
            remoteCoreCompare.set(key, item);
        }
    }
    let coreInventoryMismatch = false;
    for (const [key, remote] of remoteCoreCompare) {
        const local = localCoreCompare.get(key);
        if (remote.deleted) {
            if (local) coreInventoryMismatch = true;
        } else if (!local || local.payload_sha256 !== remote.payload_sha256 || local.active !== remote.active) {
            coreInventoryMismatch = true;
        }
    }
    for (const [key, local] of localCoreCompare) {
        const remote = remoteCoreCompare.get(key);
        if (!remote || remote.deleted || remote.payload_sha256 !== local.payload_sha256 || remote.active !== local.active) {
            coreInventoryMismatch = true;
        }
    }
    if (coreInventoryMismatch) {
        return {
            ...snapshot,
            status: 'INVENTORY_INCOMPLETE',
            complete: false,
            authority: 'NON_AUTHORITATIVE',
            historicalCompleteness: 'UNKNOWN',
            inventories: [],
            mutationJournal: { ...journalSummary, snapshotConsistency: 'CORE_ANCHOR_DIVERGENCE' },
            errors: ['CORE_HOST_INVENTORY_ROLLBACK_OR_DIVERGENCE'],
        };
    }
    if (coreInventoryNotReady) {
        return {
            ...snapshot,
            status: 'INVENTORY_INCOMPLETE',
            complete: false,
            authority: 'NON_AUTHORITATIVE',
            historicalCompleteness: 'UNKNOWN',
            inventories: [],
            mutationJournal: { ...journalSummary, snapshotConsistency: 'CORE_ANCHOR_NOT_READY' },
            errors: ['CORE_HOST_INVENTORY_NOT_READY'],
        };
    }


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
            parent_version_id: observedVersions.get(key)?.parent_version_id ?? null,
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
