import test from 'node:test';
import assert from 'node:assert/strict';
import { createHostRootInventoryPersistence } from '../server-plugin/st-server-digest-proxy.mjs';

const env = {
  LOGIC_ENGINE_CORE_URL: 'http://127.0.0.1:8787',
  LOGIC_ENGINE_API_TOKEN: 'core-api-token-long-enough-123456',
  LOGIC_ENGINE_ADAPTER_ID: 'st-host-adapter',
  LOGIC_ENGINE_ADAPTER_TOKEN: 'host-adapter-token-long-enough-123456',
};
const entries = [{
  path: 'chats/chat.jsonl',
  identity: { dev: '1', ino: '2', mode: 33188, size: 0, mtimeMs: 1, ctimeMs: 1 },
  sha256: 'a'.repeat(64),
}];
const identityStore = {
  resolveAuthenticatedAccount: async () => ({
    host_installation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    authenticated_account_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  }),
};

test('Host preserves AUTHORITATIVE_COMPLETE only with Core integrity, monotonic sequence and manifest', async () => {
  const persist = createHostRootInventoryPersistence({
    env,
    identityStore,
    fetchImpl: async () => ({
      status: 200,
      json: async () => ({
        reconciliation: {
          status: 'AUTHORITATIVE_COMPLETE',
          integrity_status: 'INTEGRITY_OK',
          sequence: 7,
          manifest_sha256: 'c'.repeat(64),
        },
      }),
    }),
  });
  const proof = await persist({ userHandle: 'alice', rootPath: '/srv/st/data', entries });
  assert.equal(proof.status, 'AUTHORITATIVE_COMPLETE');
  assert.equal(proof.integrity_status, 'INTEGRITY_OK');
  assert.equal(proof.sequence, 7);
  assert.equal(proof.manifest_sha256, 'c'.repeat(64));
});

test('Host rejects authoritative-looking Core status without complete proof fields', async t => {
  const invalid = [
    { status: 'AUTHORITATIVE_COMPLETE', integrity_status: 'INTEGRITY_UNVERIFIED', sequence: 7, manifest_sha256: 'c'.repeat(64) },
    { status: 'AUTHORITATIVE_COMPLETE', integrity_status: 'INTEGRITY_OK', sequence: 0, manifest_sha256: 'c'.repeat(64) },
    { status: 'AUTHORITATIVE_COMPLETE', integrity_status: 'INTEGRITY_OK', sequence: 7, manifest_sha256: 'bad' },
  ];
  for (const reconciliation of invalid) {
    const persist = createHostRootInventoryPersistence({
      env,
      identityStore,
      fetchImpl: async () => ({ status: 200, json: async () => ({ reconciliation }) }),
    });
    const result = await persist({ userHandle: 'alice', rootPath: '/srv/st/data', entries });
    assert.equal(result.status, 'NON_READY');
  }
});
