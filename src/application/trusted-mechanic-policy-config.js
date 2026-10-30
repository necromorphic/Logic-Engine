import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { hashRequest } from '../core/request-hash.js';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = (value) => typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= 200;

export function validateTrustedMechanicPolicyConfig(config) {
  const allowed = [
    'authority_id', 'generation', 'policy_version', 'authorization_scope',
    'adapter_id', 'actor_entity_id', 'recipient', 'purpose', 'bindings', 'allowed_fields',
  ];
  if (!object(config) || Object.keys(config).some((key) => !allowed.includes(key))
    || allowed.some((key) => !Object.hasOwn(config, key))) {
    throw new TypeError('Mechanic policy config has missing or unsupported fields.');
  }
  if (!validId(config.authority_id) || !Number.isSafeInteger(config.generation) || config.generation < 1
    || !validId(config.policy_version) || !validId(config.authorization_scope)
    || !validId(config.adapter_id) || !validId(config.actor_entity_id)
    || !['model', 'player', 'adapter'].includes(config.recipient)
    || !['npc_decision', 'character_card', 'narrative'].includes(config.purpose)
    || !Array.isArray(config.bindings) || !Array.isArray(config.allowed_fields)) {
    throw new TypeError('Mechanic policy config contains invalid identity, generation, principal, or collections.');
  }
  const bindingPaths = new Set();
  for (const binding of config.bindings) {
    if (!object(binding) || Object.keys(binding).some((key) => !['path', 'entity_id', 'attribute'].includes(key))
      || !validId(binding.path) || !validId(binding.entity_id) || !validId(binding.attribute)
      || bindingPaths.has(binding.path)) {
      throw new TypeError('Mechanic policy config contains an invalid or duplicate context binding.');
    }
    bindingPaths.add(binding.path);
  }
  const fieldKeys = new Set();
  for (const field of config.allowed_fields) {
    if (!object(field) || Object.keys(field).some((key) => !['entity_id', 'attribute'].includes(key))
      || !validId(field.entity_id) || !validId(field.attribute)) {
      throw new TypeError('Mechanic policy config contains an invalid allowed field.');
    }
    const key = JSON.stringify([field.entity_id, field.attribute]);
    if (fieldKeys.has(key)) throw new TypeError('Mechanic policy config contains duplicate allowed fields.');
    fieldKeys.add(key);
  }
  if (config.bindings.some((binding) => !fieldKeys.has(JSON.stringify([binding.entity_id, binding.attribute])))) {
    throw new TypeError('Every mechanic context binding must be covered by the same configured read-field policy.');
  }
  return Object.freeze({
    ...config,
    bindings: Object.freeze(config.bindings.map((item) => Object.freeze({ ...item }))),
    allowed_fields: Object.freeze(config.allowed_fields.map((item) => Object.freeze({ ...item }))),
  });
}

export function loadTrustedMechanicPolicyConfig(path) {
  if (typeof path !== 'string' || !path.trim() || !isAbsolute(path)) {
    throw new TypeError('Mechanic policy config path must be an absolute deployment-controlled path.');
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('Deployment mechanic policy config is unavailable or invalid JSON.');
  }
  return validateTrustedMechanicPolicyConfig(parsed);
}

export function trustedMechanicPolicyRevision(config) {
  const validated = validateTrustedMechanicPolicyConfig(config);
  return hashRequest(validated);
}

export function createTrustedMechanicFieldPolicy(configPath) {
  return (context, entity, field) => {
    let config;
    try {
      config = loadTrustedMechanicPolicyConfig(configPath);
    } catch {
      return false;
    }
    if (context?.authenticatedAdapterId !== config.adapter_id
      || context?.actor?.entity_id !== config.actor_entity_id
      || context?.recipient !== config.recipient
      || context?.purpose !== config.purpose) return false;
    if (entity?.entity_id === context.actor.entity_id
      && ['entity_id', 'entity_type', 'status'].includes(field)) return true;
    if (typeof field !== 'string' || !field.startsWith('attributes.')) return false;
    const attribute = field.slice('attributes.'.length);
    return config.allowed_fields.some((item) => item.entity_id === entity?.entity_id && item.attribute === attribute);
  };
}
