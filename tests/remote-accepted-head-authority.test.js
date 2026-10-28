import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { once } from 'node:events';
import { createRemoteAnchorServer } from '../src/security/remote-accepted-head-authority.js';
import { serializeRemoteAnchorRecord } from '../src/security/remote-accepted-head-client.js';

const installationId = 'install-server-test';
const token = 'service-token-' + 's'.repeat(40);
const otherToken = 'other-token-' + 'x'.repeat(40);
const coreDigestA = 'a'.repeat(64);
const coreDigestB = 'c'.repeat(64);
const providerDigest = 'b'.repeat(64);
const { privateKey } = generateKeyPairSync('ed25519');

function recordDigest(envelope) {
  return createHash('sha256').update(serializeRemoteAnchorRecord(envelope.record), 'utf8').digest('hex');
}

function createMemoryStore() {
  const heads = new Map();
  return {
    async getHead(id) {
      return heads.get(id) ?? null;
    },
    async appendIfHead({ installationId: id, expectedSequence, expectedDigest, envelope }) {
      const current = heads.get(id) ?? null;
      const sequence = current?.record.sequence ?? 0;
      const digest = current ? recordDigest(current) : null;
      if (sequence !== expectedSequence || digest !== expectedDigest) return false;
      heads.set(id, envelope);
      return true;
    },
  };
}

async function withServer(t, { credentials = { [installationId]: { token } }, store = createMemoryStore() } = {}) {
  const authority = createRemoteAnchorServer({
    store,
    credentials,
    signingPrivateKey: privateKey,
    epochId: 'epoch-server-test',
    keyId: 'key-server-test',
    contractVersion: 1,
  });
  authority.server.listen(0, '127.0.0.1');
  await once(authority.server, 'listening');
  const address = authority.server.address();
  t.after(async () => {
    await new Promise((resolve, reject) => authority.server.close((error) => error ? reject(error) : resolve()));
  });
  return { base: 'http://127.0.0.1:' + address.port, authority, store };
}

