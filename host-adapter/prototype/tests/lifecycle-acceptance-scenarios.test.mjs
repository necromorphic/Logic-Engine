import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { webcrypto } from 'node:crypto';
import { HostLifecycleJournal } from '../lifecycle-journal.mjs';
import { createStLifecycleBridge } from '../st-lifecycle-bridge.mjs';

globalThis.crypto ??= webcrypto;
globalThis.IDBKeyRange = { only: value => ({ only: value }) };

class Request { result; error = null; onsuccess = null; onerror = null; }
class Store {
  constructor(db, tx, name) { this.db = db; this.tx = tx; this.name = name; }
  index() { return { getAll: range => { const r = new Request(); queueMicrotask(() => { r.result = [...this.db.rows.values()].filter(x => x.conversationId === range.only); r.onsuccess?.(); if (this.tx.mode === 'readonly') this.db.finish(this.tx); }); return r; } }; }
  get(key) { const r = new Request(); queueMicrotask(() => { r.result = this.db.heads.get(key); r.onsuccess?.(); if (this.tx.mode === 'readonly') this.db.finish(this.tx); }); return r; }
  add(row) { if (this.db.failNextWrite) { this.db.failNextWrite = false; throw Error('simulated disk full'); } if (this.db.rows.has(row.id)) throw Error('duplicate key'); this.db.rows.set(row.id, structuredClone(row)); queueMicrotask(() => this.db.finish(this.tx)); }
  put(row) { this.db.heads.set(row.conversationId, structuredClone(row)); queueMicrotask(() => this.db.finish(this.tx)); }
}
class Transaction {
  error = null; oncomplete = null; onerror = null; onabort = null;
  constructor(db, mode) { this.db = db; this.mode = mode; }
  objectStore(name) { return new Store(this.db, this, name); }
  abort() { this.error = Error('transaction aborted'); setImmediate(() => this.onabort?.()); }
}
class FakeDB {
  rows = new Map(); heads = new Map(); failNextWrite = false;
  transaction(names, mode = 'readonly') { return new Transaction(this, mode); }
  finish(tx) { setImmediate(() => tx.oncomplete?.()); }
}
function fixture() {
  const db = new FakeDB();
  const journal = new HostLifecycleJournal(db);
  const chat = [
    { is_user: true, mes: 'hello' },
    { is_user: false, mes: 'swipe A', swipes: ['swipe A', 'swipe B', 'swipe C'], swipe_id: 1 },
  ];
  const bridge = createStLifecycleBridge({
    journal, getConversationId: () => 'scenario-chat', getChat: () => chat,
    saveChat: async () => {},
  });
  return { db, journal, chat, bridge };
}

test('swipe deletion preserves surviving version IDs and does not treat selection as deletion', async () => {
  const f = fixture();
  await f.bridge.enrollCurrentConversation();
  const versions = f.chat[1]._logicEngineLifecycle.versions;
  const ids = versions.map(v => v.versionId);
  const activeBefore = f.chat[1]._logicEngineLifecycle.activeVersionIndex;
  assert.equal(activeBefore, 1);

  await f.bridge.beforeMutation('delete-swipe', [1], { swipeIndex: 1 });
  f.chat[1].swipes.splice(1, 1);
  f.chat[1].mes = 'swipe C';
  f.chat[1].swipe_id = 1;
  await f.bridge.afterMutation('delete-swipe', { removedSwipeIndex: 1, selectedMessageIndex: 1 });

  const after = f.chat[1]._logicEngineLifecycle;
  assert.deepEqual(after.versions.map(v => v.versionId), [ids[0], ids[2]]);
  assert.deepEqual(after.versions.map(v => v.versionIndex), [0, 1]);
  assert.equal(after.activeVersionIndex, 1);
  assert.equal((await f.journal.verifyIntegrity('scenario-chat')).status, 'INTEGRITY_OK');
});

