import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const file = fileURLToPath(import.meta.url);
const workerRole = process.env.DISPATCH_ORDER_PROOF_ROLE;
const workerDirectory = process.env.DISPATCH_ORDER_PROOF_DIR;

function openDb(path) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout = 5000;');
  return db;
}

function initialize(directory) {
  const coordinator = openDb(join(directory, 'coordinator.sqlite'));
  coordinator.exec('CREATE TABLE lock_marker (id INTEGER PRIMARY KEY, value INTEGER NOT NULL); INSERT INTO lock_marker VALUES (1, 0);');
  coordinator.close();

  const state = openDb(join(directory, 'validity.sqlite'));
  state.exec('CREATE TABLE validity (id INTEGER PRIMARY KEY, denied INTEGER NOT NULL); INSERT INTO validity VALUES (1, 0);');
  state.close();

  const ledger = openDb(join(directory, 'dispatch-ledger.sqlite'));
  ledger.exec('CREATE TABLE dispatch (id INTEGER PRIMARY KEY, outcome TEXT NOT NULL); CREATE TABLE transport_calls (id INTEGER PRIMARY KEY);');
  ledger.close();
}

function emit(event, fields = {}) {
  process.stdout.write(JSON.stringify({ event, ...fields }) + '\n');
}

function waitForCommand() {
  return new Promise((resolve) => {
    let buffer = '';
    const onData = (chunk) => {
      buffer += chunk.toString();
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      process.stdin.off('data', onData);
      resolve(buffer.slice(0, newline).trim());
    };
    process.stdin.on('data', onData);
  });
}

async function runWorker(role, directory) {
  const coordinator = openDb(join(directory, 'coordinator.sqlite'));
  const state = openDb(join(directory, 'validity.sqlite'));
  const ledger = openDb(join(directory, 'dispatch-ledger.sqlite'));

  // This transaction is the shared cross-process serialization primitive under test.
  coordinator.exec('BEGIN IMMEDIATE;');
  emit('LOCKED', { role });

  if (role === 'writer') {
    await waitForCommand();
    state.exec('BEGIN IMMEDIATE; UPDATE validity SET denied = 1 WHERE id = 1; COMMIT;');
    emit('INVALIDATION_COMMITTED');
    coordinator.exec('COMMIT;');
    emit('RELEASED', { role });
  } else if (role === 'gateway') {
    await waitForCommand();
    const current = state.prepare('SELECT denied FROM validity WHERE id = 1').get();

    if (current.denied !== 0) {
      ledger.prepare('INSERT INTO dispatch(outcome) VALUES (?)').run('denied');
      emit('DISPATCH_DENIED', { transportCalls: 0 });
    } else {
      // Persist the dispatch-start marker before invoking the transport spy.
      ledger.exec("BEGIN IMMEDIATE; INSERT INTO dispatch(outcome) VALUES ('dispatch-start'); COMMIT;");
      ledger.prepare('INSERT INTO transport_calls DEFAULT VALUES').run();
      emit('TRANSPORT_INVOKED', { transportCalls: 1 });
    }

    coordinator.exec('COMMIT;');
    emit('RELEASED', { role });
  } else {
    throw new Error('Unknown proof worker role');
  }

  coordinator.close();
  state.close();
  ledger.close();
}

if (workerRole && workerDirectory) {
  await runWorker(workerRole, workerDirectory);
} else {
  function startWorker(role, directory) {
    const child = spawn(process.execPath, [file], {
      env: { ...process.env, DISPATCH_ORDER_PROOF_ROLE: role, DISPATCH_ORDER_PROOF_DIR: directory },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const events = [];
    let stdoutBuffer = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk;
      let newline;
      while ((newline = stdoutBuffer.indexOf('\n')) >= 0) {
        const line = stdoutBuffer.slice(0, newline);
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        if (line.trim()) events.push(JSON.parse(line));
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    return {
      child,
      events,
      stderr: () => stderr,
      send: (command) => child.stdin.write(command + '\n'),
    };
  }

  async function waitFor(worker, event) {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const found = worker.events.find((entry) => entry.event === event);
      if (found) return found;
      if (worker.child.exitCode !== null) {
        throw new Error(`worker exited ${worker.child.exitCode} before ${event}: ${worker.stderr()}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`timed out waiting for ${event}; stderr=${worker.stderr()}`);
  }

  async function stop(worker) {
    if (worker.child.exitCode === null) {
      const exited = new Promise((resolve) => worker.child.once('exit', resolve));
      worker.child.stdin.end();
      await exited;
    }
    assert.equal(worker.child.exitCode, 0, worker.stderr());
  }

  async function exercise(writerFirst) {
    const directory = mkdtempSync(join(tmpdir(), 'logic-engine-dispatch-order-'));
    initialize(directory);
    try {
      if (writerFirst) {
        const writer = startWorker('writer', directory);
        await waitFor(writer, 'LOCKED');
        const gateway = startWorker('gateway', directory);
        // Gateway cannot acquire the coordinator lock while the writer holds it.
        await new Promise((resolve) => setTimeout(resolve, 150));
        writer.send('commit');
        await waitFor(writer, 'RELEASED');
        await waitFor(gateway, 'LOCKED');
        gateway.send('dispatch');
        await waitFor(gateway, 'DISPATCH_DENIED');
        await stop(writer);
        await stop(gateway);
      } else {
        const gateway = startWorker('gateway', directory);
        await waitFor(gateway, 'LOCKED');
        const writer = startWorker('writer', directory);
        // Writer cannot invalidate while gateway owns the coordinator lock.
        await new Promise((resolve) => setTimeout(resolve, 150));
        gateway.send('dispatch');
        await waitFor(gateway, 'TRANSPORT_INVOKED');
        await waitFor(gateway, 'RELEASED');
        await waitFor(writer, 'LOCKED');
        writer.send('commit');
        await waitFor(writer, 'RELEASED');
        await stop(gateway);
        await stop(writer);
      }

      const state = openDb(join(directory, 'validity.sqlite'));
      const ledger = openDb(join(directory, 'dispatch-ledger.sqlite'));
      const denied = state.prepare('SELECT denied FROM validity WHERE id = 1').get().denied;
      const outcomes = ledger.prepare('SELECT outcome FROM dispatch ORDER BY id').all().map((row) => row.outcome);
      const transportCalls = ledger.prepare('SELECT COUNT(*) AS count FROM transport_calls').get().count;
      state.close();
      ledger.close();
      return { denied, outcomes, transportCalls };
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  test('writer-first ordering: committed invalidation yields zero transport invocations', async () => {
    const result = await exercise(true);
    assert.equal(result.denied, 1);
    assert.deepEqual(result.outcomes, ['denied']);
    assert.equal(result.transportCalls, 0);
  });

  test('dispatch-first ordering: transport invocation precedes later invalidation', async () => {
    const result = await exercise(false);
    assert.equal(result.denied, 1);
    assert.deepEqual(result.outcomes, ['dispatch-start']);
    assert.equal(result.transportCalls, 1);
  });
}
