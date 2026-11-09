import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const script = new URL('../scripts/acceptance/provision-provider-schema.mjs', import.meta.url);

test('Provider schema bootstrap creates only an empty unenrolled schema and is read-only on rerun', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-provider-schema-bootstrap-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const providerPath = join(directory, 'provider.sqlite');
  const coordinatorPath = join(directory, 'coordinator.sqlite');

  const first = spawnSync(process.execPath, [script.pathname, providerPath, coordinatorPath], {
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.equal(first.status, 0, first.stderr);
  assert.equal(JSON.parse(first.stdout).status, 'PROVIDER_SCHEMA_CREATED');

  let db = new DatabaseSync(providerPath, { readOnly: true });
  try {
    const head = db.prepare('SELECT head,enrolled FROM accepted_head_state WHERE singleton=1').get();
    assert.deepEqual(head, { head: 0, enrolled: 0 });
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM memory_records').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM memory_query_grants').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM memory_record_grants').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM memory_index_entries').get().count, 0);
  } finally {
    db.close();
  }

  // Existing data must survive a second bootstrap unchanged.
  db = new DatabaseSync(providerPath);
  try {
    db.prepare('INSERT INTO memory_query_grants(world_id,subject_id,purpose,allowed) VALUES(?,?,?,?)')
      .run('fixture-world', 'fixture-subject', 'npc_decision', 0);
  } finally {
    db.close();
  }

  const second = spawnSync(process.execPath, [script.pathname, providerPath, coordinatorPath], {
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.equal(second.status, 0, second.stderr);
  assert.equal(JSON.parse(second.stdout).status, 'EXISTING_PROVIDER_DATABASE_VERIFIED_READ_ONLY');

  db = new DatabaseSync(providerPath, { readOnly: true });
  try {
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM memory_query_grants').get().count, 1);
    assert.deepEqual(
      db.prepare('SELECT head,enrolled FROM accepted_head_state WHERE singleton=1').get(),
      { head: 0, enrolled: 0 },
    );
  } finally {
    db.close();
  }
});
