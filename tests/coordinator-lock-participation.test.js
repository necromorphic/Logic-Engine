import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync, symlinkSync, linkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { openCoordinatorDatabase, withCoordinatorLock } from '../src/storage/coordinator-lock.js';

const waitForFile = async (path, timeoutMs = 3000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return;
    await delay(10);
  }
  throw new Error('Timed out waiting for ' + path);
};

test('separate Core stores serialize their write transactions through the shared coordinator DB', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'logic-engine-coordinator-'));
  const coordinatorPath = join(dir, 'coordinator.sqlite');
  const coreA = join(dir, 'core-a.sqlite');
  const coreB = join(dir, 'core-b.sqlite');
  const firstEntered = join(dir, 'first-entered');
  const secondEntered = join(dir, 'second-entered');
  const first = new SQLiteStore(coreA);
  const second = new SQLiteStore(coreB);
  first.close();
  second.close();

  const childScript = `
    import { writeFileSync } from 'node:fs';
    import { SQLiteStore } from ${JSON.stringify(new URL('../src/storage/sqlite-store.js', import.meta.url).href)};
    const [dbPath, markerPath, holdMs] = process.argv.slice(1);
    const store = new SQLiteStore(dbPath);
    store.tx(() => {
      writeFileSync(markerPath, 'entered');
      if (Number(holdMs) > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(holdMs));
    });
    store.close();
  `;
  const env = { ...process.env, LOGIC_ENGINE_COORDINATOR_DB_PATH: coordinatorPath };
  const start = (dbPath, markerPath, holdMs) => {
    const child = spawn(process.execPath,
      ['--input-type=module', '-e', childScript, dbPath, markerPath, String(holdMs)],
      { env, stdio: 'ignore' });
    // Attach immediately: a short-lived child may exit before the test reaches
    // the later synchronization point, and Node does not replay the exit event.
    const exited = new Promise((resolveExit, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => code === 0
        ? resolveExit({ code, signal })
        : reject(new Error('child exited with code=' + code + ', signal=' + signal)));
    });
    return { child, exited };
  };

  let p1;
  let p2;
  try {
    const firstProc = start(coreA, firstEntered, 500);
    p1 = firstProc.child;
    await waitForFile(firstEntered);
    const secondProc = start(coreB, secondEntered, 0);
    p2 = secondProc.child;
    await delay(120);
    assert.equal(existsSync(secondEntered), false,
      'the second Core DB must not enter its write transaction while the first holds the shared coordinator');
    await waitForFile(secondEntered);
    const [c1, c2] = await Promise.all([firstProc.exited, secondProc.exited]);
    assert.equal(c1.code, 0);
    assert.equal(c2.code, 0);
  } finally {
    p1?.kill();
    p2?.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});


test('Core transaction callbacks reject async functions before commit', () => {
  let asyncSideEffect = false;
  const store = new SQLiteStore(':memory:');
  try {
    assert.throws(
      () => store.tx(async () => { asyncSideEffect = true; return 1; }),
      /SQLiteStore\.tx callback must be synchronous/,
    );
    assert.equal(asyncSideEffect, false, 'async callback must be rejected before its body executes');
    assert.throws(
      () => store.tx(() => store.tx(async () => 1)),
      /SQLiteStore\.tx callback must be synchronous/,
    );
    assert.equal(store.tx(() => 7), 7);
  } finally {
    store.close();
  }
});


test('coordinator helper rejects relative paths instead of silently resolving per-process working directories', () => {
  assert.throws(
    () => openCoordinatorDatabase('coordinator.sqlite'),
    /coordinator database path must be absolute/,
  );
});


test('coordinator wrapper releases its lease on success and failure and rejects async callbacks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'logic-engine-coordinator-wrapper-'));
  const dbPath = join(dir, 'coordinator.sqlite');
  const db = openCoordinatorDatabase(dbPath);
  try {
    assert.equal(withCoordinatorLock(db, () => 'ok'), 'ok');
    assert.throws(() => withCoordinatorLock(db, () => { throw new Error('mutation failed'); }), /mutation failed/);
    let asyncSideEffect = false;
    assert.throws(
      () => withCoordinatorLock(db, async () => { asyncSideEffect = true; return 'late'; }),
      /Coordinator callback must be synchronous/,
    );
    assert.equal(asyncSideEffect, false, 'async callback must be rejected before its body executes');
    assert.equal(withCoordinatorLock(db, () => 9), 9, 'lease must be reusable after all rejected callbacks');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});


