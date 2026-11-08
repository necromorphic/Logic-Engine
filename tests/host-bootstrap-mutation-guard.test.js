import assert from 'node:assert/strict';
import test from 'node:test';

import { createHostBulkMutationGuard } from '../host-adapter/extension-gateway/server-plugin/st-host-inventory-handler.mjs';

const PINNED_COMMIT = '06bde939fb1e9c4c8d8641d810f0a916b5bce127';

function makeResponse() {
  return {
    statusCode: null,
    body: null,
    set() { return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('Host bulk guard always delegates native character creation and Assistant bootstrap', () => {
  const guard = createHostBulkMutationGuard({ pinnedHostCommit: PINNED_COMMIT });
  const requests = [
    { method: 'POST', originalUrl: '/api/characters/create', body: { file_name: 'default_Assistant' } },
    { method: 'POST', originalUrl: '/api/characters/create', body: { file_name: 'custom-character' } },
    { method: 'POST', originalUrl: '/api/characters/create', body: undefined },
    { method: 'PUT', originalUrl: '/api/characters/edit', body: {} },
  ];

  for (const request of requests) {
    const response = makeResponse();
    let nextCalls = 0;
    guard(request, response, () => { nextCalls++; });
    assert.equal(response.statusCode, null);
    assert.equal(nextCalls, 1);
  }
});

test('Host bulk guard never scans user files to authorize native writes', () => {
  let enumerateCalls = 0;
  const guard = createHostBulkMutationGuard({
    pinnedHostCommit: PINNED_COMMIT,
    enumerate: async () => { enumerateCalls++; throw new Error('native write must not depend on inventory'); },
  });
  const response = makeResponse();
  let nextCalls = 0;

  guard({
    method: 'POST',
    originalUrl: '/api/characters/create',
    user: { profile: { handle: 'default-user' }, directories: {} },
    session: { logicEngineSessionId: 'invalid-or-missing' },
  }, response, () => { nextCalls++; });

  assert.equal(response.statusCode, null);
  assert.equal(nextCalls, 1);
  assert.equal(enumerateCalls, 0);
});
