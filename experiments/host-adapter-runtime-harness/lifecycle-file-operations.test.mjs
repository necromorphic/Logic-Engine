import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { HostLifecycleJournal } from '../../src/application/host-lifecycle-journal.js';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';

import { withWindowsVssSnapshot } from '../../host-adapter/prototype/windows-vss-snapshot.mjs';
import { enumerateStableFileInventoryFromWindowsSnapshot } from '../../host-adapter/prototype/fs-inventory.js';

const stRoot = resolve(process.env.SILLYTAVERN_DIR ?? 'SillyTavern');
const expectedSha = '06bde939fb1e9c4c8d8641d810f0a916b5bce127';
const runPinnedSTHarness = process.env.LOGIC_ENGINE_RUN_ST_LIFECYCLE_HARNESS === '1';
let express;
let chatsRouter;
let backupsRouter;
if (runPinnedSTHarness) {
  const requireFromST = createRequire(resolve(stRoot, 'package.json'));
  express = requireFromST('express');
  const stUtil = await import(pathToFileURL(resolve(stRoot, 'src/util.js')).href);
  stUtil.setConfigFilePath(resolve(stRoot, 'default/config.yaml'));
  ({ router: chatsRouter } = await import(pathToFileURL(resolve(stRoot, 'src/endpoints/chats.js')).href));
  ({ router: backupsRouter } = await import(pathToFileURL(resolve(stRoot, 'src/endpoints/backups.js')).href));
}

const sourceFingerprint = 'st-1.19.0-real-file-operation-harness';

