import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { SQLiteMemoryProvider } from '../src/application/sqlite-memory-provider.js';

function setup(t, overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'logic-memory-raw-archive-'));
  const path = join(directory, 'memory-provider.sqlite');
  const options = {
    path,
    getSnapshot: async () => ({ world_revision: 1, commit_sequence: 1 }),
    validateSourceVersion: async () => true,
    validateInventory: async () => true,
    ...overrides,
  };
  let provider = new SQLiteMemoryProvider(options);
  t.after(() => {
    try { provider?.close(); } catch {}
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    path,
    get provider() { return provider; },
    reopen() {
      provider.close();
      provider = new SQLiteMemoryProvider(options);
    },
  };
}

const capture = (overrides = {}) => ({
  world_id: 'world-a',
  conversation_id: 'chat-a',
  message_id: 'message-1',
  version_id: 'generation-1',
  role: 'assistant',
  content: 'A raw assistant message, preserved byte-for-byte as UTF-8 text.',
  metadata: { source: 'host-capture', sequence: 12 },
  ...overrides,
});

const sourceKey = (version_id = 'generation-1') => ({
  world_id: 'world-a', conversation_id: 'chat-a', message_id: 'message-1', version_id,
});

test('raw message capture is durable, integrity-tagged, and idempotent across restart', (t) => {
  const s = setup(t);
  const input = capture();
  const digest = createHash('sha256').update(input.content, 'utf8').digest('hex');
  assert.deepEqual(s.provider.captureRawMessage(input), { status: 'captured', content_sha256: digest });
  assert.deepEqual(s.provider.captureRawMessage(input), { status: 'duplicate', content_sha256: digest });
  s.reopen();

  const row = s.provider.db.prepare(`SELECT * FROM memory_raw_captures
    WHERE world_id=? AND conversation_id=? AND message_id=? AND version_id=?`)
    .get(input.world_id, input.conversation_id, input.message_id, input.version_id);
  assert.equal(row.content_text, input.content);
  assert.equal(row.content_sha256, digest);
  assert.deepEqual(JSON.parse(row.metadata_json), input.metadata);
  assert.equal(row.deleted_at, null);
});

test('conflicting payload cannot silently rebind an immutable raw version', (t) => {
  const s = setup(t);
  s.provider.captureRawMessage(capture());
  assert.throws(
    () => s.provider.captureRawMessage(capture({ content: 'different content for the same version' })),
    /MEMORY_RAW_CAPTURE_CONFLICT/,
  );
});

test('active-version switching retains alternative generations rather than deleting them', (t) => {
  const s = setup(t);
  s.provider.captureRawMessage(capture());
  s.provider.captureRawMessage(capture({
    version_id: 'generation-2',
    content: 'The alternate swipe/generation remains archived.',
  }));

  assert.deepEqual(s.provider.selectActiveRawVersion(sourceKey()), {
    status: 'active', version_id: 'generation-1',
  });
  assert.deepEqual(s.provider.selectActiveRawVersion(sourceKey('generation-2')), {
    status: 'active', version_id: 'generation-2',
  });

  const versions = s.provider.db.prepare(`SELECT version_id,content_text FROM memory_raw_captures
    WHERE world_id=? AND conversation_id=? AND message_id=? ORDER BY version_id`)
    .all('world-a', 'chat-a', 'message-1');
  assert.equal(versions.length, 2);
  assert.equal(versions[0].content_text, 'A raw assistant message, preserved byte-for-byte as UTF-8 text.');
  assert.equal(versions[1].content_text, 'The alternate swipe/generation remains archived.');
  assert.equal(s.provider.db.prepare(`SELECT version_id FROM memory_raw_active_versions
    WHERE world_id=? AND conversation_id=? AND message_id=?`)
    .get('world-a', 'chat-a', 'message-1').version_id, 'generation-2');
});

test('source deletion excludes the version from active selection and invalidates known dependent copies', (t) => {
  const s = setup(t);
  s.provider.captureRawMessage(capture());
  s.provider.selectActiveRawVersion(sourceKey());
  s.provider.registerRawDerivedCopy({
    ...sourceKey(),
    source_version_id: 'generation-1',
    copy_ref: 'summary:1',
    copy_version: 'summary-v1',
    copy_kind: 'summary',
    content: 'Derived summary based on the source message.',
  });

  assert.deepEqual(s.provider.markRawSourceDeleted(sourceKey()), {
    status: 'deleted', invalidated_copies: 1,
  });
  const raw = s.provider.db.prepare(`SELECT deleted_at FROM memory_raw_captures
    WHERE world_id=? AND conversation_id=? AND message_id=? AND version_id=?`)
    .get('world-a', 'chat-a', 'message-1', 'generation-1');
  assert.ok(raw.deleted_at);
  assert.equal(s.provider.db.prepare(`SELECT COUNT(*) AS count FROM memory_raw_active_versions
    WHERE world_id=? AND conversation_id=? AND message_id=?`)
    .get('world-a', 'chat-a', 'message-1').count, 0);
  assert.equal(s.provider.db.prepare(`SELECT status FROM memory_raw_derived_copies
    WHERE world_id=? AND conversation_id=? AND message_id=? AND source_version_id=?`)
    .get('world-a', 'chat-a', 'message-1', 'generation-1').status, 'invalidated');
  assert.throws(() => s.provider.selectActiveRawVersion(sourceKey()), /MEMORY_RAW_VERSION_UNAVAILABLE/);
  assert.throws(() => s.provider.registerRawDerivedCopy({
    ...sourceKey(),
    source_version_id: 'generation-1',
    copy_ref: 'summary:2',
    copy_version: 'summary-v1',
    copy_kind: 'summary',
    content: 'Must not attach to a deleted source.',
  }), /MEMORY_RAW_SOURCE_UNAVAILABLE/);
});

