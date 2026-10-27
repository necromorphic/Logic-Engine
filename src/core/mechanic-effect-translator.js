import { EngineError } from './errors.js';
import { validateEffects } from './rules.js';

const SUPPORTED_INTENTS = new Set(['create_entity', 'update_attribute', 'assert_fact']);
const KNOWN_INTENTS = new Set([
  'create_entity', 'update_attribute', 'create_relation', 'retract_relation',
  'assert_fact', 'retract_fact', 'propose_knowledge', 'reconcile_knowledge',
  'start_process', 'advance_process', 'cancel_process', 'create_task', 'update_task',
  'create_goal', 'update_goal', 'emit_event', 'request_adjudication', 'needs_review',
]);
const ENTITY_STATUSES = new Set(['active', 'inactive', 'destroyed', 'unknown']);
const TOP_LEVEL_FIELDS = new Set(['effect_id', 'kind', 'target_ref', 'payload', 'source_refs', 'caused_by']);
const MAX_BATCH = 128;
const MAX_ID = 200;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 10000;
const MAX_CONTAINER_ITEMS = 1000;
const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function fail(code, message, details = undefined) {
  throw new EngineError(code, message, 400, details);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value, label, max = MAX_ID) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    fail('INVALID_MECHANIC_EFFECT_INTENT', label + ' must be a non-empty string of at most ' + max + ' characters.');
  }
  return value.trim();
}

function identityText(value, label, max = MAX_ID) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value !== value.trim()) {
    fail('INVALID_MECHANIC_EFFECT_INTENT', label + ' must be a non-empty identifier of at most ' + max + ' characters without surrounding whitespace.');
  }
  return value;
}

function object(value, label) {
  if (!isObject(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    fail('INVALID_MECHANIC_EFFECT_INTENT', label + ' must be a plain JSON object.');
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length > MAX_CONTAINER_ITEMS) {
    fail('INVALID_MECHANIC_EFFECT_INTENT', label + ' exceeds the bounded object field count.');
  }
  for (const key of keys) {
    if (typeof key !== 'string') {
      fail('INVALID_MECHANIC_EFFECT_INTENT', label + ' must not contain symbol keys.');
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      fail('INVALID_MECHANIC_EFFECT_INTENT', label + ' must contain only enumerable data properties.');
    }
  }
  return value;
}

function jsonArray(value, label, maxItems = MAX_CONTAINER_ITEMS) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > maxItems || Object.getOwnPropertySymbols(value).length > 0) {
    fail('INVALID_MECHANIC_EFFECT_INTENT', label + ' must be a plain JSON array of at most ' + maxItems + ' items.');
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || !keys.includes('length')
    || !keys.every((key) => key === 'length'
      || (typeof key === 'string' && /^(0|[1-9][0-9]*)$/.test(key)
        && Number(key) < value.length && String(Number(key)) === key))) {
    fail('INVALID_MECHANIC_EFFECT_INTENT', label + ' must not contain holes or custom properties.');
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      fail('INVALID_MECHANIC_EFFECT_INTENT', label + ' must contain only enumerable data items.');
    }
  }
  return value;
}

function exactKeys(value, allowed, label) {
  const extra = Object.keys(value).filter((key) => !allowed.has(key));
  if (extra.length) fail('INVALID_MECHANIC_EFFECT_INTENT', label + ' contains unsupported field(s): ' + extra.join(', '));
}

function stringList(value, label) {
  jsonArray(value, label, 128);
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const item = Object.getOwnPropertyDescriptor(value, String(index)).value;
    if (typeof item !== 'string' || !item.trim() || item.length > MAX_ID || seen.has(item.trim())) {
      fail('INVALID_MECHANIC_EFFECT_INTENT', label + ' must contain unique, non-empty strings of at most 200 characters.');
    }
    seen.add(item.trim());
  }
  return value;
}