test('lifecycle authority requires complete mutation coverage plus verified source and Core root proof', async () => {
  const f = fixture();
  await f.bridge.enrollCurrentConversation();
  const completeCoverage = [
    'create-message', 'message-send', 'message-receive', 'create-swipe', 'select-swipe',
    'delete-swipe', 'delete-message', 'delete-chat', 'delete-group-chat',
    'delete-character-chat-recursive', 'edit-message', 'persistence-ordering',
    'clear-chat', 'import', 'import-character-chat', 'import-group-chat', 'export',
    'copy-branch', 'restore', 'backup-restore', 'create-branch',
    'group-metadata-migration', 'chat-switch', 'external-edit', 'rollback', 'restart', 'replay',
  ];
  const incomplete = await f.journal.status('scenario-chat', {
    instrumentedPaths: completeCoverage.slice(0, -1),
    sourceFingerprintMatches: true,
    sourceIdentityStatus: 'CURRENT_IDENTITIES_VERIFIED',
    rootInventoryStatus: 'AUTHORITATIVE_COMPLETE',
  });
  assert.equal(incomplete.status, 'NON_READY');
  assert.ok(incomplete.missingPaths.includes('replay'));
  const ready = await f.journal.status('scenario-chat', {
    instrumentedPaths: completeCoverage,
    sourceFingerprintMatches: true,
    sourceIdentityStatus: 'CURRENT_IDENTITIES_VERIFIED',
    rootInventoryStatus: 'AUTHORITATIVE_COMPLETE',
  });
  assert.equal(ready.status, 'AUTHORITATIVE_COMPLETE');
  assert.equal(ready.baselineBoundary, 'enrollment-forward-only');
  const untrustedSource = await f.journal.status('scenario-chat', {
    instrumentedPaths: completeCoverage,
    sourceFingerprintMatches: true,
    sourceIdentityStatus: 'NON_READY',
    rootInventoryStatus: 'AUTHORITATIVE_COMPLETE',
  });
  assert.equal(untrustedSource.status, 'NON_READY');
});

test('write-ahead failure prevents the simulated destructive mutation', async () => {
  const f = fixture();
  await f.bridge.enrollCurrentConversation();
  const beforeText = f.chat[0].mes;
  f.db.failNextWrite = true;
  await assert.rejects(f.bridge.beforeMutation('delete-message', [0]), /MUST abort mutation/);
  // The host call site must await beforeMutation; this test models that contract.
  assert.equal(f.chat[0].mes, beforeText);
  assert.equal((await f.bridge.reconcileCurrentConversation()).status, 'NON_READY');
});

test('clear-chat is implemented as sequential delete-message receipts in the pinned ST patch', async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const patch = await readFile(resolve(here, '../patches/sillytavern-1.19.0-lifecycle-hooks.patch'), 'utf8');
  assert.ok(patch.includes('while (chat.length > 0)'), 'clear-chat must remove messages one at a time');
  assert.ok(patch.includes("beforeMutation('delete-message', [messageIndex], { bulkClear: true })"));
  assert.ok(patch.includes("afterMutation('delete-message', { bulkClear: true, deletedMessageIndex: messageIndex })"));
  const f = fixture();
  await f.bridge.enrollCurrentConversation();
  const readiness = await f.bridge.reconcileCurrentConversation();
  assert.equal(readiness.status, 'NON_READY');
  assert.ok(!readiness.missingPaths?.includes('clear-chat'));
  assert.match(readiness.reason ?? '', /trusted source identity and Core-authoritative root inventory are required/);
});

test('pinned patch explicitly hooks core mutations but does not pretend uncovered paths are hooked', async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const patch = await readFile(resolve(here, '../patches/sillytavern-1.19.0-lifecycle-hooks.patch'), 'utf8');
  for (const marker of [
    "beforeMutation('delete-message'",
    "beforeMutation('delete-swipe'",
    "beforeMutation('edit-message'",
    "afterMutation('delete-swipe'",
    "beforeMutation('select-swipe'",
    "afterMutation('select-swipe'",
    "['swipe', 'regenerate'].includes(type) ? 'create-swipe'",
  ]) assert.ok(patch.includes(marker), `expected pinned patch hook: ${marker}`);

  // These are explicit acceptance gaps, not passing coverage. Any future claim
  // of completeness must add native hooks and runtime evidence for them.
  for (const missing of ['cancel-generation', 'restore', 'import']) {
    assert.equal(patch.includes(`beforeMutation('${missing}'`), false, `unexpected unsupported claim: ${missing}`);
  }
});


