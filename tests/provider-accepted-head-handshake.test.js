import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { enrollAcceptedHeadDomain } from '../src/security/enroll-accepted-head-domain.js';
import { SQLiteMemoryProvider } from '../src/application/sqlite-memory-provider.js';
import { beginCoordinatorLock, openCoordinatorDatabase } from '../src/storage/coordinator-lock.js';
import {
  enrollAcceptedHeadSync,
  finalizeAcceptedHeadSync,
  getAcceptedHeadsSync,
} from '../src/security/accepted-head-client-sync.js';

const coreToken = 'core-token-for-provider-handshake-tests-00000000000000000000000000000001';
const providerToken = 'provider-token-for-provider-handshake-tests-00000000000000000000000000000002';
const digestA = 'a'.repeat(64);
const digestB = 'b'.repeat(64);

async function startAuthorityProcess(path) {
  const authorityUrl = new URL('../src/security/accepted-head-authority.js', import.meta.url).href;
  const script = [
    'import { AcceptedHeadAuthority, createAcceptedHeadAuthorityServer } from ' + JSON.stringify(authorityUrl) + ';',
    'const args = process.argv.slice(1);',
    'const authority = new AcceptedHeadAuthority({ path: args[0], installationId: "provider-handshake-test-installation" });',
    'const server = createAcceptedHeadAuthorityServer({ authority, coreToken: process.env.LE_TEST_CORE_TOKEN, providerToken: process.env.LE_TEST_PROVIDER_TOKEN });',
    'server.listen(0, "127.0.0.1", () => process.stdout.write("LISTENING:" + server.address().port + "\\n"));',
    'process.stdin.on("data", () => server.close(() => { authority.close(); process.exit(0); }));',
  ].join('\n');
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, path], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: {
      PATH: process.env.PATH || '',
      SystemRoot: process.env.SystemRoot || '',
      WINDIR: process.env.WINDIR || '',
      LE_TEST_CORE_TOKEN: coreToken,
      LE_TEST_PROVIDER_TOKEN: providerToken,
    },
  });
  const [chunk] = await once(child.stdout, 'data');
  const match = String(chunk).match(/LISTENING:(\d+)/);
  if (!match) {
    child.kill();
    throw new Error('Accepted-head test service did not start.');
  }
  return { child, port: Number(match[1]) };
}

function setEnv(name, value, previous) {
  previous[name] = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

const providerOptions = (path, coordinatorPath) => ({
  path,
  coordinatorPath,
  getSnapshot: async () => ({ world_revision: 0, commit_sequence: 0 }),
  validateSourceVersion: async () => true,
  validateInventory: async () => true,
});

test('Provider mutations advance accepted head before commit and fail closed when authority is unavailable', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-provider-accepted-head-'));
  const providerPath = join(directory, 'provider.sqlite');
  const coordinatorPath = join(directory, 'coordinator.sqlite');
  const authorityPath = join(directory, 'authority.sqlite');
  const previousEnv = {};
  let child;
  let provider;
  try {
    setEnv('LOGIC_ENGINE_COORDINATOR_DB_PATH', coordinatorPath, previousEnv);
    setEnv('LOGIC_ENGINE_ACCEPTED_HEAD_REQUIRED', undefined, previousEnv);
    setEnv('LOGIC_ENGINE_ACCEPTED_HEAD_PORT', undefined, previousEnv);
    setEnv('LOGIC_ENGINE_ACCEPTED_HEAD_PROVIDER_TOKEN', undefined, previousEnv);
    const bootstrap = new SQLiteMemoryProvider(providerOptions(providerPath, coordinatorPath));
    bootstrap.close();

    const service = await startAuthorityProcess(authorityPath);
    child = service.child;
    const port = service.port;

    const coordinatorDb = openCoordinatorDatabase(coordinatorPath);
    const release = beginCoordinatorLock(coordinatorDb);
    try {
      const enrolledCore = enrollAcceptedHeadSync({
        domain: 'core', operationId: 'core-baseline-enrollment', operationDigest: digestA, token: coreToken, port,
      });
      finalizeAcceptedHeadSync({
        domain: 'core', operationId: enrolledCore.operation_id, operationDigest: digestA, token: coreToken, port,
      });

      enrollAcceptedHeadDomain({
        domain: 'provider',
        databasePath: providerPath,
        coordinatorPath,
        port,
        token: providerToken,
        approvalId: 'approval-provider-test',
        baselineDigest: digestB,
      });
    } finally {
      release();
      coordinatorDb.close();
    }

    setEnv('LOGIC_ENGINE_ACCEPTED_HEAD_PORT', String(port), previousEnv);
    setEnv('LOGIC_ENGINE_ACCEPTED_HEAD_PROVIDER_TOKEN', providerToken, previousEnv);
    setEnv('LOGIC_ENGINE_ACCEPTED_HEAD_REQUIRED', '1', previousEnv);
    provider = new SQLiteMemoryProvider(providerOptions(providerPath, coordinatorPath));
    const scope = { world_id: 'world-1', subject_id: 'npc-1', purpose: 'recall' };

    provider.grantQuery(scope, true);
    assert.equal(provider.authorizeQuery(scope), true);
    assert.deepEqual(getAcceptedHeadsSync({ port }), { core: 1, provider: 2 });
    const localHead = provider.db.prepare('SELECT head,enrolled FROM accepted_head_state WHERE singleton=1').get();
    assert.equal(localHead.head, 2);
    assert.equal(localHead.enrolled, 1);

    child.stdin.end('stop');
    await once(child, 'exit');
    child = null;

    assert.throws(() => provider.grantQuery(scope, false), /ACCEPTED_HEAD_AUTHORITY_UNAVAILABLE/);
    assert.equal(provider.authorizeQuery(scope), true);
  } finally {
    try { provider?.close(); } catch {}
    if (child) {
      child.stdin.end('stop');
      await once(child, 'exit');
    }
    for (const [name, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