test('SQLiteStore validates coordinator configuration before opening its Core database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'logic-engine-coordinator-config-'));
  const corePath = join(dir, 'core.sqlite');
  const previous = process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH;
  try {
    for (const configuredPath of ['./relative-coordinator.sqlite', '']) {
      process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH = configuredPath;
      assert.throws(
        () => new SQLiteStore(corePath),
        configuredPath
          ? /LOGIC_ENGINE_COORDINATOR_DB_PATH must be an absolute path/
          : /LOGIC_ENGINE_COORDINATOR_DB_PATH must be a non-empty absolute path/,
      );
      assert.equal(existsSync(corePath), false, 'invalid coordinator configuration must not create/open the Core database');
    }
  } finally {
    if (previous === undefined) delete process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH;
    else process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});


test('direct replay and projection helper calls enter Core transactions instead of bypassing coordination', () => {
  const dir = mkdtempSync(join(tmpdir(), 'logic-engine-coordinator-helper-writes-'));
  const previous = process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH;
  process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH = join(dir, 'coordinator.sqlite');
  const store = new SQLiteStore(join(dir, 'core.sqlite'));
  try {
    store.createWorld({
      world_id: 'helper-write-world',
      world_pack_id: 'test-pack',
      world_pack_version: '1',
      game_time: '2000-01-01T00:00:00.000Z',
    });
    const result = { accepted: true, no_op: true };
    store.saveReplay('helper-write-world', 'direct-helper-key', 'request-hash', result);
    assert.deepEqual(store.replay('helper-write-world', 'direct-helper-key', 'request-hash'), result);
    assert.equal(store.txDepth, 0, 'direct replay persistence must leave no open transaction');

    store.rebuild('helper-write-world', store.world('helper-write-world').world_revision);
    assert.equal(store.txDepth, 0, 'direct projection rebuild must leave no open transaction');
  } finally {
    store.close();
    if (previous === undefined) delete process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH;
    else process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});


test('SQLiteStore rejects coordinator and Core DB paths that alias the same file', (t) => {
  if (process.platform === 'win32') {
    t.skip('symlink creation requires platform-specific privileges on Windows');
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'logic-engine-coordinator-alias-'));
  const corePath = join(dir, 'core.sqlite');
  const symlinkAliasPath = join(dir, 'coordinator-symlink.sqlite');
  const hardlinkAliasPath = join(dir, 'coordinator-hardlink.sqlite');
  const previous = process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH;
  try {
    writeFileSync(corePath, '');
    symlinkSync(corePath, symlinkAliasPath);
    linkSync(corePath, hardlinkAliasPath);
    for (const aliasPath of [symlinkAliasPath, hardlinkAliasPath]) {
      process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH = aliasPath;
      assert.throws(
        () => new SQLiteStore(corePath),
        /Coordinator DB must be separate from the Core DB, including filesystem aliases/,
      );
    }
  } finally {
    if (previous === undefined) delete process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH;
    else process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});


test('public SQLiteStore.db facade rejects mutations outside the store transaction lease', () => {
  const dir = mkdtempSync(join(tmpdir(), 'logic-engine-db-facade-'));
  const storePath = join(dir, 'core.sqlite');
  const store = new SQLiteStore(storePath);
  try {
    store.tx(() => store.db.exec('CREATE TABLE guarded_facade_probe (value TEXT NOT NULL)'));
    store.db.prepare('INSERT INTO guarded_facade_probe(value) VALUES(?)').run('outside');
    store.db.exec('DELETE FROM guarded_facade_probe');
    assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM guarded_facade_probe').get().count, 0);
    // Schema DDL from legacy service constructors is transparently routed
    // through a coordinator-backed Core transaction.
    store.db.exec('CREATE TABLE guarded_facade_ddl_probe (value TEXT NOT NULL)');
    assert.equal(store.db.prepare('SELECT name FROM sqlite_master WHERE name=?').get('guarded_facade_ddl_probe').name, 'guarded_facade_ddl_probe');
    store.tx(() => store.db.prepare('INSERT INTO guarded_facade_probe(value) VALUES(?)').run('inside'));
    assert.equal(store.db.prepare('SELECT value FROM guarded_facade_probe').get().value, 'inside');
    assert.throws(() => store.db.close(), /Use SQLiteStore\.close\(\)/);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
