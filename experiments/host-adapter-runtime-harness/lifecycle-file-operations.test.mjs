import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';

import { withWindowsVssSnapshot } from '../../host-adapter/prototype/windows-vss-snapshot.mjs';
import { enumerateStableFileInventoryFromWindowsSnapshot } from '../../host-adapter/prototype/fs-inventory.js';
import { reconcileFilesystemInventory } from '../../host-adapter/prototype/filesystem-reconciliation.mjs';

const stRoot = resolve(process.env.SILLYTAVERN_DIR ?? 'SillyTavern');
const expectedSha = '06bde939fb1e9c4c8d8641d810f0a916b5bce127';
const requireFromST = createRequire(resolve(stRoot, 'package.json'));
const express = requireFromST('express');
const stUtil = await import(pathToFileURL(resolve(stRoot, 'src/util.js')).href);
stUtil.setConfigFilePath(resolve(stRoot, 'default/config.yaml'));
const { router: chatsRouter } = await import(pathToFileURL(resolve(stRoot, 'src/endpoints/chats.js')).href);
const { router: backupsRouter } = await import(pathToFileURL(resolve(stRoot, 'src/endpoints/backups.js')).href);

const sourceFingerprint = 'st-1.19.0-real-file-operation-harness';

class TestJournal {
  records = [];
  async verifyIntegrity() {
    return { status: 'INTEGRITY_OK', sourceFingerprint };
  }
  async pendingMutation() {
    return { status: 'NO_PENDING_MUTATION' };
  }
  async exportCaptureLedger() {
    return { records: structuredClone(this.records), sequence: this.records.length };
  }
  async append({ operation, payload }) {
    const row = { sequence: this.records.length + 1, operation, payload: structuredClone(payload) };
    this.records.push(row);
    return row;
  }
}

