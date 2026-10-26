import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { SQLiteStore } from '../src/storage/sqlite-store.js';

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
    const [c1, c2] = await Promise.all([
      new Promise((resolveExit, reject) => p1.once('exit', (code) => code === 0 ? resolveExit(code) : reject(new Error('first child exited ' + code)))),
      new Promise((resolveExit, reject) => p2.once('exit', (code) => code === 0 ? resolveExit(code) : reject(new Error('second child exited ' + code)))),
    ]);
    assert.equal(c1, 0);
    assert.equal(c2, 0);
  } finally {
    p1?.kill();
    p2?.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