test('direct enrolled-chat save APIs never gate native SillyTavern writes on Host permits', async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const patch = (await readFile(resolve(here, '../patches/sillytavern-1.19.0-lifecycle-hooks.patch'), 'utf8'))
    .replace(/\\r\\n/g, '\\n');
  const handler = await readFile(resolve(here, '../st-host-inventory-handler.mjs'), 'utf8');
  const proxy = await readFile(resolve(here, '../st-server-digest-proxy.mjs'), 'utf8');
  assert.ok(handler.includes('export function createHostLifecycleSaveGuard'));
  assert.ok(handler.includes('return next();'));
  assert.equal(handler.includes('HOST_LIFECYCLE_PREPARED_SAVE_REQUIRED'), false);
  assert.ok(patch.includes("import { createHostLifecycleSaveGuard } from './logic-engine-host-inventory-handler.mjs';"));
  assert.ok(patch.includes("router.post('/save', validateAvatarUrlMiddleware, hostLifecycleSaveGuard, async function (request, response) {"));
  assert.ok(patch.includes("router.post('/group/save', hostLifecycleSaveGuard, async function (request, response) {"));
  assert.ok(proxy.includes('session.logicEngineHostPreparedMutation = {'),
    'optional receipt preparation may still be recorded when available');
});test('pinned SillyTavern patch uses the existing authenticated inventory and digest-only Core proxies', async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const patch = await readFile(resolve(here, '../patches/sillytavern-1.19.0-lifecycle-hooks.patch'), 'utf8');
  const proxy = await readFile(resolve(here, '../st-server-digest-proxy.mjs'), 'utf8');

  assert.equal(patch.includes('logicEngineLifecycleRouter'), false);
  assert.equal(patch.includes('/api/logic-engine'), false);
  assert.ok(patch.includes("fetch('/api/plugins/logic-engine-extension-gateway/session'"));
  assert.ok(patch.includes("fetch('/api/plugins/logic-engine-extension-gateway/identity'"));
  assert.ok(patch.includes("fetch('/api/plugins/logic-engine-extension-gateway/inventory?conversation_uuid='"));
  assert.ok(patch.includes("fetch('/api/plugins/logic-engine-extension-gateway/host-version-ledger/reconcile'"));
  assert.ok(patch.includes("fetch('/api/plugins/logic-engine-extension-gateway/host-lifecycle/events'"));
  assert.ok(patch.includes("fetch('/api/plugins/logic-engine-extension-gateway/host-lifecycle/status?conversation_id='"));
  assert.ok(patch.includes("from '../../plugins/logic-engine-extension-gateway/st-host-inventory-handler.mjs'"));
  assert.ok(patch.includes('getLogicEngineHostIdentity'));
  assert.ok(patch.includes('hostInstallationId: identity.host_installation_id'));
  assert.ok(patch.includes('getPersistedInventory: async'));
  assert.ok(patch.includes("throw Error('Persisted Host inventory unavailable')"),
    'missing persisted inventory must fail closed');
  assert.ok(patch.includes("inventory?.host_user_handle !== session.host_user_handle"),
    'persisted inventory must remain bound to the authenticated ST account');
  assert.ok(patch.includes('logicEngineHostSessionPromise = null'));
  assert.ok(patch.includes('function invalidateLogicEngineHostIdentity()'));
  assert.ok(patch.includes('logicEngineHostIdentityPromise = null;'));
  assert.ok(patch.includes('logicEngineLifecycleBridgePromise = null;'));
  const accountMismatchGuard = patch.indexOf("inventory?.host_user_handle !== session.host_user_handle");
  const accountMismatchInvalidation = patch.indexOf("invalidateLogicEngineHostIdentity();", accountMismatchGuard);
  const accountMismatchFailure = patch.indexOf("Persisted Host inventory belongs to a different authenticated account", accountMismatchGuard);
  assert.ok(accountMismatchGuard >= 0 && accountMismatchInvalidation > accountMismatchGuard
    && accountMismatchFailure > accountMismatchInvalidation,
  'account mismatch must invalidate cached session, account identity, and journal bridge together');

  // The server proxy uses only deployment-owned credentials and the existing
  // digest-only Core route; no browser-selected upstream or world scope exists.
  assert.ok(proxy.includes("'/v1/host-version-ledger/capture'"));
  assert.ok(proxy.includes("'/v1/host-version-ledger/reconcile'"));
  assert.ok(proxy.includes('LOGIC_ENGINE_API_TOKEN'));
  assert.ok(proxy.includes('LOGIC_ENGINE_ADAPTER_TOKEN'));
  assert.ok(proxy.includes('HOST_SESSION_SCOPE_REQUIRED'));
  assert.ok(proxy.includes('requestMatchesAuthenticatedHostSession'));
  assert.equal(proxy.includes("'world_id'"), false);
});

