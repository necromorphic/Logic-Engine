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
};

test('root identity registry parses immutable exact deployment bindings', () => {
  const registry = parseHostRootIdentityRegistry(JSON.stringify([binding]));
  assert.equal(Object.isFrozen(registry), true);
  assert.equal(Object.isFrozen(registry[0]), true);
  assert.deepEqual(registry[0], binding);
});

test('root identity registry rejects malformed, duplicate and unsupported records', () => {
  for (const value of [
    '{',
    '{}',
    JSON.stringify([{ ...binding, extra: 'not-allowed' }]),
    JSON.stringify([binding, binding]),
    JSON.stringify([{ ...binding, root_id: 'not-a-digest' }]),
    JSON.stringify([{ ...binding, adapter_id: ' ' }]),
  ]) {
    assert.throws(() => parseHostRootIdentityRegistry(value));
  }
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
  assert.equal(resolveRegisteredHostRootIdentity(registry, binding).authorized, true);
  assert.equal(resolveRegisteredHostRootIdentity(registry, {
    ...binding, root_id: 'b'.repeat(64),
  }).authorized, false);
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

test('journal lifecycle resolver independently rechecks installation/account and conversation UUID', () => {
  const registry = parseHostRootIdentityRegistry(JSON.stringify([binding]));
  const accepted = resolveRegisteredHostLifecycleIdentity(registry, {
    host_installation_id: binding.host_installation_id,
    authenticated_account_id: binding.authenticated_account_id,
    conversation_uuid: '33333333-3333-4333-8333-333333333333',
  });
  assert.equal(accepted.authorized, true);
  assert.equal(resolveRegisteredHostLifecycleIdentity(registry, {
    host_installation_id: binding.host_installation_id,
    authenticated_account_id: '44444444-4444-4444-8444-444444444444',
    conversation_uuid: '33333333-3333-4333-8333-333333333333',
  }).authorized, false);
});
