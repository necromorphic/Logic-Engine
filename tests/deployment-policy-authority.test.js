import test from 'node:test';
import assert from 'node:assert/strict';
import { DeploymentPolicyAuthority } from '../src/application/deployment-policy-authority.js';

test('deployment policy authority captures stable identity and active generation', () => {
  let generation = 1;
  const authority = new DeploymentPolicyAuthority({
    authorityIdentity: 'deployment.visibility',
    resolveActivePolicy: () => ({
      authority_identity: 'deployment.visibility',
      generation,
      authorizeField: () => true,
    }),
  });

  const first = authority.capture();
  assert.equal(first.authority_identity, 'deployment.visibility');
  assert.equal(first.policy_generation, '1');
  assert.equal(authority.isCurrent(first), true);

  generation = 2;
  assert.equal(authority.isCurrent(first), false);
  const second = authority.capture();
  assert.equal(second.policy_generation, '2');
  assert.notEqual(second.policy_version, first.policy_version);
});

test('deployment policy authority fails closed for missing, malformed, or unavailable policy', () => {
  let active = {
    authority_identity: 'deployment.visibility',
    generation: 'generation-1',
    authorizeField: () => true,
  };
  const authority = new DeploymentPolicyAuthority({
    authorityIdentity: 'deployment.visibility',
    resolveActivePolicy: () => active,
  });

  assert.equal(authority.authorizeField({}, {}, 'attributes.name'), true);
  active = { authority_identity: 'other.authority', generation: 'generation-2', authorizeField: () => true };
  assert.equal(authority.isCurrent({ authority_identity: 'deployment.visibility', policy_generation: 'generation-1' }), false);
  assert.equal(authority.authorizeField({}, {}, 'attributes.name'), false);

  active = null;
  assert.equal(authority.isCurrent({ authority_identity: 'deployment.visibility', policy_generation: 'generation-1' }), false);
  assert.throws(() => authority.capture(), /unavailable or malformed/);
});

test('deployment policy authority accepts only explicit boolean allow decisions', () => {
  for (const decision of [undefined, null, 1, 'true', false]) {
    const authority = new DeploymentPolicyAuthority({
      authorityIdentity: 'deployment.visibility',
      resolveActivePolicy: () => ({
        authority_identity: 'deployment.visibility',
        generation: 1,
        authorizeField: () => decision,
      }),
    });
    assert.equal(authority.authorizeField({}, {}, 'attributes.secret'), false);
  }
});
