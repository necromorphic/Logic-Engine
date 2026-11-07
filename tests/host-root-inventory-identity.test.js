import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHostRootIdentityRegistry,
  resolveAdapterHostRootIdentity,
  resolveRegisteredHostRootIdentity,
  resolveAdapterHostLifecycleIdentity,
  resolveRegisteredHostLifecycleIdentity,
} from '../src/application/host-root-inventory-identity.js';

const binding = {
  adapter_id: 'adapter-a',
  host_installation_id: '11111111-1111-4111-8111-111111111111',
  authenticated_account_id: '22222222-2222-4222-8222-222222222222',
  root_id: 'a'.repeat(64),
  source_manifest_sha256: 'b'.repeat(64),
};

test('root identity registry parses immutable exact deployment bindings', () => {
  const registry = parseHostRootIdentityRegistry(JSON.stringify([binding]));
  assert.equal(Object.isFrozen(registry), true);
  assert.equal(Object.isFrozen(registry[0]), true);
  assert.deepEqual(registry[0], binding);
  assert.equal(resolveAdapterHostRootIdentity(registry, {
    adapterId: binding.adapter_id,
    host_installation_id: binding.host_installation_id,
    authenticated_account_id: binding.authenticated_account_id,
    root_id: binding.root_id,
  }).source_manifest_sha256, binding.source_manifest_sha256);
});

test('root identity registry rejects malformed, duplicate and unsupported records', () => {
  for (const value of [
    '{',
    '{}',
    JSON.stringify([{ ...binding, extra: 'not-allowed' }]),
    JSON.stringify([binding, binding]),
    JSON.stringify([{ ...binding, root_id: 'not-a-digest' }]),
    JSON.stringify([{ ...binding, source_manifest_sha256: undefined }]),
    JSON.stringify([{ ...binding, adapter_id: ' ' }]),
  ]) {
    assert.throws(() => parseHostRootIdentityRegistry(value));
  }
});

test('root identity registry rejects ambiguous adapter or manifest entries for the same Host root', () => {
  assert.throws(() => parseHostRootIdentityRegistry(JSON.stringify([
    binding,
    { ...binding, source_manifest_sha256: 'c'.repeat(64) },
  ])), /ambiguous root identity binding/);
  assert.throws(() => parseHostRootIdentityRegistry(JSON.stringify([
    binding,
    { ...binding, adapter_id: 'adapter-b' },
  ])), /ambiguous root identity binding/);
});

test('adapter resolver requires the exact adapter, installation, account and root tuple', () => {
  const registry = parseHostRootIdentityRegistry(JSON.stringify([binding]));
  const accepted = resolveAdapterHostRootIdentity(registry, {
    adapterId: binding.adapter_id,
    host_installation_id: binding.host_installation_id,
    authenticated_account_id: binding.authenticated_account_id,
    root_id: binding.root_id,
  });
  assert.equal(accepted.authorized, true);
  for (const input of [
    { adapterId: 'adapter-b' },
    { adapterId: binding.adapter_id, host_installation_id: '33333333-3333-4333-8333-333333333333' },
    { adapterId: binding.adapter_id, authenticated_account_id: '44444444-4444-4444-8444-444444444444' },
    { adapterId: binding.adapter_id, root_id: 'b'.repeat(64) },
  ]) {
    assert.equal(resolveAdapterHostRootIdentity(registry, {
      adapterId: binding.adapter_id,
      host_installation_id: binding.host_installation_id,
      authenticated_account_id: binding.authenticated_account_id,
      root_id: binding.root_id,
      ...input,
    }).authorized, false);
  }
});

test('journal resolver independently checks the registered installation/account/root tuple', () => {
  const registry = parseHostRootIdentityRegistry(JSON.stringify([binding]));
  const accepted = resolveRegisteredHostRootIdentity(registry, binding);
  assert.equal(accepted.authorized, true);
  assert.equal(accepted.source_manifest_sha256, binding.source_manifest_sha256);
  assert.equal(resolveRegisteredHostRootIdentity(registry, {
    ...binding, root_id: 'b'.repeat(64),
  }).authorized, false);
});


