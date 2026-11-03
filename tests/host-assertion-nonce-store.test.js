import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  HostAssertionNonceStore,
  HostSessionRevocationReader,
} from '../src/application/host-assertion-nonce-store.js';

const identity = Object.freeze({
  host_installation_id: '11111111-1111-4111-8111-111111111111',
  authenticated_account_id: '22222222-2222-4222-8222-222222222222',
  host_session_id: '33333333-3333-4333-8333-333333333333',
});

test('Host session revocation is durable and visible to a read-only Gateway reader', () => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-engine-host-revocation-'));
  const corePath = join(directory, 'core.sqlite');
  const coordinatorPath = join(directory, 'coordinator.sqlite');
  const providerPath = join(directory, 'provider.sqlite');
  const noncePath = join(directory, 'host-assertion-nonces.sqlite');
  let store;
  let reader;
  try {
    store = new HostAssertionNonceStore({
      path: noncePath,
      coreDatabasePath: corePath,
      coordinatorPath,
      providerDatabasePath: providerPath,
    });
    reader = new HostSessionRevocationReader({ path: noncePath });
    assert.equal(reader.isSessionRevoked('st-adapter', identity), false);
    assert.equal(store.revokeSession(
      'st-adapter', identity,
      '44444444-4444-4444-8444-444444444444',
      1_800_000_000,
      'logout',
    ), true);
    assert.equal(reader.isSessionRevoked('st-adapter', identity), true);
    assert.equal(store.revokeSession(
      'st-adapter', identity,
      '44444444-4444-4444-8444-444444444444',
      1_800_000_001,
      'logout',
    ), false);
    assert.equal(reader.isSessionRevoked('st-adapter', identity), true);
  } finally {
    try { reader?.close(); } finally {
      try { store?.close(); } finally { rmSync(directory, { recursive: true, force: true }); }
    }
  }
});

test('Host session revocation reader treats malformed identity as revoked', () => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-engine-host-revocation-invalid-'));
  const corePath = join(directory, 'core.sqlite');
  const coordinatorPath = join(directory, 'coordinator.sqlite');
  const noncePath = join(directory, 'host-assertion-nonces.sqlite');
  let store;
  let reader;
  try {
    store = new HostAssertionNonceStore({ path: noncePath, coreDatabasePath: corePath, coordinatorPath });
    reader = new HostSessionRevocationReader({ path: noncePath });
    assert.equal(reader.isSessionRevoked('st-adapter', { ...identity, host_session_id: 'invalid' }), true);
  } finally {
    try { reader?.close(); } finally {
      try { store?.close(); } finally { rmSync(directory, { recursive: true, force: true }); }
    }
  }
});