test('pinned patch journals edit and swipe deletion only after awaited native save', async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const patch = await readFile(resolve(here, '../patches/sillytavern-1.19.0-lifecycle-hooks.patch'), 'utf8');

  const editEmit = patch.indexOf('await eventSource.emit(event_types.MESSAGE_UPDATED, this_edit_mes_id);');
  const editSave = patch.indexOf('await saveChatConditional();', editEmit);
  const editCheckpoint = patch.indexOf("lifecycleBridge.afterMutation('edit-message')", editEmit);
  assert.ok(editEmit >= 0 && editSave > editEmit && editCheckpoint > editSave,
    'edit checkpoint must follow the awaited native save');

  const swipeHook = patch.indexOf("beforeMutation('delete-swipe'");
  const swipeSave = patch.indexOf('await saveChatConditional();', swipeHook);
  const swipeCheckpoint = patch.indexOf("lifecycleBridge.afterMutation('delete-swipe'", swipeHook);
  assert.ok(swipeHook >= 0 && swipeSave > swipeHook && swipeCheckpoint > swipeSave,
    'swipe-delete checkpoint must follow the awaited native save');

  const deleteLastHook = patch.indexOf("beforeMutation('delete-message', [chat.length - 1])");
  const deleteLastSave = patch.indexOf('await saveChatConditional();', deleteLastHook);
  const deleteLastCheckpoint = patch.indexOf("lifecycleBridge.afterMutation('delete-message')", deleteLastHook);
  assert.ok(deleteLastHook >= 0 && deleteLastSave > deleteLastHook && deleteLastCheckpoint > deleteLastSave,
    'delete-last checkpoint must follow the awaited native save');

  const bulkDeleteHook = patch.indexOf("beforeMutation('delete-message', messageIds)");
  const bulkDeleteDebounce = patch.indexOf('saveChatDebounced();', bulkDeleteHook);
  const bulkDeleteSave = patch.indexOf('await saveChatConditional();', bulkDeleteDebounce);
  const bulkDeleteCheckpoint = patch.indexOf("lifecycleBridge.afterMutation('delete-message')", bulkDeleteHook);
  assert.ok(bulkDeleteHook >= 0 && bulkDeleteDebounce > bulkDeleteHook
    && bulkDeleteSave > bulkDeleteDebounce && bulkDeleteCheckpoint > bulkDeleteSave,
    'bulk-delete checkpoint must follow the awaited native save');
});


