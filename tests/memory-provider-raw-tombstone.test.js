import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteMemoryProvider } from '../src/application/sqlite-memory-provider.js';

function setup(t) {
  const directory = mkdtempSync(join(tmpdir(), 'logic-memory-tombstone-'));
  const path = join(directory, 'provider.sqlite');
  const options = {
    path,
    getSnapshot: async () => ({ world_revision: 1, commit_sequence: 1 }),
    validateSourceVersion: async () => true,
    validateInventory: async () => true,
  };
  let provider = new SQLiteMemoryProvider(options);
  t.after(() => {
    try { provider.close(); } catch {}
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    get provider() { return provider; },
    reopen() {
      provider.close();
      provider = new SQLiteMemoryProvider(options);
    },
  };
}

function insertLegacyVersion(provider, versionId, content) {
  const digest = createHash('sha256').update(content, 'utf8').digest('hex');
  provider.db.prepare(`INSERT INTO memory_raw_captures
    (world_id,conversation_id,message_id,version_id,role,content_text,content_sha256,
     metadata_json,captured_at,deleted_at)
    VALUES(?,?,?,?,?,?,?,?,?,NULL)`)
    .run('world-a', 'chat-a', 'message-a', versionId, 'assistant', content, digest, '{}',
      '2026-01-01T00:00:00.000Z');
}

function insertLegacyCopy(provider, sourceVersionId, copyRef) {
  const content = `legacy copy from ${sourceVersionId}`;
  const digest = createHash('sha256').update(content, 'utf8').digest('hex');
  provider.db.prepare(`INSERT INTO memory_raw_derived_copies
    (world_id,conversation_id,message_id,source_version_id,copy_ref,copy_version,copy_kind,
     content_text,content_sha256,status,created_at,invalidated_at)
    VALUES(?,?,?,?,?,?,?, ?,?,'current',?,NULL)`)
    .run('world-a', 'chat-a', 'message-a', sourceVersionId, copyRef, 'v1', 'summary',
      content, digest, '2026-01-01T00:00:00.000Z');
}

function selectLegacyVersion(provider, versionId) {
  provider.db.prepare(`INSERT INTO memory_raw_active_versions
    (world_id,conversation_id,message_id,version_id,selected_at)
    VALUES(?,?,?,?,?)`)
    .run('world-a', 'chat-a', 'message-a', versionId, '2026-01-01T00:00:00.000Z');
}

test('exact-version tombstone invalidates only known dependent copies and preserves a different active version across restart', (t) => {
  const s = setup(t);
  insertLegacyVersion(s.provider, 'version-a', 'old version');
  insertLegacyVersion(s.provider, 'version-b', 'replacement version');
  insertLegacyCopy(s.provider, 'version-a', 'copy-from-a');
  insertLegacyCopy(s.provider, 'version-b', 'copy-from-b');
  selectLegacyVersion(s.provider, 'version-b');

  assert.deepEqual(s.provider.markRawSourceDeleted({
    world_id: 'world-a', conversation_id: 'chat-a', message_id: 'message-a', version_id: 'version-a',
  }), { status: 'deleted', invalidated_copies: 1 });

  assert.ok(s.provider.db.prepare(`SELECT deleted_at FROM memory_raw_captures
    WHERE world_id=? AND conversation_id=? AND message_id=? AND version_id=?`)
    .get('world-a', 'chat-a', 'message-a', 'version-a').deleted_at);
  assert.equal(s.provider.db.prepare(`SELECT deleted_at FROM memory_raw_captures
    WHERE world_id=? AND conversation_id=? AND message_id=? AND version_id=?`)
    .get('world-a', 'chat-a', 'message-a', 'version-b').deleted_at, null);
  assert.equal(s.provider.db.prepare('SELECT version_id FROM memory_raw_active_versions WHERE world_id=? AND conversation_id=? AND message_id=?')
    .get('world-a', 'chat-a', 'message-a').version_id, 'version-b');
  assert.equal(s.provider.db.prepare('SELECT status FROM memory_raw_derived_copies WHERE copy_ref=?')
    .get('copy-from-a').status, 'invalidated');
  assert.equal(s.provider.db.prepare('SELECT status FROM memory_raw_derived_copies WHERE copy_ref=?')
    .get('copy-from-b').status, 'current');

  s.reopen();
  assert.ok(s.provider.db.prepare(`SELECT deleted_at FROM memory_raw_captures
    WHERE world_id=? AND conversation_id=? AND message_id=? AND version_id=?`)
    .get('world-a', 'chat-a', 'message-a', 'version-a').deleted_at);
  assert.equal(s.provider.db.prepare('SELECT version_id FROM memory_raw_active_versions WHERE world_id=? AND conversation_id=? AND message_id=?')
    .get('world-a', 'chat-a', 'message-a').version_id, 'version-b');
  assert.equal(s.provider.db.prepare('SELECT status FROM memory_raw_derived_copies WHERE copy_ref=?')
    .get('copy-from-a').status, 'invalidated');
  assert.equal(s.provider.db.prepare('SELECT status FROM memory_raw_derived_copies WHERE copy_ref=?')
    .get('copy-from-b').status, 'current');

  assert.deepEqual(s.provider.markRawSourceDeleted({
    world_id: 'world-a', conversation_id: 'chat-a', message_id: 'message-a', version_id: 'version-b',
  }), { status: 'deleted', invalidated_copies: 1 });
  assert.equal(s.provider.db.prepare('SELECT COUNT(*) AS count FROM memory_raw_active_versions WHERE world_id=? AND conversation_id=? AND message_id=?')
    .get('world-a', 'chat-a', 'message-a').count, 0,
  'tombstoning the currently selected exact version clears that pointer');
  assert.equal(s.provider.db.prepare('SELECT status FROM memory_raw_derived_copies WHERE copy_ref=?')
    .get('copy-from-b').status, 'invalidated');
});