function cloneJson(value, label, active = new Set(), budget = { nodes: 0 }, depth = 0) {
  budget.nodes += 1;
  if (budget.nodes > MAX_JSON_NODES) {
    fail('INVALID_MECHANIC_EFFECT_INTENT', label + ' exceeds the bounded JSON node limit.');
  }
  if (depth > MAX_JSON_DEPTH) {
    fail('INVALID_MECHANIC_EFFECT_INTENT', label + ' exceeds the bounded JSON depth limit.');
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('INVALID_MECHANIC_EFFECT_INTENT', label + ' must contain only finite numbers.');
    return value;
  }
  if (typeof value !== 'object') {
    fail('INVALID_MECHANIC_EFFECT_INTENT', label + ' must contain only JSON values.');
  }
  if (active.has(value)) fail('INVALID_MECHANIC_EFFECT_INTENT', label + ' must not contain circular references.');
  active.add(value);
  let result;
  if (Array.isArray(value)) {
    jsonArray(value, label, MAX_CONTAINER_ITEMS);
    result = [];
    for (let index = 0; index < value.length; index += 1) {
      const item = Object.getOwnPropertyDescriptor(value, String(index)).value;
      result.push(cloneJson(item, label + '[' + index + ']', active, budget, depth + 1));
    }
  } else {
    object(value, label);
    const keys = Object.keys(value);
    if (keys.length > MAX_CONTAINER_ITEMS) {
      fail('INVALID_MECHANIC_EFFECT_INTENT', label + ' exceeds the bounded object field count.');
    }
    result = {};
    for (const key of keys) {
      if (UNSAFE_OBJECT_KEYS.has(key)) {
        fail('INVALID_MECHANIC_EFFECT_INTENT', label + ' contains an unsafe object key: ' + key + '.');
      }
      const item = Object.getOwnPropertyDescriptor(value, key).value;
      Object.defineProperty(result, key, { value: cloneJson(item, label + '.' + key, active, budget, depth + 1), enumerable: true, writable: true, configurable: true });
    }
  }
  active.delete(value);
  return result;
}

function validatePayload(effect) {
  if (!Object.hasOwn(effect, 'payload')) {
    fail('INVALID_MECHANIC_EFFECT_INTENT', effect.kind + ' requires payload.');
  }
  return object(effect.payload, 'payload');
}

