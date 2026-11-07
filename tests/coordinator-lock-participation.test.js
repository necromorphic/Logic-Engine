import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, linkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { openCoordinatorDatabase, withCoordinatorLock } from '../src/storage/coordinator-lock.js';

const waitForFile = async (path, { timeoutMs = 60000, child = null, output = () => '' } = {}) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return;
    if (child && (child.exitCode !== null || child.signalCode !== null)) {
      throw new Error('Child exited before creating ' + path
        + ' (code=' + child.exitCode + ', signal=' + child.signalCode + '). ' + output());
    }
    await delay(20);
  }
  throw new Error('Timed out waiting for ' + path + '. ' + output());
};

test('separate Core stores serialize write transactions through one shared coordinator DB', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'logic-engine-coordinator-'));
  const coordinatorPath = join(dir, 'coordinator.sqlite');
  const coreA = join(dir, 'core-a.sqlite');
  const coreB = join(dir, 'core-b.sqlite');
  const firstEntered = join(dir, 'first-entered');
  const secondStarting = join(dir, 'second-starting');
  const secondEntered = join(dir, 'second-entered');
  const childScript = `
    import { writeFileSync } from 'node:fs';
    import { SQLiteStore } from ${JSON.stringify(new URL('../src/storage/sqlite-store.js', import.meta.url).href)};
    const [dbPath, markerPath, holdMs, startingPath] = process.argv.slice(1);
    if (startingPath) writeFileSync(startingPath, 'starting');
    const store = new SQLiteStore(dbPath);
    store.tx(() => {
      writeFileSync(markerPath, 'entered');
      if (Number(holdMs) > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(holdMs));
    });
    store.close();
  `;
  const env = { ...process.env, LOGIC_ENGINE_COORDINATOR_DB_PATH: coordinatorPath };
  const start = (dbPath, markerPath, holdMs, startingPath = '') => {
    const child = spawn(process.execPath,
      ['--input-type=module', '-e', childScript, dbPath, markerPath, String(holdMs), startingPath],
      { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let spawnError = null;
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => { spawnError = error; });
    const output = () => [
      spawnError ? 'spawn error: ' + spawnError.message : '',
      stdout ? 'stdout: ' + stdout : '',
      stderr ? 'stderr: ' + stderr : '',
    ].filter(Boolean).join('\\n');
    const exited = new Promise((resolve) => {
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    return { child, exited, output };
  };
  let p1, p2;
  try {
    const first = start(coreA, firstEntered, 2000);
    p1 = first.child;
    await waitForFile(firstEntered, { child: p1, output: first.output });
    const second = start(coreB, secondEntered, 0, secondStarting);
    p2 = second.child;
    await waitForFile(secondStarting, { child: p2, output: second.output });
    await delay(250);
    assert.equal(existsSync(secondEntered), false,
      'second Core transaction must wait while first holds shared coordinator');
    await waitForFile(secondEntered, { child: p2, output: second.output });
    const results = await Promise.all([first.exited, second.exited]);
    assert.deepEqual(results, [{ code: 0, signal: null }, { code: 0, signal: null }],
      'both Core processes must complete successfully: ' + [first.output(), second.output()].join('\\n'));
  } finally {
    // Wait for child exit before deleting SQLite files; Windows may keep them locked.
    const stopChild = (child) => new Promise((resolve) => {
      if (!child || child.exitCode !== null || child.signalCode !== null) return resolve();
      child.once('exit', resolve);
      child.kill();
    });
    await Promise.all([stopChild(p1), stopChild(p2)]);
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


test('SQLiteStore rejects a coordinator path that is a hard link to the Core database', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'logic-engine-coordinator-hardlink-'));
  const corePath = join(dir, 'core.sqlite');
  const coordinatorPath = join(dir, 'coordinator.sqlite');
  const previous = process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH;
  try {
    process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH = coordinatorPath;
    const store = new SQLiteStore(corePath);
    store.close();

    rmSync(coordinatorPath, { force: true });
    linkSync(corePath, coordinatorPath);

    process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH = coordinatorPath;
    assert.throws(() => new SQLiteStore(corePath), /Coordinator DB must be separate from the Core DB/);
  } finally {
    if (previous === undefined) delete process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH;
    else process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