test('permanent purge removes the chosen raw version and cascades to its registered dependent copies only', (t) => {
  const s = setup(t);
  s.provider.captureRawMessage(capture());
  s.provider.captureRawMessage(capture({
    version_id: 'generation-2',
    content: 'Another generation must survive purge of generation-1.',
  }));
  s.provider.registerRawDerivedCopy({
    ...sourceKey(),
    source_version_id: 'generation-1',
    copy_ref: 'summary:1',
    copy_version: 'summary-v1',
    copy_kind: 'summary',
    content: 'Dependent content to purge.',
  });
  s.provider.registerRawDerivedCopy({
    ...sourceKey('generation-2'),
    source_version_id: 'generation-2',
    copy_ref: 'summary:2',
    copy_version: 'summary-v1',
    copy_kind: 'summary',
    content: 'Independent generation copy remains.',
  });

  assert.deepEqual(s.provider.purgeRawSource(sourceKey()), {
    status: 'purged', purged_copies: 1,
  });
  assert.equal(s.provider.db.prepare(`SELECT COUNT(*) AS count FROM memory_raw_captures
    WHERE world_id=? AND conversation_id=? AND message_id=? AND version_id=?`)
    .get('world-a', 'chat-a', 'message-1', 'generation-1').count, 0);
  assert.equal(s.provider.db.prepare(`SELECT COUNT(*) AS count FROM memory_raw_derived_copies
    WHERE world_id=? AND conversation_id=? AND message_id=? AND source_version_id=?`)
    .get('world-a', 'chat-a', 'message-1', 'generation-1').count, 0);
  assert.equal(s.provider.db.prepare(`SELECT COUNT(*) AS count FROM memory_raw_captures
    WHERE world_id=? AND conversation_id=? AND message_id=? AND version_id=?`)
    .get('world-a', 'chat-a', 'message-1', 'generation-2').count, 1);
  assert.equal(s.provider.db.prepare(`SELECT COUNT(*) AS count FROM memory_raw_derived_copies
    WHERE world_id=? AND conversation_id=? AND message_id=? AND source_version_id=?`)
    .get('world-a', 'chat-a', 'message-1', 'generation-2').count, 1);
});

test('raw archive keys are world-scoped and invalid lifecycle inputs fail closed', (t) => {
  const s = setup(t);
  s.provider.captureRawMessage(capture());
  s.provider.captureRawMessage(capture({
    world_id: 'world-b',
    content: 'Separate world content.',
  }));
  assert.equal(s.provider.db.prepare('SELECT COUNT(*) AS count FROM memory_raw_captures').get().count, 2);
  assert.throws(() => s.provider.captureRawMessage(capture({ content: null })), /Invalid raw Memory capture/);
  assert.throws(() => s.provider.markRawSourceDeleted({ ...sourceKey(), world_id: ' ' }), /Invalid raw Memory deletion target/);
});

test('raw archive reads default-deny and require the trusted host authorization callback', async (t) => {
  const s = setup(t);
  s.provider.captureRawMessage(capture());
  await assert.rejects(
    () => s.provider.readRawMessageVersion(sourceKey()),
    /MEMORY_RAW_READ_DENIED/,
  );
  await assert.rejects(
    () => s.provider.readActiveRawMessages({ world_id: 'world-a', conversation_id: 'chat-a' }),
    /MEMORY_RAW_READ_DENIED/,
  );
});

test('authorized raw reads expose only active versions and exclude source-deleted versions', async (t) => {
  const s = setup(t, {
    authorizeRawRead: async (request) => request.world_id === 'world-a'
      && ['read_version', 'read_active'].includes(request.action),
  });
  s.provider.captureRawMessage(capture());
  s.provider.captureRawMessage(capture({
    version_id: 'generation-2',
    content: 'Selected second generation.',
  }));
  s.provider.selectActiveRawVersion(sourceKey('generation-2'));

  const active = await s.provider.readActiveRawMessages({ world_id: 'world-a', conversation_id: 'chat-a' });
  assert.equal(active.length, 1);
  assert.equal(active[0].version_id, 'generation-2');
  assert.equal(active[0].content, 'Selected second generation.');

  const historical = await s.provider.readRawMessageVersion(sourceKey());
  assert.equal(historical.content, 'A raw assistant message, preserved byte-for-byte as UTF-8 text.');

  s.provider.markRawSourceDeleted(sourceKey('generation-2'));
  assert.deepEqual(await s.provider.readActiveRawMessages({ world_id: 'world-a', conversation_id: 'chat-a' }), []);
  await assert.rejects(
    () => s.provider.readRawMessageVersion(sourceKey('generation-2')),
    /MEMORY_RAW_VERSION_UNAVAILABLE/,
  );
});

test('raw archive authorization failure does not reveal whether a requested version exists', async (t) => {
  const s = setup(t, { authorizeRawRead: async () => false });
  s.provider.captureRawMessage(capture());
  for (const target of [sourceKey(), sourceKey('nonexistent-version')]) {
    await assert.rejects(
      () => s.provider.readRawMessageVersion(target),
      (error) => error.message === 'MEMORY_RAW_READ_DENIED',
    );
  }
});