test('branch creation from an enrolled conversation is rejected before branch persistence', async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const patch = await readFile(resolve(here, '../patches/sillytavern-1.19.0-lifecycle-hooks.patch'), 'utf8');
  const bridgeExpose = patch.indexOf('guardOperation: async (operation, messageIndexes = [], details = {}) =>');
  const branchHook = patch.indexOf("guardOperation('create-branch', [mesId])");
  const branchEntry = patch.indexOf('if (!chat.length)', branchHook);
  assert.ok(bridgeExpose >= 0, 'the patched Host bridge must expose its existing operation guard to the branch entry point');
  assert.ok(branchHook > bridgeExpose, 'the branch entry point must call the Host guard');
  assert.ok(branchEntry > branchHook, 'the guard must run at function entry, before branch processing or persistence');
  const bridge = await readFile(resolve(here, '../st-lifecycle-bridge.mjs'), 'utf8');
  assert.ok(bridge.includes('NON_READY: unsupported/uninstrumented Host lifecycle operation '), 'unsupported enrolled operations must reject at the bridge boundary');
});


test('destructive and import UI entry points invoke target-aware fail-closed Host guards', async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const patch = await readFile(resolve(here, '../patches/sillytavern-1.19.0-lifecycle-hooks.patch'), 'utf8');
  const guards = [
    "await window.logicEngineHostLifecycle?.guardChatLocatorDeletion?.(chatfile.replace('.jsonl', ''));",
    "await window.logicEngineHostLifecycle?.guardChatLocatorDeletion?.(fileName);",
    "if (deleteChats) await window.logicEngineHostLifecycle?.guardBulkMutation();",
    "await window.logicEngineHostLifecycle?.guardBulkMutation();",
    "await window.logicEngineHostLifecycle.guardChatLocatorDeletion(chatName);",
    "await window.logicEngineHostLifecycle?.guardChatLocatorMutation?.(oldChatId);",
    "await window.logicEngineHostLifecycle?.guardChatLocatorDeletion?.(chatId);",
    "await window.logicEngineHostLifecycle.guardBulkMutation();",
  ];
  for (const guard of guards) {
    assert.ok(patch.includes(guard), `missing fail-closed Host guard: ${guard}`);
  }
  const assertBefore = (entry, guard, mutation) => {
    const start = patch.indexOf(entry);
    assert.ok(start >= 0, `missing Host entry point: ${entry}`);
    const chunk = patch.slice(start, start + 900);
    const guardAt = chunk.indexOf(guard);
    const mutationAt = chunk.indexOf(mutation);
    assert.ok(guardAt >= 0 && mutationAt >= 0 && guardAt < mutationAt,
      `guard must precede mutation in ${entry}`);
  };
  assertBefore('async function delChat(chatfile)', 'guardChatLocatorDeletion', "fetch('/api/chats/delete'");
  assertBefore('export async function deleteCharacterChatByName(characterId, fileName)', 'guardChatLocatorDeletion', 'unshallowCharacter(characterId)');
  assertBefore('async function deleteGroup(id)', 'guardBulkMutation', 'const group = groups.find');
  assertBefore('export async function renameGroupChat(groupId, oldChatId, newChatId)', 'guardChatLocatorMutation', 'const group = groups.find');
  assertBefore('export async function deleteGroupChatByName(groupId, chatName)', 'guardChatLocatorDeletion', 'const group = groups.find');
  assertBefore('export async function deleteGroupChat(groupId, chatId,', 'guardChatLocatorDeletion', 'const group = groups.find');
  assertBefore('export async function importCharacterChat(formData,', 'guardBulkMutation', "fetch('/api/chats/import'");
  assertBefore('export async function importGroupChat(formData,', 'guardBulkMutation', "fetch('/api/chats/group/import'");
  assertBefore('async restoreBackup(name)', 'guardBulkMutation', "fetch('/api/backups/chat/download'");
  assert.ok(patch.includes('diff --git a/src/endpoints/characters.js b/src/endpoints/characters.js'),
    'recursive character chat deletion needs a server-side guard');
  for (const route of [
    "+router.post('/rename', hostBulkMutationGuard, validateAvatarUrlMiddleware, async function (request, response) {",
    "+router.post('/delete', hostBulkMutationGuard, validateAvatarUrlMiddleware, async function (request, response) {",
  ]) {
    assert.ok(patch.includes(route), `missing server-side lifecycle guard on ${route}`);
  }
  assert.ok(patch.includes('diff --git a/src/endpoints/groups.js b/src/endpoints/groups.js'),
    'group metadata/chat deletion needs a server-side route guard');
  assert.ok(patch.includes("+router.post('/delete', hostBulkMutationGuard, getFileNameValidationFunction('id'), async (request, response) => {"),
    'group delete endpoint must guard its multi-file unlink operation');
  assert.ok(patch.includes("const hostBulkMutationGuard = createHostBulkMutationGuard({ pinnedHostCommit: '06bde939fb1e9c4c8d8641d810f0a916b5bce127' });"),
    'group delete must use the pinned inventory guard');
  assert.ok(patch.includes("guardExport: async () =>"));
  const exportEntry = patch.indexOf("$(document).on('click', '.exportChatButton, .exportRawChatButton'");
  assert.ok(exportEntry >= 0, 'missing chat export entry point');
  const exportChunk = patch.slice(exportEntry, exportEntry + 700);
  assert.ok(exportChunk.indexOf('guardExport?.()') >= 0
    && exportChunk.indexOf('guardExport?.()') < exportChunk.indexOf('await saveChatConditional();'),
  'enrolled chat export must verify persisted state before its save');
});