const digest = value => createHash('sha256').update(value, 'utf8').digest('hex');
const identity = (messageId, versionId, mes, parentVersionId = null, versionIndex = 0) => ({
  messageId,
  versions: [{ versionId, versionIndex, payloadDigest: digest(mes), parentVersionId }],
  activeVersionIndex: versionIndex,
});
const header = () => ({
  user_name: 'Harness User',
  name: 'Harness Character',
  character_name: 'Harness Character',
  create_date: '2026-10-31 @00h 00m 00s 000ms',
  chat_metadata: { logic_engine_conversation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
});
const userMessage = (mes = 'first user message', versionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', parentVersionId = null) => ({
  name: 'Harness User', is_user: true, mes, send_date: '2026-10-31T00:00:00.000Z',
  _logicEngineLifecycle: identity('cccccccc-cccc-4ccc-8ccc-cccccccccccc', versionId, mes, parentVersionId),
});
const assistantMessage = (mes = 'first reply', versionId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd') => ({
  name: 'Harness Character', is_user: false, mes, send_date: '2026-10-31T00:00:01.000Z',
  _logicEngineLifecycle: identity('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', versionId, mes),
});
const editedUserMessage = () => ({
  ...userMessage('edited user message'),
  _logicEngineLifecycle: {
    messageId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    versions: [
      { versionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', versionIndex: 0,
        payloadDigest: digest('ST_HARNESS_RAW_CHAT_SENTINEL'), parentVersionId: null },
      { versionId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', versionIndex: 1,
        payloadDigest: digest('edited user message'), parentVersionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
    ],
    activeVersionIndex: 1,
  },
});
const identifiedHeader = (conversationId, name = 'Harness Character') => ({
  user_name: 'Harness User',
  name,
  character_name: name,
  create_date: '2026-10-31 @00h 00m 00s 000ms',
  chat_metadata: { logic_engine_conversation_id: conversationId },
});
const identifiedMessage = ({ name = 'Harness User', isUser = true, mes, messageId, versionId }) => ({
  name,
  is_user: isUser,
  mes,
  send_date: '2026-10-31T00:00:03.000Z',
  _logicEngineLifecycle: identity(messageId, versionId, mes),
});

test('pinned ST 1.19.0 chat create/edit/swipe/delete/import/export/restore mutate real files and produce file-level deltas', {
  skip: process.platform !== 'win32' || !runPinnedSTHarness,
  timeout: 600_000,
}, async t => {
  const { execFileSync } = await import('node:child_process');
  const actualSha = execFileSync('git', ['-C', stRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.equal(actualSha, expectedSha, 'real-file harness must use the exact pinned SillyTavern commit');

  const parent = await mkdtemp(join(tmpdir(), 'logic-engine-st-1.19-real-ops-'));
  const root = join(parent, 'data');
  const uploads = join(parent, 'uploads');
  const identityDirectory = join(parent, 'host-identity');
  const previousIdentityDirectory = process.env.LOGIC_ENGINE_HOST_IDENTITY_DIR;
  const previousBuildClaim = process.env.LOGIC_ENGINE_HOST_BUILD_SHA;
  process.env.LOGIC_ENGINE_HOST_IDENTITY_DIR = identityDirectory;
  process.env.LOGIC_ENGINE_HOST_BUILD_SHA = expectedSha;
  t.after(() => {
    if (previousIdentityDirectory === undefined) delete process.env.LOGIC_ENGINE_HOST_IDENTITY_DIR;
    else process.env.LOGIC_ENGINE_HOST_IDENTITY_DIR = previousIdentityDirectory;
    if (previousBuildClaim === undefined) delete process.env.LOGIC_ENGINE_HOST_BUILD_SHA;
    else process.env.LOGIC_ENGINE_HOST_BUILD_SHA = previousBuildClaim;
  });
  const { router: hostInventoryRouter } = await import(
    pathToFileURL(resolve(stRoot, 'src/endpoints/logic-engine-host-inventory.js')).href + '?lifecycle-harness'
  );
  const directories = {
    root,
    chats: join(root, 'chats'),
    groups: join(root, 'groups'),
    groupChats: join(root, 'group chats'),
    backups: join(root, 'backups'),
    characters: join(root, 'characters'),
  };
  await Promise.all([
    mkdir(directories.chats, { recursive: true }),
    mkdir(directories.groups, { recursive: true }),
    mkdir(directories.groupChats, { recursive: true }),
    mkdir(directories.backups, { recursive: true }),
    mkdir(directories.characters, { recursive: true }),
    mkdir(uploads, { recursive: true }),
    mkdir(identityDirectory, { recursive: true }),
    mkdir(join(directories.chats, 'Harness Character'), { recursive: true }),
  ]);

  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use((request, _response, next) => {
    const operationHandle = typeof request.headers['x-harness-operation'] === 'string'
      ? 'logic-engine-harness-' + request.headers['x-harness-operation']
      : 'logic-engine-harness';
    request.user = { profile: { handle: operationHandle }, directories };
    request.session = {
      handle: operationHandle,
      logicEngineSessionId: '99999999-9999-4999-8999-999999999999',
      logicEngineSessionHandle: operationHandle,
    };
    const uploadName = request.headers['x-harness-upload'];
    if (typeof uploadName === 'string' && uploadName && !uploadName.includes('..') && !uploadName.includes('/') && !uploadName.includes('\\')) {
      request.file = { destination: uploads, filename: uploadName };
    }
    next();
  });
  app.use('/api/chats', chatsRouter);
  app.use('/api/backups', backupsRouter);
  app.use('/api/logic-engine/host', hostInventoryRouter);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  t.after(async () => {
    await new Promise(resolveClose => server.close(resolveClose));
    try { journal?.close(); } catch {}
    await rm(parent, { recursive: true, force: true });
  });
  const get = async path => {
    const response = await fetch('http://127.0.0.1:' + address.port + path);
    return { status: response.status, result: await response.json() };
  };
  const post = async (path, body, headers = {}) => {
    const response = await fetch('http://127.0.0.1:' + address.port + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body ?? {}),
    });
    const type = response.headers.get('content-type') || '';
    const result = type.includes('application/json') ? await response.json() : await response.text();
    return { status: response.status, result };
  };
  const scan = async () => withWindowsVssSnapshot(root, async lease => {
    const inventory = await enumerateStableFileInventoryFromWindowsSnapshot(lease);
    assert.equal(inventory.status, 'complete', JSON.stringify(inventory));
    assert.equal(typeof inventory.root, 'string');
    return inventory;
  });
  const settleBackups = async () => {
    // ST schedules backup writes independently of the save response. Wait for
    // those real files to settle so the next baseline cannot race a prior save.
    await new Promise(resolveDelay => setTimeout(resolveDelay, 1200));
    let previous = null;
    let stable = 0;
    for (let attempt = 0; attempt < 30; attempt++) {
      const names = (await readdir(directories.backups)).sort();
      const metadata = await Promise.all(names.map(async name => {
        const fileStat = await stat(join(directories.backups, name));
        return [name, fileStat.size, fileStat.mtimeMs, fileStat.ctimeMs];
      }));
      const fingerprint = JSON.stringify(metadata);
      if (fingerprint === previous) stable += 1;
      else stable = 0;
      if (stable >= 3) return;
      previous = fingerprint;
      await new Promise(resolveDelay => setTimeout(resolveDelay, 100));
    }
    throw new Error('ST chat backup directory did not become stable');
  };
  const coreStateDirectory = join(parent, 'core-state');
  await mkdir(coreStateDirectory, { recursive: true });
  const hostInstallationId = '11111111-1111-4111-8111-111111111111';
  const authenticatedAccountId = '22222222-2222-4222-8222-222222222222';
  const rootId = digest(resolve(root));
  const coreJournalPath = join(coreStateDirectory, 'host-lifecycle.sqlite');
  const coordinatorPath = join(coreStateDirectory, 'coordinator.sqlite');
  const createCoreJournal = () => new HostLifecycleJournal({
    path: coreJournalPath,
    coordinatorPath,
    resolveIdentity: input => ({
      authorized: input.host_installation_id === hostInstallationId
        && input.authenticated_account_id === authenticatedAccountId,
      host_installation_id: input.host_installation_id,
      authenticated_account_id: input.authenticated_account_id,
      host_session_id: input.host_session_id,
      conversation_uuid: input.conversation_uuid,
      adapter_id: 'st-1.19-harness',
      root_id: rootId,
      authority_id: 'st-1.19-harness-authority',
      generation: 1,
      snapshot_fingerprint: 'a'.repeat(64),
    }),
    resolveRootIdentity: input => ({
      authorized: input.host_installation_id === hostInstallationId
        && input.authenticated_account_id === authenticatedAccountId
        && input.root_id === rootId,
      host_installation_id: input.host_installation_id,
      authenticated_account_id: input.authenticated_account_id,
      root_id: input.root_id,
    }),
    verifyMutationReceipt: () => true,
  });
  let journal = createCoreJournal();
  let baselineCreated = false;
  const observe = async (operation, expectedKind) => {
    const before = await scan();
    const canonicalRoot = before.root;
    assert.equal(digest(resolve(canonicalRoot)), rootId, 'Core root identity must be bound to the exact data root');
    if (!baselineCreated) {
      const baseline = journal.enrollRootInventory({
        host_installation_id: hostInstallationId,
        authenticated_account_id: authenticatedAccountId,
        root_id: rootId,
        event_id: randomUUID(),
        entries: before.entries,
      });
      assert.equal(baseline.status, 'BASELINED_REVIEW_ONLY', JSON.stringify(baseline));
      baselineCreated = true;
    } else {
      const integrity = journal.verifyRootInventory({
        host_installation_id: hostInstallationId,
        authenticated_account_id: authenticatedAccountId,
        root_id: rootId,
      });
      assert.equal(integrity.status, 'INTEGRITY_OK', JSON.stringify(integrity));
      journal.close();
      journal = createCoreJournal();
      const afterRestart = journal.verifyRootInventory({
        host_installation_id: hostInstallationId,
        authenticated_account_id: authenticatedAccountId,
        root_id: rootId,
      });
      assert.equal(afterRestart.status, 'INTEGRITY_OK', 'SQLite baseline and hash chain must survive Core journal restart');
    }
    const outcome = await operation();
    await settleBackups();
    const after = await scan();
    assert.equal(after.root, canonicalRoot, 'VSS must preserve one canonical root identity across snapshots');
    const result = journal.observeRootInventory({
      host_installation_id: hostInstallationId,
      authenticated_account_id: authenticatedAccountId,
      root_id: rootId,
      event_id: randomUUID(),
      entries: after.entries,
    });
    const counts = result.delta
      ? Object.fromEntries(Object.entries(result.delta).map(([key, rows]) => [key, rows.length]))
      : {};
    if (expectedKind === 'unchanged') {
      assert.ok(['UNCHANGED_REVIEW_ONLY', 'NON_READY'].includes(result.status), JSON.stringify(result));
      if (result.status === 'NON_READY') {
        assert.match(result.reason ?? '', /previously observed root inventory delta remains unresolved/,
          'unchanged bytes after a previously observed delta must remain unresolved, not erase history');
      }
    } else {
      assert.equal(result.status, 'NON_READY', JSON.stringify(result));
      const expectedKinds = Array.isArray(expectedKind) ? expectedKind : [expectedKind];
      assert.ok(expectedKinds.some(kind => counts[kind] > 0), JSON.stringify(counts));
      const journalRows = journal.db.prepare('SELECT canonical_event_json FROM host_root_inventory_events').all();
      assert.equal(JSON.stringify(journalRows).includes('ST_HARNESS_RAW_CHAT_SENTINEL'), false,
        'Core SQLite inventory journal must retain file digests, not raw chat text');
    }
    const verified = journal.verifyRootInventory({
      host_installation_id: hostInstallationId,
      authenticated_account_id: authenticatedAccountId,
      root_id: rootId,
    });
    assert.equal(verified.status, 'INTEGRITY_OK', JSON.stringify(verified));
    return { outcome, result: { ...result, counts } };
  };

  const chatPath = join(directories.chats, 'Harness Character', 'chat-one.jsonl');
  const initialChat = [
    header(),
    userMessage('ST_HARNESS_RAW_CHAT_SENTINEL'),
    assistantMessage(),
  ];
  const create = await observe(async () => {
    const response = await post('/api/chats/save', {
      avatar_url: 'Harness Character.png', file_name: 'chat-one', chat: initialChat, force: true,
    }, { 'x-harness-operation': 'create' });
    assert.equal(response.status, 200, JSON.stringify(response));
    assert.equal(response.result.ok, true);
    const persisted = (await readFile(chatPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(persisted[1]._logicEngineLifecycle.messageId, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    assert.equal(persisted[1]._logicEngineLifecycle.versions.length, 1);
    assert.equal(Object.hasOwn(persisted[1], 'swipe_info'), false,
      'user-message identity must live on the message, not an absent swipe_info array');
    assert.equal(persisted[2]._logicEngineLifecycle.messageId, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
    assert.equal(persisted[1].mes, 'ST_HARNESS_RAW_CHAT_SENTINEL');
    return response;
  }, 'added');
  assert.ok(create.result.delta.added.some(entry => entry.path.endsWith('chat-one.jsonl')));

  const editedChat = [header(), editedUserMessage(), assistantMessage()];
  const edit = await observe(async () => {
    const response = await post('/api/chats/save', {
      avatar_url: 'Harness Character.png', file_name: 'chat-one', chat: editedChat, force: true,
    }, { 'x-harness-operation': 'edit' });
    assert.equal(response.status, 200);
    assert.equal(response.result.ok, true);
    return response;
  }, ['modified', 'replaced']);
  assert.ok([...edit.result.delta.modified, ...edit.result.delta.replaced].some(entry => entry.path.endsWith('chat-one.jsonl')));
  const editedPersisted = (await readFile(chatPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(editedPersisted[1]._logicEngineLifecycle.versions.length, 2);
  assert.equal(editedPersisted[1]._logicEngineLifecycle.versions[1].versionId, 'ffffffff-ffff-4fff-8fff-ffffffffffff');
  assert.equal(editedPersisted[1]._logicEngineLifecycle.versions[1].parentVersionId, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

  const swipeChat = [header(), editedUserMessage(), {
    ...assistantMessage('second reply'),
    swipes: ['first reply', 'second reply'],
    swipe_id: 1,
    swipe_info: [{ send_date: '2026-10-31T00:00:01.000Z' }, { send_date: '2026-10-31T00:00:02.000Z' }],
    _logicEngineLifecycle: {
      messageId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      versions: [
        { versionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', versionIndex: 0, payloadDigest: digest('first reply'), parentVersionId: null },
        { versionId: '11111111-1111-4111-8111-111111111111', versionIndex: 1, payloadDigest: digest('second reply'), parentVersionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
      ],
      activeVersionIndex: 1,
    },
  }];
  const swipe = await observe(async () => {
    const response = await post('/api/chats/save', {
      avatar_url: 'Harness Character.png', file_name: 'chat-one', chat: swipeChat, force: true,
    }, { 'x-harness-operation': 'swipe' });
    assert.equal(response.status, 200);
    assert.equal(response.result.ok, true);
    const saved = await readFile(chatPath, 'utf8');
    assert.ok(saved.includes('"swipes":["first reply","second reply"]'));
    assert.ok(saved.includes('"swipe_id":1'));
    const persisted = saved.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(persisted[2]._logicEngineLifecycle.versions.length, 2);
    assert.equal(persisted[2]._logicEngineLifecycle.activeVersionIndex, 1);
    assert.equal(persisted[2]._logicEngineLifecycle.versions[1].parentVersionId, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd');
    return response;
  }, ['modified', 'replaced']);
  assert.ok([...swipe.result.delta.modified, ...swipe.result.delta.replaced].some(entry => entry.path.endsWith('chat-one.jsonl')));

  const deleteMessageChat = [
    header(),
    editedUserMessage(),
  ];
  const deleteMessage = await observe(async () => {
    const response = await post('/api/chats/save', {
      avatar_url: 'Harness Character.png', file_name: 'chat-one', chat: deleteMessageChat, force: true,
    }, { 'x-harness-operation': 'delete-message' });
    assert.equal(response.status, 200);
    assert.equal(response.result.ok, true);
    return response;
  }, ['modified', 'replaced']);
  assert.ok([...deleteMessage.result.delta.modified, ...deleteMessage.result.delta.replaced].some(entry => entry.path.endsWith('chat-one.jsonl')));

  const exportResult = await observe(async () => {
    const response = await post('/api/chats/export', {
      avatar_url: 'Harness Character.png', file: 'chat-one.jsonl', format: 'jsonl',
      exportfilename: 'chat-one.jsonl', is_group: false,
    });
    assert.equal(response.status, 200);
    assert.ok(response.result.result.includes('Harness User'));
    return response;
  }, 'unchanged');
  assert.equal(exportResult.result.status, 'NON_READY');
  assert.match(exportResult.result.reason ?? '', /previously observed root inventory delta remains unresolved/,
    'an unchanged export cannot clear prior unresolved filesystem deltas');

  const renamedPath = join(directories.chats, 'Harness Character', 'chat-renamed.jsonl');
  const rename = await observe(async () => {
    const response = await post('/api/chats/rename', {
      avatar_url: 'Harness Character.png', original_file: 'chat-one.jsonl', renamed_file: 'chat-renamed.jsonl',
    });
    assert.equal(response.status, 200);
    assert.equal(response.result.ok, true);
    assert.equal((await readFile(renamedPath, 'utf8')).length > 0, true);
    return response;
  }, ['added', 'moved']);
  const renamedInPlace = rename.result.delta.moved.some(entry =>
    entry.from.endsWith('chat-one.jsonl') && entry.to.endsWith('chat-renamed.jsonl'));
  const renamedAsReplace = rename.result.delta.removed.some(entry => entry.path.endsWith('chat-one.jsonl'))
    && rename.result.delta.added.some(entry => entry.path.endsWith('chat-renamed.jsonl'));
  assert.ok(renamedInPlace || renamedAsReplace, JSON.stringify(rename.result.delta));

  const importUpload = 'import-chat.jsonl';
  await writeFile(join(uploads, importUpload), JSON.stringify(identifiedHeader(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  )) + '\n' + JSON.stringify(identifiedMessage({
    mes: 'imported message',
    messageId: '22222222-2222-4222-8222-222222222222',
    versionId: '33333333-3333-4333-8333-333333333333',
  })) + '\n');
  const imported = await observe(async () => {
    const response = await post('/api/chats/import', {
      file_type: 'jsonl', avatar_url: 'Harness Character.png',
      user_name: 'Harness User', character_name: 'Harness Character',
    }, { 'x-harness-upload': importUpload, 'x-harness-operation': 'import' });
    assert.equal(response.status, 200, JSON.stringify(response));
    assert.equal(response.result.res, true);
    assert.equal(response.result.fileNames.length, 1);
    return response;
  }, 'added');
  assert.ok(imported.result.delta.added.some(entry => entry.path.startsWith('chats/Harness Character/')));

  const backupName = 'chat_harness_restore.jsonl';
  await writeFile(join(directories.backups, backupName), JSON.stringify(identifiedHeader(
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  )) + '\n' + JSON.stringify(identifiedMessage({
    mes: 'restored backup message',
    messageId: '44444444-4444-4444-8444-444444444444',
    versionId: '55555555-5555-4555-8555-555555555555',
  })) + '\n');
  const restored = await observe(async () => {
    const download = await post('/api/backups/chat/download', { name: backupName });
    assert.equal(download.status, 200);
    const restoreUpload = 'restore-chat.jsonl';
    await writeFile(join(uploads, restoreUpload), download.result);
    const response = await post('/api/chats/import', {
      file_type: 'jsonl', avatar_url: 'Harness Character.png',
      user_name: 'Harness User', character_name: 'Harness Character',
    }, { 'x-harness-upload': restoreUpload, 'x-harness-operation': 'restore' });
    assert.equal(response.status, 200, JSON.stringify(response));
    assert.equal(response.result.res, true);
    return response;
  }, 'added');
  assert.ok(restored.result.delta.added.some(entry => entry.path.startsWith('chats/Harness Character/')));

  const groupUpload = 'group-chat.jsonl';
  await writeFile(join(uploads, groupUpload), JSON.stringify(identifiedHeader(
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Harness Group'
  )) + '\n' + JSON.stringify(identifiedMessage({
    name: 'Harness User',
    mes: 'group imported message',
    messageId: '66666666-6666-4666-8666-666666666666',
    versionId: '77777777-7777-4777-8777-777777777777',
  })) + '\n');
  const groupMetadataPath = join(directories.groups, 'group-harness.json');
  let importedGroupChatId = null;
  const groupImport = await observe(async () => {
    const response = await post('/api/chats/group/import', {}, { 'x-harness-upload': groupUpload });
    assert.equal(response.status, 200, JSON.stringify(response));
    assert.equal(typeof response.result.res, 'string');
    importedGroupChatId = response.result.res.replace(/\.jsonl$/i, '');
    await writeFile(groupMetadataPath, JSON.stringify({
      id: 'group-harness',
      chats: [importedGroupChatId],
    }));
    return response;
  }, 'added');
  assert.ok(groupImport.result.delta.added.some(entry => entry.path.startsWith('group chats/')));
  assert.ok(groupImport.result.delta.added.some(entry => entry.path.endsWith('group-harness.json')));

  const groupSave = await observe(async () => {
    const response = await post('/api/chats/group/save', {
      id: 'group-harness', chat: [
        identifiedHeader('88888888-8888-4888-8888-888888888888', 'Harness Group'),
        identifiedMessage({ mes: 'group save', messageId: '12121212-1212-4212-8212-121212121212', versionId: '13131313-1313-4313-8313-131313131313' }),
        identifiedMessage({ name: 'Harness Group', isUser: false, mes: 'group reply', messageId: '14141414-1414-4414-8414-141414141414', versionId: '15151515-1515-4515-8515-151515151515' }),
      ], force: true,
    }, { 'x-harness-operation': 'group-save' });
    assert.equal(response.status, 200);
    assert.equal(response.result.ok, true);
    const metadata = JSON.parse(await readFile(groupMetadataPath, 'utf8'));
    metadata.chats.push('group-harness');
    await writeFile(groupMetadataPath, JSON.stringify(metadata));
    return response;
  }, 'added');
  assert.ok(groupSave.result.delta.added.some(entry => entry.path.endsWith('group-harness.jsonl')));

  const groupDelete = await observe(async () => {
    const response = await post('/api/chats/group/delete', { id: 'group-harness' });
    assert.equal(response.status, 200);
    assert.equal(response.result.ok, true);
    const metadata = JSON.parse(await readFile(groupMetadataPath, 'utf8'));
    metadata.chats = metadata.chats.filter(id => id !== 'group-harness');
    await writeFile(groupMetadataPath, JSON.stringify(metadata));
    return response;
  }, 'removed');
  assert.ok(groupDelete.result.delta.removed.some(entry => entry.path.endsWith('group-harness.jsonl')));

  const sessionIdentity = await get('/api/logic-engine/host/session');
  assert.equal(sessionIdentity.status, 200);
  assert.equal(sessionIdentity.result.host_session_id, '99999999-9999-4999-8999-999999999999');
  const accountIdentity = await get('/api/logic-engine/host/identity');
  assert.equal(accountIdentity.status, 200);
  assert.match(accountIdentity.result.host_installation_id, /^[0-9a-f-]{36}$/i);
  assert.match(accountIdentity.result.authenticated_account_id, /^[0-9a-f-]{36}$/i);
  assert.equal(accountIdentity.result.host_session_id, sessionIdentity.result.host_session_id);
  const repeatedIdentity = await get('/api/logic-engine/host/identity');
  assert.equal(repeatedIdentity.result.host_installation_id, accountIdentity.result.host_installation_id);
  assert.equal(repeatedIdentity.result.authenticated_account_id, accountIdentity.result.authenticated_account_id);

  const { enumerateHostDataInventory } = await import(
    pathToFileURL(resolve(stRoot, 'src/endpoints/host-data-inventory.mjs')).href + '?inventory-diagnostic'
  );
  const diagnosticInventory = await enumerateHostDataInventory({
    directories,
    hostCommit: expectedSha,
  });
  assert.equal(diagnosticInventory.source.status, 'DOUBLE_SCAN_CANDIDATE',
    JSON.stringify(diagnosticInventory.source));
  assert.equal(diagnosticInventory.source.authority, 'NON_AUTHORITATIVE');
  const inventory = await get('/api/logic-engine/host/inventory?conversation_uuid=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.equal(inventory.status, 200, JSON.stringify(inventory.result));
  assert.equal(inventory.result.filesystem_inventory.status, 'complete');
  assert.equal(inventory.result.filesystem_inventory.snapshot_alignment, 'SHARED_VSS_SNAPSHOT');

  assert.ok(inventory.result.blockers.includes('NO_DURABLE_FULL_ROOT_BASELINE'));
  assert.ok(inventory.result.blockers.includes('NO_FULL_ROOT_PER_FILE_DIFF'));
  assert.equal(inventory.result.files.length, 1);
  assert.equal(inventory.result.files[0].logical_identity.conversation_uuid,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

  const deleteChat = await observe(async () => {
    const response = await post('/api/chats/delete', {
      avatar_url: 'Harness Character.png', chatfile: 'chat-renamed.jsonl',
    });
    assert.equal(response.status, 200);
    assert.equal(response.result.ok, true);
    return response;
  }, 'removed');
  assert.ok(deleteChat.result.delta.removed.some(entry => entry.path.endsWith('chat-renamed.jsonl')));
});
