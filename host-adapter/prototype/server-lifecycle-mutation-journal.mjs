import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readFile, lstat, realpath, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { scanHostArtifactRoots } from './server-inventory-scanner.mjs';

const MUTATIONS = new Map([
    ['POST /api/chats/save', 'chat-save'],
    ['POST /api/chats/rename', 'chat-rename'],
    ['POST /api/chats/delete', 'chat-delete'],
    ['POST /api/chats/group/import', 'group-chat-import'],
    ['POST /api/chats/import', 'chat-import'],
    ['POST /api/chats/group/delete', 'group-chat-delete'],
    ['POST /api/chats/group/save', 'group-chat-save'],
    ['POST /api/characters/rename', 'character-rename'],
    ['POST /api/characters/delete', 'character-delete'],
    ['POST /api/characters/import', 'character-import'],
    ['POST /api/characters/duplicate', 'character-duplicate'],
    ['POST /api/groups/create', 'group-create'],
    ['POST /api/groups/edit', 'group-edit'],
    ['POST /api/groups/delete', 'group-delete'],
    ['POST /api/backups/chat/delete', 'backup-delete'],
    ['POST /api/data-maid/delete', 'data-maid-delete'],
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
    return digest(canonical(scan.artifacts.map(item => [item.artifactId, item.byteLength, item.sha256])));
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
export function createHostLifecycleMutationMiddleware({ enforce = process.env.LOGIC_ENGINE_HOST_LIFECYCLE_ENFORCE === 'true' } = {}) {
    return async function hostLifecycleMutationMiddleware(request, response, next) {
        const operation = MUTATIONS.get(request.method + ' ' + request.baseUrl + request.path)
            ?? MUTATIONS.get(request.method + ' ' + request.originalUrl?.split('?')[0]);
        if (!operation || !request.user) return next();

        let paths;
        let registry;
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
            before = await scanHostArtifactRoots(paths.roots);
            if (!before.complete) {
                release();
                return fail(response, 'HOST_INVENTORY_INCOMPLETE');
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
            });
            chain.lastHash = recordHash;
        } catch {
            release();
            return fail(response, 'HOST_JOURNAL_PREPARE_FAILED');
        }

        const originalEnd = response.end.bind(response);
        let ending = false;
        response.end = function (...args) {
            if (ending) return response;
            ending = true;
            void (async () => {
                try {
                    const after = await scanHostArtifactRoots(paths.roots);
                    if (!after.complete) {
                        const hash = await appendRecord(paths.journalPath, chain.lastHash, {
                            version: 1,
                            kind: 'outcome',
                            operationId,
                            status: 'UNRESOLVED',
                            completedAt: new Date().toISOString(),
                            httpStatus: response.statusCode,
                            afterSnapshotStatus: after.status,
                        });
                        chain.lastHash = hash;
                        if (!response.headersSent) {
                            response.statusCode = 503;
                            response.setHeader('Content-Type', 'application/json; charset=utf-8');
                            return originalEnd(JSON.stringify({ error: { code: 'HOST_POST_MUTATION_SCAN_INCOMPLETE' } }));
                        }
                        return originalEnd(...args);
                    }
                    const changes = diffSnapshots(before, after);
                    const status = response.statusCode >= 200 && response.statusCode < 300 ? 'COMMITTED' : 'UNRESOLVED';
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
                    });
                    chain.lastHash = hash;
                    return originalEnd(...args);
                } catch {
                    if (!response.headersSent) {
                        response.statusCode = 503;
                        response.setHeader('Content-Type', 'application/json; charset=utf-8');
                        return originalEnd(JSON.stringify({ error: { code: 'HOST_JOURNAL_COMMIT_FAILED' } }));
                    }
                    return originalEnd(...args);
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

/**
 * Explicit Host enrollment registration. The registry is local Host state, not
 * an external anti-rollback authority and not a Core authorization contract.
 */
export async function registerHostConversation(request, { conversationId, sourceLocator, domain }) {
    if (typeof conversationId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(conversationId)) {
        throw new Error('HOST_ENROLLMENT_INVALID');
    }
    if (typeof sourceLocator !== 'string' || !sourceLocator || sourceLocator.length > 255
        || sourceLocator.includes('/') || sourceLocator.includes('\\') || sourceLocator === '.' || sourceLocator === '..') {
        throw new Error('HOST_ENROLLMENT_INVALID');
    }
    if (!['chats', 'group_chats'].includes(domain)) throw new Error('HOST_ENROLLMENT_INVALID');
    const paths = await statePaths(request);
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
    const candidate = { conversationId, sourceLocator, domain, enrolledAt: new Date().toISOString() };
    if (existing) {
        if (existing.sourceLocator !== sourceLocator || existing.domain !== domain) throw new Error('HOST_ENROLLMENT_IDENTITY_CONFLICT');
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