test('pinned patch guards Data Maid, settings restore, account reset and account deletion', async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const patch = await readFile(resolve(here, '../patches/sillytavern-1.19.0-lifecycle-hooks.patch'), 'utf8');
  const rootMutationPatch = await readFile(resolve(here, '../patches/sillytavern-1.19.0-root-mutation-guards.patch'), 'utf8');
  const reviewedPatches = patch + '\\n' + rootMutationPatch;
  for (const required of [
    "+router.post('/delete', hostBulkMutationGuard, async (req, res) => {",
    "+router.post('/export', validateAvatarUrlMiddleware, hostBulkMutationGuard, async function (request, response) {",
    "+router.post('/restore-snapshot', hostBulkMutationGuard, getFileNameValidationFunction('name'), async (request, response) => {",
    "+router.post('/reset-settings', hostBulkMutationGuard, async (request, response) => {",
    "+router.post('/recover-step2', hostUnsupportedMutationGuard, async (request, response) => {",
    "HOST_USER_ROOT_RESET_UNSUPPORTED",
    "HOST_USER_ACCOUNT_DELETE_UNSUPPORTED",
    "comfy.post('/save-workflow', hostUnsupportedMutationGuard, async (request, response) => {",
    "comfy.post('/delete-workflow', hostUnsupportedMutationGuard, async (request, response) => {",
    "comfy.post('/rename-workflow', hostUnsupportedMutationGuard, getFileNameValidationFunction('old_name')",
    "assertHostStartupMigrationAllowed",
    "Skipping startup group metadata migration:",
  ]) {
    assert.ok(reviewedPatches.includes(required), `missing fail-closed lifecycle protection: ${required}`);
  }
  assert.equal(reviewedPatches.includes('/api/logic-engine'), false,
    'additional mutation guards must not add a separate public Host API route');
});


test('Host identity permits first-run user directory bootstrap but rejects missing directories for existing users', async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const patch = await readFile(resolve(here, '../patches/sillytavern-1.19.0-lifecycle-hooks.patch'), 'utf8');
  const rootCheck = patch.indexOf('const userRootExists = fs.existsSync(userDirectories.root);');
  const guardedFailure = patch.indexOf("if (process.env.LOGIC_ENGINE_HOST_IDENTITY_DIR && userRootExists)", rootCheck);
  const failure = patch.indexOf("throw new Error('HOST_LIFECYCLE_USER_DIRECTORY_MISSING');", guardedFailure);
  const mkdir = patch.indexOf("fs.mkdirSync(dir, { recursive: true });", failure);
  assert.ok(rootCheck >= 0, 'first-run detection must use the authenticated user root');
  assert.ok(guardedFailure > rootCheck, 'the fail-closed guard must be conditional on a pre-existing user root');
  assert.ok(failure > guardedFailure && mkdir > failure,
    'existing-user integrity failures must stop before creating missing directories');
});
