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

  const core = openDb(join(directory, 'core.sqlite'));
  core.exec('CREATE TABLE source_validity (id INTEGER PRIMARY KEY, valid INTEGER NOT NULL); INSERT INTO source_validity VALUES (1, 1);');
  core.close();

  const provider = openDb(join(directory, 'provider.sqlite'));
  provider.exec('CREATE TABLE provider_readiness (id INTEGER PRIMARY KEY, grant_valid INTEGER NOT NULL, ready INTEGER NOT NULL); INSERT INTO provider_readiness VALUES (1, 1, 1);');
  provider.close();

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
  const core = openDb(join(directory, 'core.sqlite'));
  const provider = openDb(join(directory, 'provider.sqlite'));
  const ledger = openDb(join(directory, 'dispatch-ledger.sqlite'));

  // All participants must acquire this same cross-process serialization primitive
  // before changing validity or recording dispatch-start.
  coordinator.exec('BEGIN IMMEDIATE;');
  emit('LOCKED', { role });

  if (role === 'core-writer' || role === 'provider-revoke' || role === 'provider-not-ready') {
    await waitForCommand();
    if (role === 'core-writer') {
      core.exec('BEGIN IMMEDIATE; UPDATE source_validity SET valid = 0 WHERE id = 1; COMMIT;');
    } else if (role === 'provider-revoke') {
      provider.exec('BEGIN IMMEDIATE; UPDATE provider_readiness SET grant_valid = 0 WHERE id = 1; COMMIT;');
    } else {
      provider.exec('BEGIN IMMEDIATE; UPDATE provider_readiness SET ready = 0 WHERE id = 1; COMMIT;');
    }
    emit('INVALIDATION_COMMITTED', { role });
    coordinator.exec('COMMIT;');
    emit('RELEASED', { role });
  } else if (role === 'gateway') {
    await waitForCommand();
    const source = core.prepare('SELECT valid FROM source_validity WHERE id = 1').get();
    const access = provider.prepare('SELECT grant_valid, ready FROM provider_readiness WHERE id = 1').get();
    if (source.valid !== 1 || access.grant_valid !== 1 || access.ready !== 1) {
      ledger.prepare('INSERT INTO dispatch(outcome) VALUES (?)').run('denied');
      emit('DISPATCH_DENIED', { transportCalls: 0 });
    } else {
      // Dispatch-start is durable before the simulated actual transport invocation.
      ledger.exec("BEGIN IMMEDIATE; INSERT INTO dispatch(outcome) VALUES ('dispatch-start'); COMMIT;");
      ledger.prepare('INSERT INTO transport_calls DEFAULT VALUES').run();
      emit('TRANSPORT_INVOKED', { transportCalls: 1 });
    }
    coordinator.exec('COMMIT;');
    emit('RELEASED', { role });
  } else if (role === 'gateway-crash-before-transport' || role === 'gateway-crash-after-transport') {
    const source = core.prepare('SELECT valid FROM source_validity WHERE id = 1').get();
    const access = provider.prepare('SELECT grant_valid, ready FROM provider_readiness WHERE id = 1').get();
    if (source.valid !== 1 || access.grant_valid !== 1 || access.ready !== 1) {
      throw new Error('Crash scenario requires valid source and Provider access');
    }
    ledger.exec("BEGIN IMMEDIATE; INSERT INTO dispatch(outcome) VALUES ('dispatch-start'); COMMIT;");
    const event = role === 'gateway-crash-before-transport'
      ? 'CRASH_AFTER_DURABLE_START_BEFORE_TRANSPORT'
      : 'CRASH_AFTER_TRANSPORT_BEFORE_RESPONSE';
    if (role === 'gateway-crash-after-transport') {
      ledger.prepare('INSERT INTO transport_calls DEFAULT VALUES').run();
    }
    emit(event);
    await waitForCommand();
    process.exit(73);
    return;
  } else if (role === 'recovery') {
    const marker = ledger.prepare("SELECT 1 AS found FROM dispatch WHERE outcome = 'dispatch-start' LIMIT 1").get();
    const calls = ledger.prepare('SELECT COUNT(*) AS count FROM transport_calls').get().count;
    emit(marker ? 'AMBIGUOUS_NO_RETRY' : 'NO_DISPATCH_TO_RECOVER', { transportCalls: calls });
    coordinator.exec('COMMIT;');
    emit('RELEASED', { role });
  } else {
    throw new Error('Unknown proof worker role: ' + role);
  }

  coordinator.close();
  core.close();
  provider.close();
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

  async function waitForExit(worker) {
    if (worker.child.exitCode !== null) return worker.child.exitCode;
    return await new Promise((resolve) => worker.child.once('exit', (code) => resolve(code)));
  }

  async function stop(worker) {
    if (worker.child.exitCode === null) {
      const exited = new Promise((resolve) => worker.child.once('exit', resolve));
      worker.child.stdin.end();
      await exited;
    }
    assert.equal(worker.child.exitCode, 0, worker.stderr());
  }

  async function crashRecovery(crashRole, expectedTransportCalls) {
    const directory = mkdtempSync(join(tmpdir(), 'logic-engine-dispatch-crash-'));
    initialize(directory);
    try {
      const gateway = startWorker(crashRole, directory);
      const expectedEvent = crashRole === 'gateway-crash-before-transport'
        ? 'CRASH_AFTER_DURABLE_START_BEFORE_TRANSPORT'
        : 'CRASH_AFTER_TRANSPORT_BEFORE_RESPONSE';
      await waitFor(gateway, expectedEvent);
      gateway.send('crash');
      assert.equal(await waitForExit(gateway), 73, gateway.stderr());

      const recovery = startWorker('recovery', directory);
      const recovered = await waitFor(recovery, 'AMBIGUOUS_NO_RETRY');
      assert.equal(recovered.transportCalls, expectedTransportCalls);
      await waitFor(recovery, 'RELEASED');
      await stop(recovery);

      const ledger = openDb(join(directory, 'dispatch-ledger.sqlite'));
      const outcomes = ledger.prepare('SELECT outcome FROM dispatch ORDER BY id').all().map((row) => row.outcome);
      const calls = ledger.prepare('SELECT COUNT(*) AS count FROM transport_calls').get().count;
      ledger.close();
      assert.deepEqual(outcomes, ['dispatch-start']);
      assert.equal(calls, expectedTransportCalls, 'restart must not automatically retry an ambiguous dispatch');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  async function exercise(writerRole, writerFirst) {
    const directory = mkdtempSync(join(tmpdir(), 'logic-engine-dispatch-order-'));
    initialize(directory);
    try {
      if (writerFirst) {
        const writer = startWorker(writerRole, directory);
        await waitFor(writer, 'LOCKED');
        const gateway = startWorker('gateway', directory);
        // Gateway cannot acquire the shared lock while the validity writer holds it.
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
        const writer = startWorker(writerRole, directory);
        // Core/Provider writer cannot change validity while gateway owns the lock.
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

      const core = openDb(join(directory, 'core.sqlite'));
      const provider = openDb(join(directory, 'provider.sqlite'));
      const ledger = openDb(join(directory, 'dispatch-ledger.sqlite'));
      const sourceValid = core.prepare('SELECT valid FROM source_validity WHERE id = 1').get().valid;
      const access = provider.prepare('SELECT grant_valid, ready FROM provider_readiness WHERE id = 1').get();
      const outcomes = ledger.prepare('SELECT outcome FROM dispatch ORDER BY id').all().map((row) => row.outcome);
      const transportCalls = ledger.prepare('SELECT COUNT(*) AS count FROM transport_calls').get().count;
      core.close();
      provider.close();
      ledger.close();
      return { sourceValid, grantValid: access.grant_valid, ready: access.ready, outcomes, transportCalls };
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  for (const writerRole of ['core-writer', 'provider-revoke', 'provider-not-ready']) {
    test(`writer-first: ${writerRole} wins and actual transport count is zero`, async () => {
      const result = await exercise(writerRole, true);
      assert.equal(result.outcomes[0], 'denied');
      assert.equal(result.transportCalls, 0);
      if (writerRole === 'core-writer') assert.equal(result.sourceValid, 0);
      if (writerRole === 'provider-revoke') assert.equal(result.grantValid, 0);
      if (writerRole === 'provider-not-ready') assert.equal(result.ready, 0);
    });

    test(`dispatch-first: gateway invokes transport before ${writerRole}`, async () => {
      const result = await exercise(writerRole, false);
      assert.deepEqual(result.outcomes, ['dispatch-start']);
      assert.equal(result.transportCalls, 1);
      if (writerRole === 'core-writer') assert.equal(result.sourceValid, 0);
      if (writerRole === 'provider-revoke') assert.equal(result.grantValid, 0);
      if (writerRole === 'provider-not-ready') assert.equal(result.ready, 0);
    });
  }

  test('restart after durable dispatch-start but before transport does not auto-retry', async () => {
    await crashRecovery('gateway-crash-before-transport', 0);
  });

  test('restart after transport invocation but before response does not auto-retry', async () => {
    await crashRecovery('gateway-crash-after-transport', 1);
  });
}
