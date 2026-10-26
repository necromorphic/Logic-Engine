import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { linkSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

async function unusedLoopbackPort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return port;
}

async function waitForExit(child, timeoutMs = 3000) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    once(child, 'exit'),
    new Promise((resolveWait) => setTimeout(resolveWait, timeoutMs)),
  ]);
}

test('runtime process starts with isolated credentials/database and serves health', { timeout: 15000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-engine-startup-smoke-'));
  const port = await unusedLoopbackPort();
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: resolve('.'),
    env: {
      ...process.env,
      ENGINE_API_TOKEN: 'startup-smoke-api-token-123456',
      ENGINE_DB_PATH: join(directory, 'runtime.sqlite'),
      ENGINE_HOST_VERSION_LEDGER_DB_PATH: join(directory, 'host-versions.sqlite'),
      ENGINE_PORT: String(port),
      ENGINE_HOST: '127.0.0.1',
      ENGINE_INTERNAL_TOKEN: '',
      ENGINE_APPROVAL_TOKEN: '',
      ENGINE_ADMIN_TOKEN: '',
      ENGINE_ADAPTER_TOKENS: '{}',
      ENGINE_ALLOW_REMOTE: '',
    },
    stdio: 'ignore',
  });

  try {
    let response = null;
    let lastError = null;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error('Runtime exited before becoming healthy (code=' + child.exitCode + ', signal=' + child.signalCode + ').');
      }
      try {
        response = await fetch('http://127.0.0.1:' + port + '/health', { signal: AbortSignal.timeout(500) });
        if (response.ok) break;
        lastError = new Error('Health endpoint returned HTTP ' + response.status + '.');
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }

    assert.ok(response?.ok, 'Runtime did not become healthy: ' + String(lastError));
    assert.deepEqual(await response.json(), {
      ok: true,
      service: 'logic-engine',
      protocol_version: 'v1',
    });
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await waitForExit(child);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

test('runtime rejects coordinator database hard-link aliases', { timeout: 10000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-engine-coordinator-alias-'));
  const coordinatorPath = join(directory, 'shared.sqlite');
  const databaseAliasPath = join(directory, 'runtime-alias.sqlite');
  writeFileSync(coordinatorPath, '');
  linkSync(coordinatorPath, databaseAliasPath);
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: resolve('.'),
    env: {
      ...process.env,
      ENGINE_API_TOKEN: 'coordinator-alias-api-token-123456',
      ENGINE_DB_PATH: databaseAliasPath,
      LOGIC_ENGINE_COORDINATOR_DB_PATH: coordinatorPath,
      ENGINE_HOST_VERSION_LEDGER_DB_PATH: join(directory, 'host-versions.sqlite'),
      ENGINE_PORT: '18787',
      ENGINE_HOST: '127.0.0.1',
      ENGINE_INTERNAL_TOKEN: '',
      ENGINE_APPROVAL_TOKEN: '',
      ENGINE_ADMIN_TOKEN: '',
      ENGINE_ADAPTER_TOKENS: '{}',
      ENGINE_ALLOW_REMOTE: '',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  try {
    const [code] = await once(child, 'exit', { signal: AbortSignal.timeout(5000) });
    assert.notEqual(code, 0, 'Runtime must reject aliased Core and coordinator databases.');
    assert.match(stderr, /LOGIC_ENGINE_COORDINATOR_DB_PATH must be separate from ENGINE_DB_PATH, including filesystem aliases/);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await waitForExit(child);
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
