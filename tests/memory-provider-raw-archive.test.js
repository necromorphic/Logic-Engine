import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteMemoryProvider } from '../src/application/sqlite-memory-provider.js';

function setup(t) {
  const directory = mkdtempSync(join(tmpdir(), 'logic-memory-raw-archive-'));
  const path = join(directory, 'memory-provider.sqlite');
  const provider = new SQLiteMemoryProvider({
    path,
    getSnapshot: async () => ({ world_revision: 1, commit_sequence: 1 }),
    validateSourceVersion: async () => true,
    validateInventory: async () => true,
    authorizeRawRead: async () => true,
  });
  t.after(() => {
    try { provider.close(); } catch {}
    rmSync(directory, { recursive: true, force: true });
  });
  return provider;
}

const capture = {
  world_id: 'world-a',
  conversation_id: 'chat-a',
  message_id: 'message-1',
  version_id: 'generation-1',
  role: 'assistant',
  content: 'Raw Host text must not be persisted without Core approval.',
};

test('raw Host capture is denied and persists no content', (t) => {
  const provider = setup(t);
  assert.throws(
    () => provider.captureRawMessage(capture),
    (error) => error.message === 'MEMORY_RAW_CAPTURE_NOT_APPROVED',
  );
  assert.equal(provider.db.prepare('SELECT COUNT(*) AS count FROM memory_raw_captures').get().count, 0);
});

test('raw Host-derived copies are denied and persist no content', (t) => {
  const provider = setup(t);
  assert.throws(
    () => provider.registerRawDerivedCopy({
      ...capture,
      source_version_id: capture.version_id,
      copy_ref: 'summary:1',
      copy_version: 'summary-v1',
      copy_kind: 'summary',
    }),
    (error) => error.message === 'MEMORY_RAW_DERIVED_COPY_NOT_APPROVED',
  );
  assert.equal(provider.db.prepare('SELECT COUNT(*) AS count FROM memory_raw_derived_copies').get().count, 0);
});

test('raw Host disclosure remains denied even when a read callback grants access', async (t) => {
  const provider = setup(t);
  await assert.rejects(
    () => provider.readRawMessageVersion({
      world_id: capture.world_id,
      conversation_id: capture.conversation_id,
      message_id: capture.message_id,
      version_id: capture.version_id,
    }),
    (error) => error.message === 'MEMORY_RAW_DISCLOSURE_NOT_APPROVED',
  );
  await assert.rejects(
    () => provider.readActiveRawMessages({
      world_id: capture.world_id,
      conversation_id: capture.conversation_id,
    }),
    (error) => error.message === 'MEMORY_RAW_DISCLOSURE_NOT_APPROVED',
  );
});

test('unapproved raw versions cannot be selected as active', (t) => {
  const provider = setup(t);
  assert.throws(
    () => provider.selectActiveRawVersion({
      world_id: capture.world_id,
      conversation_id: capture.conversation_id,
      message_id: capture.message_id,
      version_id: capture.version_id,
    }),
    (error) => error.message === 'MEMORY_RAW_SOURCE_NOT_APPROVED',
  );
  assert.equal(provider.db.prepare('SELECT COUNT(*) AS count FROM memory_raw_active_versions').get().count, 0);
});


function insertLegacyRawVersion(provider, { world_id, conversation_id, message_id, version_id, content }) {
  const digest = createHash('sha256').update(content, 'utf8').digest('hex');
  provider.db.prepare(`INSERT INTO memory_raw_captures
    (world_id, conversation_id, message_id, version_id, role, content_text, content_sha256,
     metadata_json, captured_at, deleted_at)
    VALUES(?,?,?,?,?,?,?,?,?,NULL)`)
    .run(world_id, conversation_id, message_id, version_id, 'assistant', content, digest, '{}', '2026-01-01T00:00:00.000Z');
}

