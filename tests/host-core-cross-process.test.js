import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSillyTavernHostAdapter } from '../host-adapter/extension-gateway/server-plugin/host-adapter.mjs';
import { HostIdentityStore } from '../host-adapter/extension-gateway/server-plugin/st-host-identity-store.mjs';

const API_TOKEN = 'cross-process-api-token-long-enough';
const ADAPTER_TOKEN = 'cross-process-adapter-token-long-enough';
const ADAPTER_ID = 'st-host-cross-process';
const SESSION = '33333333-3333-4333-8333-333333333333';
const CONVERSATION = '44444444-4444-4444-8444-444444444444';
const REQUEST_ID = '55555555-5555-4555-8555-555555555555';
const SOURCE_MANIFEST_SHA256 = 'c'.repeat(64);
const CORE_SERVER_FIXTURE = fileURLToPath(new URL('./fixtures/host-core-sqlite-core-server.mjs', import.meta.url));

function responseRecorder() {
  return {
    statusCode: null,
    payload: null,
    headers: {},
    set(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    sendStatus(code) { this.statusCode = code; return this; },
  };
}

function waitForReady(child) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const lines = createInterface({ input: child.stdout });
    const onStderr = chunk => { stderr += chunk.toString(); };
    child.stderr.on('data', onStderr);
    lines.on('line', line => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message?.ready === true && Number.isInteger(message.port)) {
        child.stderr.off('data', onStderr);
        lines.close();
        resolve(message);
      }
    });
    child.once('error', error => reject(error));
    child.once('exit', code => reject(new Error(
      'Isolated Core process exited before readiness (code ' + code + '): ' + stderr,
    )));
  });
}