const digest = value => createHash('sha256').update(value, 'utf8').digest('hex');
const identity = (messageId, versionId, mes, parentVersionId = null, versionIndex = 0) => ({
  messageId,
  versions: [{ versionId, versionIndex, payloadDigest: digest(mes), parentVersionId }],
  activeVersionIndex: versionIndex,
});
const header = () => ({
  user_name: 'Harness User',
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

test('pinned ST 1.19.0 chat create/edit/swipe/delete/import/export/restore mutate real files and produce file-level deltas', {
  skip: process.platform !== 'win32',
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
    request.user = { profile: { handle: 'logic-engine-harness' }, directories };
    request.session = {
      handle: 'logic-engine-harness',
      logicEngineSessionId: '99999999-9999-4999-8999-999999999999',
      logicEngineSessionHandle: 'logic-engine-harness',
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
  const observe = async (operation, expectedKind) => {
    const journal = new TestJournal();
    const before = await scan();
    const canonicalRoot = before.root;
    const baseline = await reconcileFilesystemInventory({
      journal, conversationId: 'st-harness-conversation', inventory: before,
      sourceFingerprint, expectedRoot: canonicalRoot,
    });
    assert.equal(baseline.status, 'BASELINED_REVIEW_ONLY');
    const outcome = await operation();
    await settleBackups();
    const after = await scan();
    assert.equal(after.root, canonicalRoot, 'VSS must preserve one canonical root identity across snapshots');
    const result = await reconcileFilesystemInventory({
      journal, conversationId: 'st-harness-conversation', inventory: after,
      sourceFingerprint, expectedRoot: canonicalRoot,
    });
    if (expectedKind === 'unchanged') {
      assert.equal(result.status, 'UNCHANGED_REVIEW_ONLY', JSON.stringify(result));
    } else {
      assert.equal(result.status, 'NON_READY', JSON.stringify(result));
      const expectedKinds = Array.isArray(expectedKind) ? expectedKind : [expectedKind];
      assert.ok(expectedKinds.some(kind => result.counts[kind] > 0), JSON.stringify(result.counts));
      assert.equal(JSON.stringify(journal.records).includes('ST_HARNESS_RAW_CHAT_SENTINEL'), false,
        'the lifecycle evidence journal must retain digests, not raw chat text');
    }
    return { outcome, result };
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
    });
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

  const editedChat = [header(), userMessage('edited user message', 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), assistantMessage()];
  const edit = await observe(async () => {
    const response = await post('/api/chats/save', {
      avatar_url: 'Harness Character.png', file_name: 'chat-one', chat: editedChat, force: true,
    });
    assert.equal(response.status, 200);
    assert.equal(response.result.ok, true);
    return response;
  }, ['modified', 'replaced']);
  assert.ok([...edit.result.delta.modified, ...edit.result.delta.replaced].some(entry => entry.path.endsWith('chat-one.jsonl')));
  const editedPersisted = (await readFile(chatPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(editedPersisted[1]._logicEngineLifecycle.versions[0].versionId, 'ffffffff-ffff-4fff-8fff-ffffffffffff');
  assert.equal(editedPersisted[1]._logicEngineLifecycle.versions[0].parentVersionId, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

  const swipeChat = [header(), userMessage('edited user message', 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), {
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
    });
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
    userMessage('edited user message', 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  ];
  const deleteMessage = await observe(async () => {
    const response = await post('/api/chats/save', {
      avatar_url: 'Harness Character.png', file_name: 'chat-one', chat: deleteMessageChat, force: true,
    });
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
  assert.equal(exportResult.result.status, 'UNCHANGED_REVIEW_ONLY');

  const renamedPath = join(directories.chats, 'Harness Character', 'chat-renamed.jsonl');
  const rename = await observe(async () => {
    const response = await post('/api/chats/rename', {
      avatar_url: 'Harness Character.png', original_file: 'chat-one.jsonl', renamed_file: 'chat-renamed.jsonl',
    });
    assert.equal(response.status, 200);
    assert.equal(response.result.ok, true);
    assert.equal((await readFile(renamedPath, 'utf8')).length > 0, true);
    return response;
  }, 'added');
  assert.ok(rename.result.delta.removed.some(entry => entry.path.endsWith('chat-one.jsonl')));
  assert.ok(rename.result.delta.added.some(entry => entry.path.endsWith('chat-renamed.jsonl')));

  const importUpload = 'import-chat.jsonl';
  await writeFile(join(uploads, importUpload), JSON.stringify({
    user_name: 'Harness User', name: 'Harness Character', chat_metadata: {},
  }) + '\n' + JSON.stringify(userMessage('imported message')) + '\n');
  const imported = await observe(async () => {
    const response = await post('/api/chats/import', {
      file_type: 'jsonl', avatar_url: 'Harness Character.png',
      user_name: 'Harness User', character_name: 'Harness Character',
    }, { 'x-harness-upload': importUpload });
    assert.equal(response.status, 200, JSON.stringify(response));
    assert.equal(response.result.res, true);
    assert.equal(response.result.fileNames.length, 1);
    return response;
  }, 'added');
  assert.ok(imported.result.delta.added.some(entry => entry.path.startsWith('chats/Harness Character/')));

  const backupName = 'chat_harness_restore.jsonl';
  await writeFile(join(directories.backups, backupName), JSON.stringify({
    user_name: 'Harness User', name: 'Harness Character', chat_metadata: {},
  }) + '\n' + JSON.stringify(userMessage('restored backup message')) + '\n');
  const restored = await observe(async () => {
    const download = await post('/api/backups/chat/download', { name: backupName });
    assert.equal(download.status, 200);
    const restoreUpload = 'restore-chat.jsonl';
    await writeFile(join(uploads, restoreUpload), download.result);
    const response = await post('/api/chats/import', {
      file_type: 'jsonl', avatar_url: 'Harness Character.png',
      user_name: 'Harness User', character_name: 'Harness Character',
    }, { 'x-harness-upload': restoreUpload });
    assert.equal(response.status, 200, JSON.stringify(response));
    assert.equal(response.result.res, true);
    return response;
  }, 'added');
  assert.ok(restored.result.delta.added.some(entry => entry.path.startsWith('chats/Harness Character/')));

  const groupUpload = 'group-chat.jsonl';
  await writeFile(join(uploads, groupUpload), JSON.stringify({
    user_name: 'Harness User', name: 'Harness Group', chat_metadata: {},
  }) + '\n' + JSON.stringify(userMessage('group imported message')) + '\n');
  const groupImport = await observe(async () => {
    const response = await post('/api/chats/group/import', {}, { 'x-harness-upload': groupUpload });
    assert.equal(response.status, 200, JSON.stringify(response));
    assert.equal(typeof response.result.res, 'string');
    return response;
  }, 'added');
  assert.ok(groupImport.result.delta.added.some(entry => entry.path.startsWith('group chats/')));

  const groupSave = await observe(async () => {
    const response = await post('/api/chats/group/save', {
      id: 'group-harness', chat: [header(), userMessage('group save'), assistantMessage()], force: true,
    });
    assert.equal(response.status, 200);
    assert.equal(response.result.ok, true);
    return response;
  }, 'added');
  assert.ok(groupSave.result.delta.added.some(entry => entry.path.endsWith('group-harness.jsonl')));

  const groupDelete = await observe(async () => {
    const response = await post('/api/chats/group/delete', { id: 'group-harness' });
    assert.equal(response.status, 200);
    assert.equal(response.result.ok, true);
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
