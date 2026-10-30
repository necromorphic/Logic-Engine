import test from 'node:test';
import assert from 'node:assert/strict';
import {
  trustedMechanicPolicyRevision,
  validateTrustedMechanicPolicyConfig,
} from '../src/application/trusted-mechanic-policy-config.js';

function config() {
  return {
    authority_id: 'deployment-mechanics',
    generation: 1,
    policy_version: 'npc-visibility-v1',
    authorization_scope: 'npc-decision',
    adapter_id: 'sillytavern',
    actor_entity_id: 'npc:kiryu',
    recipient: 'model',
    purpose: 'npc_decision',
    bindings: [
      { path: 'actor.hp', entity_id: 'npc:kiryu', attribute: 'hp' },
      { path: 'world.weather', entity_id: 'world:kamurocho', attribute: 'weather' },
    ],
    allowed_fields: [
      { entity_id: 'npc:kiryu', attribute: 'hp' },
      { entity_id: 'world:kamurocho', attribute: 'weather' },
    ],
  };
}

test('trusted mechanic policy config accepts the bounded exact deployment schema', () => {
  const validated = validateTrustedMechanicPolicyConfig(config());
  assert.equal(validated.authority_id, 'deployment-mechanics');
  assert.equal(validated.generation, 1);
  assert.equal(Object.isFrozen(validated), true);
  assert.equal(Object.isFrozen(validated.bindings), true);
  assert.equal(Object.isFrozen(validated.allowed_fields), true);
  assert.match(trustedMechanicPolicyRevision(validated), /^[a-f0-9]{64}$/);
});

test('trusted mechanic policy config rejects caller-shaped, incomplete, and uncovered policy fields', () => {
  const unknown = { ...config(), actor: 'caller-controlled' };
  assert.throws(() => validateTrustedMechanicPolicyConfig(unknown), /missing or unsupported fields/);

  const incomplete = config();
  delete incomplete.generation;
  assert.throws(() => validateTrustedMechanicPolicyConfig(incomplete), /missing or unsupported fields/);

  const uncovered = config();
  uncovered.allowed_fields = [{ entity_id: 'npc:kiryu', attribute: 'hp' }];
  assert.throws(() => validateTrustedMechanicPolicyConfig(uncovered), /Every mechanic context binding/);

  const duplicate = config();
  duplicate.bindings.push({ ...duplicate.bindings[0] });
  assert.throws(() => validateTrustedMechanicPolicyConfig(duplicate), /invalid or duplicate context binding/);
});

test('effective policy revision changes when any trusted deployment policy input changes', () => {
  const original = config();
  const changedVisibility = config();
  changedVisibility.allowed_fields = [
    { entity_id: 'npc:kiryu', attribute: 'hp' },
    { entity_id: 'world:kamurocho', attribute: 'weather' },
    { entity_id: 'world:kamurocho', attribute: 'crowd_level' },
  ];
  assert.notEqual(trustedMechanicPolicyRevision(original), trustedMechanicPolicyRevision(changedVisibility));

  const changedGeneration = config();
  changedGeneration.generation += 1;
  assert.notEqual(trustedMechanicPolicyRevision(original), trustedMechanicPolicyRevision(changedGeneration));
});
