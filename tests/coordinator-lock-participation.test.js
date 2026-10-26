import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { openCoordinatorDatabase } from '../src/storage/coordinator-lock.js';

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
  const store = new SQLiteStore(':memory:');
  try {
    assert.throws(
      () => store.tx(async () => 1),
      /SQLiteStore\.tx callback must be synchronous/,
    );
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