test('legacy raw purge removes only registered Provider copies and preserves external copies and alternate versions', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-memory-purge-boundary-'));
  const providerPath = join(directory, 'provider.sqlite');
  const externalPath = join(directory, 'external.sqlite');
  const provider = new SQLiteMemoryProvider({
    path: providerPath,
    getSnapshot: async () => ({ world_revision: 1, commit_sequence: 1 }),
    validateSourceVersion: async () => true,
    validateInventory: async () => true,
  });
  const external = new DatabaseSync(externalPath);
  t.after(() => {
    try { provider.close(); } catch {}
    try { external.close(); } catch {}
    rmSync(directory, { recursive: true, force: true });
  });

  const selected = { world_id: 'legacy-w', conversation_id: 'legacy-c', message_id: 'legacy-m', version_id: 'legacy-v1' };
  const alternate = { ...selected, version_id: 'legacy-v2' };
  insertLegacyRawVersion(provider, { ...selected, content: 'legacy selected version' });
  insertLegacyRawVersion(provider, { ...alternate, content: 'legacy alternate version' });
  provider.db.prepare(`INSERT INTO memory_raw_active_versions
    (world_id, conversation_id, message_id, version_id, selected_at) VALUES(?,?,?,?,?)`)
    .run(selected.world_id, selected.conversation_id, selected.message_id, selected.version_id, '2026-01-01T00:00:00.000Z');
  provider.db.prepare(`INSERT INTO memory_raw_derived_copies
    (world_id, conversation_id, message_id, source_version_id, copy_ref, copy_version, copy_kind,
     content_text, content_sha256, status, created_at, invalidated_at)
    VALUES(?,?,?,?,?,?,?,?,?,'current',?,NULL)`)
    .run(selected.world_id, selected.conversation_id, selected.message_id, selected.version_id,
      'legacy-registered-copy', 'v1', 'summary', 'provider-local copy',
      createHash('sha256').update('provider-local copy', 'utf8').digest('hex'), '2026-01-01T00:00:00.000Z');

  external.exec('CREATE TABLE copies (copy_ref TEXT PRIMARY KEY, content TEXT NOT NULL)');
  external.prepare('INSERT INTO copies VALUES (?, ?)').run('unregistered-external', 'external copy remains outside Provider');

  assert.deepEqual(provider.purgeRawSource(selected), { status: 'purged', purged_copies: 1 });
  assert.equal(provider.db.prepare('SELECT COUNT(*) AS n FROM memory_raw_captures WHERE version_id=?').get(selected.version_id).n, 0);
  assert.equal(provider.db.prepare('SELECT COUNT(*) AS n FROM memory_raw_derived_copies WHERE copy_ref=?').get('legacy-registered-copy').n, 0);
  assert.equal(provider.db.prepare('SELECT COUNT(*) AS n FROM memory_raw_active_versions WHERE world_id=? AND conversation_id=? AND message_id=?')
    .get(selected.world_id, selected.conversation_id, selected.message_id).n, 0);
  assert.equal(provider.db.prepare('SELECT content_text FROM memory_raw_captures WHERE version_id=?').get(alternate.version_id).content_text,
    'legacy alternate version');
  assert.equal(external.prepare('SELECT content FROM copies WHERE copy_ref=?').get('unregistered-external').content,
    'external copy remains outside Provider');
});


test('exact-version tombstone invalidates only dependent copies and preserves an alternate active version', (t) => {
  const provider = setup(t);
  const selected = { world_id: 'tombstone-w', conversation_id: 'tombstone-c', message_id: 'tombstone-m', version_id: 'tombstone-v1' };
  const alternate = { ...selected, version_id: 'tombstone-v2' };
  insertLegacyRawVersion(provider, { ...selected, content: 'version one' });
  insertLegacyRawVersion(provider, { ...alternate, content: 'version two' });

  const insertCopy = (source, copyRef) => {
    const content = `copy of ${source.version_id}`;
    provider.db.prepare(`INSERT INTO memory_raw_derived_copies
      (world_id,conversation_id,message_id,source_version_id,copy_ref,copy_version,copy_kind,
       content_text,content_sha256,status,created_at,invalidated_at)
      VALUES(?,?,?,?,?,?,?, ?,?,'current',?,NULL)`)
      .run(source.world_id, source.conversation_id, source.message_id, source.version_id,
        copyRef, 'v1', 'summary', content, createHash('sha256').update(content, 'utf8').digest('hex'),
        '2026-01-01T00:00:00.000Z');
  };
  insertCopy(selected, 'copy-v1');
  insertCopy(alternate, 'copy-v2');
  provider.db.prepare(`INSERT INTO memory_raw_active_versions
    (world_id,conversation_id,message_id,version_id,selected_at) VALUES(?,?,?,?,?)`)
    .run(alternate.world_id, alternate.conversation_id, alternate.message_id, alternate.version_id,
      '2026-01-01T00:00:00.000Z');

  assert.deepEqual(provider.markRawSourceDeleted(selected), { status: 'deleted', invalidated_copies: 1 });
  const deleted = provider.db.prepare(`SELECT deleted_at FROM memory_raw_captures
    WHERE world_id=? AND conversation_id=? AND message_id=? AND version_id=?`)
    .get(selected.world_id, selected.conversation_id, selected.message_id, selected.version_id);
  assert.notEqual(deleted.deleted_at, null);
  assert.equal(provider.db.prepare('SELECT status FROM memory_raw_derived_copies WHERE copy_ref=?').get('copy-v1').status,
    'invalidated');
  assert.equal(provider.db.prepare('SELECT status FROM memory_raw_derived_copies WHERE copy_ref=?').get('copy-v2').status,
    'current');
  assert.equal(provider.db.prepare(`SELECT version_id FROM memory_raw_active_versions
    WHERE world_id=? AND conversation_id=? AND message_id=?`)
    .get(alternate.world_id, alternate.conversation_id, alternate.message_id).version_id, alternate.version_id);

  assert.deepEqual(provider.markRawSourceDeleted(selected), { status: 'deleted', invalidated_copies: 0 });
  assert.equal(provider.db.prepare('SELECT status FROM memory_raw_derived_copies WHERE copy_ref=?').get('copy-v2').status,
    'current');
});