test('Host adapter retrieves SQLite Memory from an independently running Core process', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'host-core-cross-process-'));
  const corePath = join(directory, 'core.sqlite');
  const providerPath = join(directory, 'memory-provider.sqlite');
  const coordinatorPath = join(directory, 'coordinator.sqlite');
  const noncePath = join(directory, 'host-assertion-nonces.sqlite');
  const dataRoot = join(directory, 'st-data');
  const identityDirectory = join(directory, 'host-identity');
  const userRoot = join(dataRoot, 'default-user');
  const directories = {
    root: userRoot,
    chats: join(userRoot, 'chats'),
    groups: join(userRoot, 'groups'),
    groupChats: join(userRoot, 'groupChats'),
    extensions: join(userRoot, 'extensions'),
  };
  for (const path of [dataRoot, identityDirectory, ...Object.values(directories)]) {
    mkdirSync(path, { recursive: true });
  }

  const previousDataRoot = globalThis.DATA_ROOT;
  globalThis.DATA_ROOT = dataRoot;
  let coreProcess;
  try {
    const identityStore = new HostIdentityStore({ directory: identityDirectory });
    const hostIdentity = await identityStore.resolveAuthenticatedAccount('cross-process-user');
    coreProcess = spawn(process.execPath, [CORE_SERVER_FIXTURE], {
      env: {
        ...process.env,
        CORE_DB_PATH: corePath,
        PROVIDER_DB_PATH: providerPath,
        COORDINATOR_DB_PATH: coordinatorPath,
        NONCE_DB_PATH: noncePath,
        API_TOKEN,
        ADAPTER_ID,
        ADAPTER_TOKEN,
        SESSION_ID: SESSION,
        HOST_INSTALLATION_ID: hostIdentity.host_installation_id,
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    const ready = await waitForReady(coreProcess);
    assert.notEqual(coreProcess.pid, process.pid, 'Core HTTP must run in a separate OS process');

    const env = {
      LOGIC_ENGINE_CORE_URL: 'http://127.0.0.1:' + ready.port,
      LOGIC_ENGINE_API_TOKEN: API_TOKEN,
      LOGIC_ENGINE_ADAPTER_ID: ADAPTER_ID,
      LOGIC_ENGINE_ADAPTER_TOKEN: ADAPTER_TOKEN,
      LOGIC_ENGINE_HOST_IDENTITY_DIR: identityDirectory,
      LOGIC_ENGINE_HOST_BUILD_SHA: '06bde939fb1e9c4c8d8641d810f0a916b5bce127',
    };
    const authoritativeInventory = {
      filesystem: {
        status: 'complete', entries: [], snapshot_id: 'cross-process-vss-snapshot',
      },
      mutation_coverage: { status: 'VERIFIED', source_commit: '06bde939fb1e9c4c8d8641d810f0a916b5bce127', coverage_manifest_sha256: 'c'.repeat(64), route_count: 1, source_files_sha256: 'd'.repeat(64) },
      snapshot_alignment: 'SHARED_VSS_SNAPSHOT',
      source: {
        status: 'DOUBLE_SCAN_CANDIDATE',
        authority: 'NON_AUTHORITATIVE',
        host_commit: '06bde939fb1e9c4c8d8641d810f0a916b5bce127',
        scope: 'PINNED_SILLYTAVERN_CHAT_DATA_ROOTS',
        historical_boundary: 'CURRENT_FILE_SET_ONLY_ENROLLMENT_BASELINE_REQUIRED',
        logical_identity_status: 'CURRENT_FILE_IDENTITIES_VERIFIED',
        files: [{
          logical_identity: {
            conversation_uuid: CONVERSATION,
            identity_status: 'CURRENT_IDENTITIES_VERIFIED',
          },
        }],
        blockers: [],
        snapshot_id: 'cross-process-vss-snapshot',
        snapshot_provider: 'windows-vss-client-accessible',
        snapshot_consistency: 'VSS_POINT_IN_TIME_READ_ONLY',
      },
      authority: { status: 'AUTHORITATIVE_COMPLETE', manifest_sha256: 'a'.repeat(64) },
    };
    const hostAdapter = createSillyTavernHostAdapter({
      env,
      enumerate: async () => structuredClone(authoritativeInventory),
      fetchImpl: fetch,
      verifySourceIdentity: async () => ({
        status: 'CURRENT_IDENTITIES_VERIFIED',
        manifest_sha256: SOURCE_MANIFEST_SHA256,
        patch_blob_sha: 'd'.repeat(64),
        host_handler_blob_sha: 'e'.repeat(40),
      }),
      persistRootInventory: async () => ({
        status: 'AUTHORITATIVE_COMPLETE',
        integrity_status: 'INTEGRITY_OK',
        sequence: 1,
        manifest_sha256: 'b'.repeat(64),
        source_manifest_sha256: SOURCE_MANIFEST_SHA256,
        attestation_sha256: 'f'.repeat(64),
        lifecycle_sequence: 1,
        lifecycle_head_sha256: '1'.repeat(64),
      }),
    });
    const request = {
      user: {
        profile: { handle: 'cross-process-user' },
        directories,
      },
      session: {
        handle: 'cross-process-user',
        logicEngineSessionId: SESSION,
        logicEngineSessionHandle: 'cross-process-user',
      },
      body: {
        request_id: REQUEST_ID,
        conversation_uuid: CONVERSATION,
        context_size: 4096,
        generation_type: 'normal',
      },
    };
    const middlewareResponse = responseRecorder();
    let passed = false;
    await hostAdapter.dispatchMiddleware(request, middlewareResponse, () => { passed = true; });
    assert.equal(passed, true, 'Host authentication/inventory middleware must admit the fixture request');
    const response = responseRecorder();
    await hostAdapter.dispatch(request, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.retrieval.status, 'ready');
    assert.equal(response.payload.retrieval.candidates.length, 1);
    assert.equal(
      response.payload.retrieval.candidates[0].content['attributes.public_note'],
      'retrieved across process boundary',
    );
  } finally {
    if (coreProcess && coreProcess.exitCode === null && coreProcess.signalCode === null) {
      const exited = once(coreProcess, 'exit').catch(() => {});
      if (coreProcess.connected) coreProcess.send({ type: 'shutdown' });
      else coreProcess.kill('SIGTERM');
      await exited;
    }
    if (previousDataRoot === undefined) delete globalThis.DATA_ROOT;
    else globalThis.DATA_ROOT = previousDataRoot;
    rmSync(directory, { recursive: true, force: true });
  }
});
