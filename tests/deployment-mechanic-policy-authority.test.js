import test from 'node:test';
import assert from 'node:assert/strict';
import { DeploymentMechanicPolicyAuthority } from '../src/application/deployment-mechanic-policy-authority.js';

function provider(version = 'policy-v1', scope = 'adapter-a:actor-a') {
  return {
    policyFingerprint: version,
    authorizationScope: scope,
    resolve: () => ({
      context: { actor: { hp: 10 } },
      knownAbsentPaths: [],
      dependencyEvidence: [{ path: 'actor.hp', kind: 'entity_attribute', entity_id: 'actor-a', attribute: 'hp' }],
      world_revision: 4,
      commit_sequence: 7,
      policy_version: version,
      authorization_scope: scope,
    }),
  };
}

test('deployment authority pins trusted identity and generation to resolved context', () => {
  const active = { authority_id: 'deployment-mechanics', generation: 3, contextProvider: provider() };
  const authority = new DeploymentMechanicPolicyAuthority({ resolveActivePolicy: () => active });
  const resolved = authority.resolveAuthorizedContext({ worldId: 'world-a' });
  assert.equal(resolved.authority_id, 'deployment-mechanics');
  assert.equal(resolved.policy_generation, 3);
  assert.equal(resolved.policy_version, 'policy-v1');
  assert.equal(authority.validateMechanicPolicy({
    worldId: 'world-a',
    authorityId: resolved.authority_id,
    policyGeneration: resolved.policy_generation,
    policyVersion: resolved.policy_version,
    authorizationScope: resolved.authorization_scope,
    snapshotIdentity: { world_id: 'world-a', world_revision: 4, commit_sequence: 7 },
  }), true);
});

test('deployment authority rejects stale generation after policy rotation', () => {
  let active = { authority_id: 'deployment-mechanics', generation: 3, contextProvider: provider() };
  const authority = new DeploymentMechanicPolicyAuthority({ resolveActivePolicy: () => active });
  const resolved = authority.resolveAuthorizedContext({ worldId: 'world-a' });
  active = { authority_id: 'deployment-mechanics', generation: 4, contextProvider: provider('policy-v2') };
  assert.equal(authority.validateMechanicPolicy({
    worldId: 'world-a',
    authorityId: resolved.authority_id,
    policyGeneration: resolved.policy_generation,
    policyVersion: resolved.policy_version,
    authorizationScope: resolved.authorization_scope,
    snapshotIdentity: { world_id: 'world-a', world_revision: 4, commit_sequence: 7 },
  }), false);
});

test('deployment authority fails closed for missing, malformed, or unavailable policy', () => {
  for (const resolveActivePolicy of [
    () => null,
    () => ({ authority_id: 'deployment-mechanics', generation: 0, contextProvider: provider() }),
    () => { throw new Error('unavailable'); },
  ]) {
    const authority = new DeploymentMechanicPolicyAuthority({ resolveActivePolicy });
    assert.throws(() => authority.resolveAuthorizedContext({ worldId: 'world-a' }));
    assert.equal(authority.validateMechanicPolicy({}), false);
  }
});

test('deployment authority rejects rotation during context resolution', () => {
  let calls = 0;
  const first = { authority_id: 'deployment-mechanics', generation: 3, contextProvider: provider() };
  const second = { authority_id: 'deployment-mechanics', generation: 4, contextProvider: provider('policy-v2') };
  const authority = new DeploymentMechanicPolicyAuthority({
    resolveActivePolicy: () => (++calls === 1 ? first : second),
  });
  assert.throws(() => authority.resolveAuthorizedContext({ worldId: 'world-a' }), /changed during/);
});
