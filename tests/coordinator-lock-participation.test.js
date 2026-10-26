import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { openCoordinatorDatabase, withCoordinatorLock } from '../src/storage/coordinator-lock.js';

const waitForFile = async (path, timeoutMs = 4000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return;
    await delay(10);
  }
  throw new Error('Timed out waiting for ' + path);
};

test('separate Core stores serialize write transactions through one shared coordinator DB', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'logic-engine-coordinator-'));
  const coordinatorPath = join(dir, 'coordinator.sqlite');
  const coreA = join(dir, 'core-a.sqlite');
  const coreB = join(dir, 'core-b.sqlite');
  const firstEntered = join(dir, 'first-entered');
  const secondEntered = join(dir, 'second-entered');
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
    const child = spawn(process.execPath, ['--input-type=module', '-e', childScript, dbPath, markerPath, String(holdMs)], { env, stdio: 'ignore' });
    const exited = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => code === 0 ? resolve({ code, signal })
        : reject(new Error('child exited with code=' + code + ', signal=' + signal)));
    });
    return { child, exited };
  };
  let p1, p2;
  try {
    const first = start(coreA, firstEntered, 600);
    p1 = first.child;
    await waitForFile(firstEntered);
    const second = start(coreB, secondEntered, 0);
    p2 = second.child;
    await delay(150);
    assert.equal(existsSync(secondEntered), false, 'second Core transaction must wait while first holds shared coordinator');
    await waitForFile(secondEntered);
    await Promise.all([first.exited, second.exited]);
  } finally {
    p1?.kill();
    p2?.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('coordinator helper rejects relative paths and releases leases after failures', () => {
  assert.throws(() => openCoordinatorDatabase('relative-coordinator.sqlite'), /path must be absolute/);
  const dir = mkdtempSync(join(tmpdir(), 'logic-engine-coordinator-helper-'));
  const db = openCoordinatorDatabase(join(dir, 'coordinator.sqlite'));
  try {
    assert.equal(withCoordinatorLock(db, () => 'ok'), 'ok');
    assert.throws(() => withCoordinatorLock(db, () => { throw new Error('expected failure'); }), /expected failure/);
    assert.equal(withCoordinatorLock(db, () => 7), 7);
    assert.throws(() => withCoordinatorLock(db, async () => 'not allowed'), /must be synchronous/);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SQLiteStore rejects coordinator and Core database paths that alias the same file', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'logic-engine-coordinator-alias-'));
  const corePath = join(dir, 'core.sqlite');
  const previous = process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH;
  try {
    process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH = corePath;
    assert.throws(() => new SQLiteStore(corePath), /Coordinator DB must be separate from the Core DB/);
  } finally {
    if (previous === undefined) delete process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH;
    else process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SQLiteStore rejects asynchronous transaction callbacks before invoking them', () => {
  const store = new SQLiteStore(':memory:');
  try {
    let sideEffect = false;
    assert.throws(() => store.tx(async () => { sideEffect = true; }), /must be synchronous/);
    assert.equal(sideEffect, false);
    assert.equal(store.tx(() => 9), 9);
  } finally {
    store.close();
  }
});
