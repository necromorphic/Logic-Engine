import { EngineError } from './errors.js';

const OPS = new Set(['eq', 'neq', 'exists', 'gt', 'gte', 'lt', 'lte', 'in', 'all', 'any', 'not']);
const UNSAFE_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

function readPath(root, path) {
  if (typeof path !== 'string' || !path || path.split('.').some((key) => !key || UNSAFE_PATH_SEGMENTS.has(key))) {
    throw new EngineError('INVALID_RULE_PATH', 'Unsafe or empty rule path.');
  }

  let value = root;
  for (const key of path.split('.')) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) return { exists: false };
    value = value[key];
  }
  return { exists: true, value };
}

// JSON object member order is not semantically meaningful; array order is.
function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
  }
  return value;
}

function jsonEqual(left, right) {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

function nestedRules(rule, op) {
  // "rules" is the canonical schema form. The legacy aliases keep existing callers working.
  const hasRules = Object.hasOwn(rule, 'rules');
  const legacyKey = op === 'not' ? 'condition' : 'conditions';
  const hasLegacy = Object.hasOwn(rule, legacyKey);
  if (hasRules && hasLegacy) {
    throw new EngineError('INVALID_RULE', 'Use the canonical rules field or its legacy alias, not both.');
  }

  if (hasRules) {
    if (!Array.isArray(rule.rules)) throw new EngineError('INVALID_RULE', op + ' requires a rules array.');
    return rule.rules;
  }
  if (op === 'not' && hasLegacy) return [rule.condition];
  if (op !== 'not' && hasLegacy) {
    if (!Array.isArray(rule.conditions)) throw new EngineError('INVALID_RULE', op + ' requires a conditions array.');
    return rule.conditions;
  }
  throw new EngineError('INVALID_RULE', op === 'not' ? 'not requires exactly one nested rule.' : op + ' requires a rules array.');
}

export function evaluateCondition(rule, context, depth = 0) {
  if (depth > 24) throw new EngineError('RULE_DEPTH_EXCEEDED', 'Rule nesting exceeds 24 levels.');
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
    throw new EngineError('INVALID_RULE', 'Condition must be an object.');
  }

  const op = rule.op;
  if (!OPS.has(op)) throw new EngineError('UNSUPPORTED_RULE_OPERATOR', 'Unsupported operator: ' + String(op));

  if (op === 'all' || op === 'any') {
    const rules = nestedRules(rule, op);
    if (rules.length > 64) throw new EngineError('INVALID_RULE', op + ' supports at most 64 nested rules.');
    const results = rules.map((item) => evaluateCondition(item, context, depth + 1));
    return op === 'all' ? results.every(Boolean) : results.some(Boolean);
  }

  if (op === 'not') {
    const rules = nestedRules(rule, op);
    if (rules.length !== 1) throw new EngineError('INVALID_RULE', 'not requires exactly one nested rule.');
    return !evaluateCondition(rules[0], context, depth + 1);
  }

  if (op !== 'exists' && !Object.hasOwn(rule, 'value') && op !== 'in') {
    throw new EngineError('INVALID_RULE', op + ' requires a value.');
  }

  const found = readPath(context, rule.path);
  if (op === 'exists') return found.exists === Boolean(rule.value ?? true);
  if (!found.exists) return false;
  if (op === 'eq') return jsonEqual(found.value, rule.value);
  if (op === 'neq') return !jsonEqual(found.value, rule.value);

  if (['gt', 'gte', 'lt', 'lte'].includes(op)) {
    if (typeof found.value !== 'number' || typeof rule.value !== 'number'
      || !Number.isFinite(found.value) || !Number.isFinite(rule.value)) {
      throw new EngineError('RULE_TYPE_MISMATCH', op + ' requires finite numbers.');
    }
    if (op === 'gt') return found.value > rule.value;
    if (op === 'gte') return found.value >= rule.value;
    if (op === 'lt') return found.value < rule.value;
    return found.value <= rule.value;
  }

  if (op === 'in') {
    if (!Array.isArray(rule.values) || rule.values.length > 128) {
      throw new EngineError('INVALID_RULE', 'in requires at most 128 values.');
    }
    return rule.values.some((value) => jsonEqual(value, found.value));
  }

  throw new EngineError('UNSUPPORTED_RULE_OPERATOR', 'Unsupported operator: ' + op);
}

export function validateEffects(effects) {
  if (!Array.isArray(effects) || effects.length > 200) {
    throw new EngineError('INVALID_EFFECTS', 'effects must contain at most 200 entries.');
  }

  for (const effect of effects) {
    if (!effect || typeof effect !== 'object' || Array.isArray(effect)) {
      throw new EngineError('INVALID_EFFECT', 'Each effect must be an object.');
    }

    if (effect.kind === 'entity.upsert') {
      if (typeof effect.entity_id !== 'string' || !effect.entity_id.trim() || effect.entity_id.length > 200
        || typeof effect.entity_type !== 'string' || !effect.entity_type.trim()) {
        throw new EngineError('INVALID_EFFECT', 'entity.upsert requires entity_id and entity_type.');
      }
      if (effect.status !== undefined && !['active', 'inactive', 'destroyed', 'unknown'].includes(effect.status)) {
        throw new EngineError('INVALID_EFFECT', 'Unsupported entity status.');
      }
      if (effect.attributes !== undefined
        && (!effect.attributes || typeof effect.attributes !== 'object' || Array.isArray(effect.attributes))) {
        throw new EngineError('INVALID_EFFECT', 'attributes must be an object.');
      }
    } else if (effect.kind === 'entity.delete') {
      if (typeof effect.entity_id !== 'string' || !effect.entity_id.trim()) {
        throw new EngineError('INVALID_EFFECT', 'entity.delete requires entity_id.');
      }
    } else if (effect.kind === 'fact.set') {
      if (typeof effect.fact_id !== 'string' || !effect.fact_id.trim()
        || typeof effect.predicate !== 'string' || !effect.predicate.trim()
        || !Object.hasOwn(effect, 'value')) {
        throw new EngineError('INVALID_EFFECT', 'fact.set requires fact_id, predicate and value.');
      }
      if (effect.subject_ref !== undefined && effect.subject_ref !== null && typeof effect.subject_ref !== 'string') {
        throw new EngineError('INVALID_EFFECT', 'subject_ref must be a string or null.');
      }
    } else {
      throw new EngineError('UNSUPPORTED_EFFECT', 'Unsupported effect kind: ' + String(effect.kind));
    }
  }
}