test('callers cannot substitute the deployment-pinned source manifest digest', () => {
  const registry = parseHostRootIdentityRegistry(JSON.stringify([binding]));
  const forged = {
    adapterId: binding.adapter_id,
    host_installation_id: binding.host_installation_id,
    authenticated_account_id: binding.authenticated_account_id,
    root_id: binding.root_id,
    source_manifest_sha256: 'c'.repeat(64),
  };
  const adapterResolution = resolveAdapterHostRootIdentity(registry, forged);
  const journalResolution = resolveRegisteredHostRootIdentity(registry, forged);
  assert.equal(adapterResolution.authorized, true);
  assert.equal(journalResolution.authorized, true);
  assert.equal(adapterResolution.source_manifest_sha256, binding.source_manifest_sha256);
  assert.equal(journalResolution.source_manifest_sha256, binding.source_manifest_sha256);
  assert.notEqual(adapterResolution.source_manifest_sha256, forged.source_manifest_sha256);
});

test('lifecycle identity resolver binds adapter, installation and account before accepting a conversation UUID', () => {
  const registry = parseHostRootIdentityRegistry(JSON.stringify([binding]));
  const accepted = resolveAdapterHostLifecycleIdentity(registry, {
    adapterId: binding.adapter_id,
    host_installation_id: binding.host_installation_id,
    authenticated_account_id: binding.authenticated_account_id,
    host_session_id: '33333333-3333-4333-8333-333333333333',
    conversation_uuid: '33333333-3333-4333-8333-333333333333',
  });
  assert.equal(accepted.authorized, true);
  assert.equal(accepted.host_session_id, '33333333-3333-4333-8333-333333333333');
  assert.equal(accepted.conversation_uuid, '33333333-3333-4333-8333-333333333333');
  assert.equal(resolveAdapterHostLifecycleIdentity(registry, {
    adapterId: 'other-adapter',
    host_installation_id: binding.host_installation_id,
    authenticated_account_id: binding.authenticated_account_id,
    host_session_id: '33333333-3333-4333-8333-333333333333',
    conversation_uuid: '33333333-3333-4333-8333-333333333333',
  }).authorized, false);
  assert.equal(resolveAdapterHostLifecycleIdentity(registry, {
    adapterId: binding.adapter_id,
    host_installation_id: binding.host_installation_id,
    authenticated_account_id: '44444444-4444-4444-8444-444444444444',
    host_session_id: '33333333-3333-4333-8333-333333333333',
    conversation_uuid: '33333333-3333-4333-8333-333333333333',
  }).authorized, false);
  assert.equal(resolveAdapterHostLifecycleIdentity(registry, {
    adapterId: binding.adapter_id,
    host_installation_id: binding.host_installation_id,
    authenticated_account_id: binding.authenticated_account_id,
    host_session_id: '33333333-3333-4333-8333-333333333333',
    conversation_uuid: 'not-a-uuid',
  }).authorized, false);
});

test('journal lifecycle resolver independently rechecks installation/account/session and conversation UUID', () => {
  const registry = parseHostRootIdentityRegistry(JSON.stringify([binding]));
  const accepted = resolveRegisteredHostLifecycleIdentity(registry, {
    host_installation_id: binding.host_installation_id,
    authenticated_account_id: binding.authenticated_account_id,
    host_session_id: '33333333-3333-4333-8333-333333333333',
    conversation_uuid: '44444444-4444-4444-8444-444444444444',
  });
  assert.equal(accepted.authorized, true);
  assert.equal(accepted.host_session_id, '33333333-3333-4333-8333-333333333333');
  assert.equal(resolveRegisteredHostLifecycleIdentity(registry, {
    host_installation_id: binding.host_installation_id,
    authenticated_account_id: '55555555-5555-4555-8555-555555555555',
    host_session_id: '33333333-3333-4333-8333-333333333333',
    conversation_uuid: '44444444-4444-4444-8444-444444444444',
  }).authorized, false);
  assert.equal(resolveRegisteredHostLifecycleIdentity(registry, {
    host_installation_id: binding.host_installation_id,
    authenticated_account_id: binding.authenticated_account_id,
    conversation_uuid: '44444444-4444-4444-8444-444444444444',
  }).authorized, false, 'a Host session is mandatory for lifecycle identity resolution');
});