function translateOne(effect, index, jsonBudget) {
  const label = 'intents[' + index + ']';
  object(effect, label);
  exactKeys(effect, TOP_LEVEL_FIELDS, label);

  for (const key of ['effect_id', 'kind', 'target_ref']) {
    if (!Object.hasOwn(effect, key)) fail('INVALID_MECHANIC_EFFECT_INTENT', label + ' is missing ' + key + '.');
  }
  identityText(effect.effect_id, label + '.effect_id', 128);
  const kind = identityText(effect.kind, label + '.kind', 128);
  const targetRef = identityText(effect.target_ref, label + '.target_ref', MAX_ID);

  if (!KNOWN_INTENTS.has(kind)) {
    fail('INVALID_MECHANIC_EFFECT_INTENT', label + '.kind is not a declared mechanic intent kind.');
  }
  if (!SUPPORTED_INTENTS.has(kind)) {
    fail('UNSUPPORTED_MECHANIC_EFFECT_INTENT', 'Mechanic intent kind is not supported by the initial translator: ' + kind, { kind });
  }

  for (const key of ['source_refs', 'caused_by']) {
    if (Object.hasOwn(effect, key)) stringList(effect[key], label + '.' + key);
    if (effect[key]?.length) {
      fail('TRANSLATION_REQUIRES_PROVENANCE_MAPPING', 'Non-empty ' + key + ' requires an approved event-level provenance mapping.', { effect_id: effect.effect_id, field: key });
    }
  }

  const payload = validatePayload(effect);
  let translated;

  if (kind === 'create_entity') {
    exactKeys(payload, new Set(['entity_type', 'status', 'attributes']), label + '.payload');
    const entityType = text(payload.entity_type, label + '.payload.entity_type', 200);
    translated = { kind: 'entity.create', entity_id: targetRef, entity_type: entityType };
    if (Object.hasOwn(payload, 'status')) {
      if (!ENTITY_STATUSES.has(payload.status)) fail('INVALID_MECHANIC_EFFECT_INTENT', label + '.payload.status is unsupported.');
      translated.status = payload.status;
    }
    if (Object.hasOwn(payload, 'attributes')) {
      translated.attributes = cloneJson(object(payload.attributes, label + '.payload.attributes'), label + '.payload.attributes', new Set(), jsonBudget);
    }
  } else if (kind === 'update_attribute') {
    exactKeys(payload, new Set(['attributes', 'remove_attributes', 'status']), label + '.payload');
    const hasAttributes = Object.hasOwn(payload, 'attributes');
    const hasRemovals = Object.hasOwn(payload, 'remove_attributes');
    const hasStatus = Object.hasOwn(payload, 'status');
    if (!hasAttributes && !hasRemovals && !hasStatus) {
      fail('INVALID_MECHANIC_EFFECT_INTENT', label + '.payload must contain attributes, remove_attributes, or status.');
    }
    if (!hasStatus
      && (!hasAttributes || Object.keys(payload.attributes ?? {}).length === 0)
      && (!hasRemovals || (Array.isArray(payload.remove_attributes) && payload.remove_attributes.length === 0))) {
      fail('INVALID_MECHANIC_EFFECT_INTENT', label + '.payload must not be an empty update patch.');
    }
    translated = { kind: 'entity.update', entity_id: targetRef };
    if (hasAttributes) {
      translated.attributes = cloneJson(object(payload.attributes, label + '.payload.attributes'), label + '.payload.attributes', new Set(), jsonBudget);
    }
    if (hasRemovals) {
      jsonArray(payload.remove_attributes, label + '.payload.remove_attributes', 200);
      const seen = new Set();
      translated.remove_attributes = [];
      for (let index = 0; index < payload.remove_attributes.length; index += 1) {
        const key = Object.getOwnPropertyDescriptor(payload.remove_attributes, String(index)).value;
        const normalized = text(key, label + '.payload.remove_attributes[]', 200);
        if (seen.has(normalized)) fail('INVALID_MECHANIC_EFFECT_INTENT', 'remove_attributes must not contain duplicates.');
        seen.add(normalized);
        translated.remove_attributes.push(normalized);
      }
      if (hasAttributes && translated.remove_attributes.some((key) => Object.hasOwn(translated.attributes, key))) {
        fail('INVALID_MECHANIC_EFFECT_INTENT', 'An attribute cannot be patched and removed in the same effect.');
      }
    }
    if (hasStatus) {
      if (!ENTITY_STATUSES.has(payload.status)) fail('INVALID_MECHANIC_EFFECT_INTENT', label + '.payload.status is unsupported.');
      translated.status = payload.status;
    }
  } else {
    exactKeys(payload, new Set(['predicate', 'value', 'subject_ref']), label + '.payload');
    const predicate = identityText(payload.predicate, label + '.payload.predicate', 200);
    if (!Object.hasOwn(payload, 'value')) fail('INVALID_MECHANIC_EFFECT_INTENT', label + '.payload.value is required.');
    translated = {
      kind: 'fact.set',
      fact_id: targetRef,
      predicate,
      value: cloneJson(payload.value, label + '.payload.value', new Set(), jsonBudget),
    };
    if (Object.hasOwn(payload, 'subject_ref')) {
      if (payload.subject_ref !== null && typeof payload.subject_ref !== 'string') {
        fail('INVALID_MECHANIC_EFFECT_INTENT', label + '.payload.subject_ref must be a string or null.');
      }
      translated.subject_ref = payload.subject_ref === null ? null : identityText(payload.subject_ref, label + '.payload.subject_ref');
    }
  }

  return translated;
}

/**
 * Translate a complete batch of mechanic effect intents to canonical effects.
 * Pure and all-or-nothing: this function never reads or mutates world state.
 */
export function translateMechanicEffectIntents(intents) {
  jsonArray(intents, 'intents', MAX_BATCH);
  if (intents.length === 0) {
    fail('INVALID_MECHANIC_EFFECT_INTENT', 'intents must be a non-empty array of at most ' + MAX_BATCH + ' items.');
  }

  const seenIds = new Set();
  for (let index = 0; index < intents.length; index += 1) {
    const intent = object(Object.getOwnPropertyDescriptor(intents, String(index)).value, 'intents[' + index + ']');
    if (typeof intent.effect_id !== 'string' || !intent.effect_id.trim()) {
      fail('INVALID_MECHANIC_EFFECT_INTENT', 'intents[' + index + '] must have a non-empty effect_id.');
    }
    const id = intent.effect_id.trim();
    if (seenIds.has(id)) fail('DUPLICATE_MECHANIC_EFFECT_ID', 'Duplicate effect_id in mechanic intent batch: ' + id, { effect_id: id });
    seenIds.add(id);
  }

  // Share one budget across all cloned payloads so a batch cannot reset the nested-JSON limits per intent.
  const jsonBudget = { nodes: 0 };
  const translated = intents.map((intent, index) => translateOne(intent, index, jsonBudget));
  try {
    validateEffects(translated);
  } catch (error) {
    fail('INVALID_MECHANIC_EFFECT_INTENT', 'Translated output failed canonical effect validation.', { cause: error?.code ?? 'UNKNOWN' });
  }
  return translated;
}