async function append(base, body, suppliedToken = token) {
  return fetch(base + '/v1/installations/' + installationId + '/records', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + suppliedToken, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function requestBody(overrides = {}) {
  return {
    expected_sequence: 0,
    expected_digest: null,
    core_head_digest: coreDigestA,
    provider_readiness_digest: providerDigest,
    contract_version: 1,
    record_type: 'ADVANCE',
    recovery_reason: null,
    ...overrides,
  };
}

test('remote authority signs genesis and serves it only to the enrolled service credential', async (t) => {
  const { base, authority } = await withServer(t);
  const denied = await fetch(base + '/v1/installations/' + installationId + '/head');
  assert.equal(denied.status, 403);

  const created = await append(base, requestBody());
  assert.equal(created.status, 201);
  const envelope = await created.json();
  assert.equal(envelope.record.installation_id, installationId);
  assert.equal(envelope.record.sequence, 1);
  assert.equal(envelope.record.previous_record_digest, null);
  assert.equal(envelope.record.key_id, 'key-server-test');

  const fetched = await fetch(base + '/v1/installations/' + installationId + '/head', {
    headers: { authorization: 'Bearer ' + token },
  });
  assert.equal(fetched.status, 200);
  assert.deepEqual(await fetched.json(), envelope);

  const wrongTokenResponse = await fetch(base + '/v1/installations/' + installationId + '/head', {
    headers: { authorization: 'Bearer ' + otherToken },
  });
  assert.equal(wrongTokenResponse.status, 403);
  assert.equal(typeof authority.publicKey, 'string');
});

test('sequence exhaustion fails closed without mutating the anchor store', async (t) => {
  const record = {
    installation_id: installationId,
    epoch_id: 'epoch-server-test',
    key_id: 'key-server-test',
    sequence: Number.MAX_SAFE_INTEGER,
    previous_record_digest: 'd'.repeat(64),
    core_head_digest: coreDigestA,
    provider_readiness_digest: providerDigest,
    contract_version: 1,
    record_type: 'ADVANCE',
    recovery_reason: null,
  };
  const envelope = {
    record,
    signature: sign(null, Buffer.from(serializeRemoteAnchorRecord(record), 'utf8'), privateKey).toString('base64url'),
  };
  let appendCalls = 0;
  const store = {
    async getHead() { return envelope; },
    async appendIfHead() { appendCalls += 1; return true; },
  };
  const { base } = await withServer(t, { store });
  const stale = await append(base, requestBody({
    expected_sequence: Number.MAX_SAFE_INTEGER - 1,
    expected_digest: 'e'.repeat(64),
  }));
  assert.equal(stale.status, 409);
  assert.deepEqual(await stale.json(), { error: 'HEAD_CONFLICT' });

  const response = await append(base, requestBody({
    expected_sequence: Number.MAX_SAFE_INTEGER,
    expected_digest: recordDigest(envelope),
  }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'ANCHOR_SEQUENCE_EXHAUSTED' });
  assert.equal(appendCalls, 0);
});

test('compare-and-append rejects stale heads and concurrent append forks', async (t) => {
  const { base } = await withServer(t);
  assert.equal((await append(base, requestBody())).status, 201);

  const stale = await append(base, requestBody({
    expected_sequence: 0,
    expected_digest: null,
    core_head_digest: coreDigestB,
  }));
  assert.equal(stale.status, 409);

  const nextBody = requestBody({
    expected_sequence: 1,
    expected_digest: null, // deliberately stale digest
    core_head_digest: coreDigestB,
  });
  const conflict = await append(base, nextBody);
  assert.equal(conflict.status, 409);

  const firstHead = await fetch(base + '/v1/installations/' + installationId + '/head', {
    headers: { authorization: 'Bearer ' + token },
  }).then(r => r.json());
  const expectedDigest = recordDigest(firstHead);
  const concurrentBody = requestBody({
    expected_sequence: 1,
    expected_digest: expectedDigest,
    core_head_digest: coreDigestB,
  });
  const results = await Promise.all([
    append(base, concurrentBody),
    append(base, { ...concurrentBody, core_head_digest: coreDigestA }),
  ]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  const head = await fetch(base + '/v1/installations/' + installationId + '/head', {
    headers: { authorization: 'Bearer ' + token },
  }).then(r => r.json());
  assert.equal(head.record.sequence, 2);
});

test('recovery and re-enrollment require explicit privileged credentials', async (t) => {
  const { base } = await withServer(t);
  const recovery = requestBody({ record_type: 'RECOVERY', recovery_reason: 'restore review' });
  assert.equal((await append(base, recovery)).status, 403);

  const privileged = { [installationId]: { token, allowRecovery: true } };
  const second = await withServer(t, { credentials: privileged });
  assert.equal((await append(second.base, recovery)).status, 201);
  const badReason = requestBody({ record_type: 'RECOVERY', recovery_reason: null });
  assert.equal((await append(second.base, badReason)).status, 400);
  const reenroll = requestBody({ record_type: 'REENROLL', recovery_reason: null });
  assert.equal((await append(second.base, reenroll)).status, 400);
});

test('rejects unknown fields, contract mismatch, and oversized request bodies', async (t) => {
  const { base } = await withServer(t);
  const wrongContentType = await fetch(base + '/v1/installations/' + installationId + '/records', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'text/plain' },
    body: JSON.stringify(requestBody()),
  });
  assert.equal(wrongContentType.status, 415);
  assert.equal((await append(base, { ...requestBody(), installation_id: 'spoofed' })).status, 400);
  assert.equal((await append(base, requestBody({ contract_version: 2 }))).status, 400);
  const oversized = await fetch(base + '/v1/installations/' + installationId + '/records', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify({ data: 'x'.repeat(5000) }),
  });
  assert.equal(oversized.status, 413);
});

test('refuses non-Ed25519 signing keys and invalid store configuration', () => {
  assert.throws(() => createRemoteAnchorServer({
    store: createMemoryStore(),
    credentials: { [installationId]: { token } },
    signingPrivateKey: 'not a private key',
    epochId: 'epoch',
    keyId: 'key',
  }), /Ed25519 private key/);
  assert.throws(() => createRemoteAnchorServer({
    store: {},
    credentials: { [installationId]: { token } },
    signingPrivateKey: privateKey,
    epochId: 'epoch',
    keyId: 'key',
  }), /Invalid remote anchor server configuration/);
});
