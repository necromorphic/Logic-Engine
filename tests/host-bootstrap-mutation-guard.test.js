import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createHostBulkMutationGuard } from '../host-adapter/extension-gateway/server-plugin/st-host-inventory-handler.mjs';

const PINNED_COMMIT = '06bde939fb1e9c4c8d8641d810f0a916b5bce127';

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'logic-engine-host-bootstrap-'));
  const characters = path.join(root, 'characters');
  const chats = path.join(root, 'chats');
  mkdirSync(characters);
  mkdirSync(chats);
  return {
    root,
    directories: { root, characters, chats },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function makeResponse() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    set(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function makeRequest(directories, overrides = {}) {
  return {
    method: 'POST',
    baseUrl: '/api/characters',
    path: '/create',
    body: { ch_name: 'Assistant', file_name: 'default_Assistant', creator_notes: 'Automatically created character.' },
    user: { profile: { handle: 'default-user' }, directories },
    session: {
      logicEngineSessionId: '11111111-1111-4111-8111-111111111111',
      logicEngineSessionHandle: 'default-user',
    },
    ...overrides,
  };
}

test('Host bulk guard permits only first-run native default Assistant creation', t => {
  const fx = fixture();
  t.after(fx.cleanup);
  const guard = createHostBulkMutationGuard({ pinnedHostCommit: PINNED_COMMIT });
  const response = makeResponse();
  let nextCalls = 0;

  guard(makeRequest(fx.directories), response, () => { nextCalls++; });

  assert.equal(nextCalls, 1);
  assert.equal(response.statusCode, null);
});

test('Host bulk guard keeps ordinary character creation fail-closed', t => {
  const fx = fixture();
  t.after(fx.cleanup);
  const guard = createHostBulkMutationGuard({ pinnedHostCommit: PINNED_COMMIT });
  const cases = [
    makeRequest(fx.directories, { baseUrl: '/api/groups' }),
    makeRequest(fx.directories, { body: { ch_name: 'Other', file_name: 'other' } }),
    makeRequest(fx.directories, { method: 'PUT' }),
    makeRequest(fx.directories, { session: { logicEngineSessionId: 'invalid', logicEngineSessionHandle: 'default-user' } }),
  ];

  for (const request of cases) {
    const response = makeResponse();
    let nextCalls = 0;
    guard(request, response, () => { nextCalls++; });
    assert.equal(nextCalls, 0);
    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, 'HOST_BULK_MUTATION_UNSUPPORTED');
  }
});

test('Host bulk guard denies bootstrap if Assistant avatar or chat directory already exists', t => {
  const fx = fixture();
  t.after(fx.cleanup);
  const guard = createHostBulkMutationGuard({ pinnedHostCommit: PINNED_COMMIT });

  for (const target of [
    path.join(fx.directories.characters, 'default_Assistant.png'),
    path.join(fx.directories.chats, 'default_Assistant'),
  ]) {
    if (target.endsWith('.png')) writeFileSync(target, 'existing');
    else mkdirSync(target);
    const response = makeResponse();
    let nextCalls = 0;
    guard(makeRequest(fx.directories), response, () => { nextCalls++; });
    assert.equal(nextCalls, 0);
    assert.equal(response.statusCode, 503);
    rmSync(target, { recursive: true, force: true });
  }
});

test('Host bulk guard denies bootstrap when account directories escape the root', t => {
  const fx = fixture();
  const outside = mkdtempSync(path.join(os.tmpdir(), 'logic-engine-host-outside-'));
  t.after(() => { fx.cleanup(); rmSync(outside, { recursive: true, force: true }); });
  const guard = createHostBulkMutationGuard({ pinnedHostCommit: PINNED_COMMIT });
  const response = makeResponse();
  let nextCalls = 0;

  guard(makeRequest({ ...fx.directories, characters: outside }), response, () => { nextCalls++; });

  assert.equal(nextCalls, 0);
  assert.equal(response.statusCode, 503);
});

test('Host bulk guard accepts only the stock Assistant image upload shape', t => {
  const fx = fixture();
  t.after(fx.cleanup);
  const guard = createHostBulkMutationGuard({ pinnedHostCommit: PINNED_COMMIT });
  const response = makeResponse();
  let nextCalls = 0;

  guard(makeRequest(fx.directories, {
    file: { originalname: 'custom.png', mimetype: 'image/png', size: 128 },
  }), response, () => { nextCalls++; });

  assert.equal(nextCalls, 0);
  assert.equal(response.statusCode, 503);
});
