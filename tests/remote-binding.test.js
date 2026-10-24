import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const API_TOKEN = 'remote-binding-test-token-123456';

async function unusedPort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return port;
}

function runtimeEnv(directory, port, allowRemote) {
  return {
    ...process.env,
    ENGINE_API_TOKEN: API_TOKEN,
    ENGINE_DB_PATH: join(directory, 'remote-mode.sqlite'),
    ENGINE_PORT: String(port),
    ENGINE_HOST: '0.0.0.0',
    ENGINE_ALLOW_REMOTE: allowRemote ? 'true' : '',
    ENGINE_INTERNAL_TOKEN: '',
    ENGINE_APPROVAL_TOKEN: '',
    ENGINE_ADMIN_TOKEN: '',
    ENGINE_ADAPTER_TOKENS: '{}',
  };
}

test('non-loopback binding is rejected without explicit ENGINE_ALLOW_REMOTE opt-in', () => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-engine-remote-deny-'));
  try {
    const result = spawnSync(process.execPath, ['src/index.js'], {
      cwd: resolve('.'),
      env: runtimeEnv(directory, 18787, false),
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(result.status, 1, result.stdout + '\n' + result.stderr);
    assert.match(result.stderr, /Remote binding is disabled unless ENGINE_ALLOW_REMOTE=true/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('non-loopback binding starts only when ENGINE_ALLOW_REMOTE=true is explicit', { timeout: 15000 }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-engine-remote-allow-'));
  const port = await unusedPort();
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: resolve('.'),
    env: runtimeEnv(directory, port, true),
    stdio: 'ignore',
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await Promise.race([
        once(child, 'exit'),
        new Promise((resolveWait) => setTimeout(resolveWait, 2000)),
      ]);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    rmSync(directory, { recursive: true, force: true });
  });

  let response = null;
  let lastError = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('Remote-opt-in runtime exited before health check (code=' + child.exitCode + ', signal=' + child.signalCode + ').');
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
  assert.ok(response?.ok, 'Explicit remote opt-in did not start a healthy listener: ' + String(lastError));
  assert.deepEqual(await response.json(), {
    ok: true,
    service: 'logic-engine',
    protocol_version: 'v1',
  });
});
