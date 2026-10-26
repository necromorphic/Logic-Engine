import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

const waitForExit = (child) => new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', (code, signal) => code === 0
    ? resolve({ code, signal })
    : reject(new Error('child exited with code=' + code + ', signal=' + signal)));
});

/**
 * Characterization test, deliberately documenting a security boundary gap.
 * The shared coordinator only serializes participants that acquire it. It
 * cannot stop a process with filesystem access from opening Core's SQLite
 * file directly and mutating canonical rows without joining the coordinator.
 *
 * This is not a readiness test and must not be interpreted as an acceptable
 * production property. The eventual deployment must enforce single-writer
 * ownership/OS-level isolation or another reviewed mechanism before relying
 * on the coordinator as a global write gate.
 */
test('characterizes direct Core SQLite writer bypass while another process holds the coordinator lease', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'logic-engine-raw-writer-bypass-'));
  const corePath = join(dir, 'core.sqlite');
  const coordinatorPath = join(dir, 'coordinator.sqlite');
  const lockedMarker = join(dir, 'coordinator-locked');
  const writeMarker = join(dir, 'raw-write-complete');
  const env = {
    ...process.env,
    LOGIC_ENGINE_COORDINATOR_DB_PATH: coordinatorPath,
  };

  let store;
  let lockProcess;
  let writerProcess;
  try {
    store = new SQLiteStore(corePath);
    store.createWorld({
      world_id: 'bypass-world',
      world_pack_id: 'test-pack',
      world_pack_version: '1',
      game_time: '2000-01-01T00:00:00.000Z',
    });
    store.close();
    store = null;

    const lockScript = `
      import { writeFileSync } from 'node:fs';
      import { openCoordinatorDatabase, beginCoordinatorLock } from ${JSON.stringify(new URL('../src/storage/coordinator-lock.js', import.meta.url).href)};
      const [coordinatorPath, markerPath, holdMs] = process.argv.slice(1);
      const db = openCoordinatorDatabase(coordinatorPath);
      const release = beginCoordinatorLock(db);
      writeFileSync(markerPath, 'held');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(holdMs));
      release();
      db.close();
    `;
    lockProcess = spawn(process.execPath, [
      '--input-type=module', '-e', lockScript, coordinatorPath, lockedMarker, '1400',
    ], { env, stdio: 'ignore' });
    const lockExit = waitForExit(lockProcess);
    await waitForFile(lockedMarker);

    const writerScript = `
      import { writeFileSync } from 'node:fs';
      import { DatabaseSync } from 'node:sqlite';
      const [corePath, markerPath] = process.argv.slice(1);
      const db = new DatabaseSync(corePath);
      db.exec('PRAGMA busy_timeout=5000');
      const result = db.prepare("UPDATE worlds SET world_revision=world_revision+1, status='inactive' WHERE world_id=?").run('bypass-world');
      if (result.changes !== 1) throw new Error('expected to update exactly one canonical world row');
      db.close();
      writeFileSync(markerPath, 'written');
    `;
    writerProcess = spawn(process.execPath, [
      '--input-type=module', '-e', writerScript, corePath, writeMarker,
    ], { env, stdio: 'ignore' });
    const writerExit = waitForExit(writerProcess);

    // The lease is held for 1.4 seconds. A successful direct write during
    // that interval proves the coordinator does not mediate arbitrary file
    // access; it does not prove anything about the approved application path.
    await waitForFile(writeMarker, 900);
    await writerExit;
    assert.equal(existsSync(writeMarker), true,
      'independent SQLite writer should be able to mutate Core state without acquiring the coordinator');
    await lockExit;
  } finally {
    store?.close();
    lockProcess?.kill();
    writerProcess?.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
