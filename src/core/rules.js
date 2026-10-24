import { EngineError } from './errors.js';

export const SUPPORTED_RULE_OPERATORS = Object.freeze(['eq', 'neq', 'exists', 'gt', 'gte', 'lt', 'lte', 'in', 'all', 'any', 'not']);
const OPS = new Set(SUPPORTED_RULE_OPERATORS);
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

  const allowed = {
    eq: ['op', 'path', 'value'], neq: ['op', 'path', 'value'],
    exists: ['op', 'path', 'value'],
    gt: ['op', 'path', 'value'], gte: ['op', 'path', 'value'],
    lt: ['op', 'path', 'value'], lte: ['op', 'path', 'value'],
    in: ['op', 'path', 'values'],
    all: ['op', 'rules', 'conditions'], any: ['op', 'rules', 'conditions'],
    not: ['op', 'rules', 'condition'],
  }[op];
  if (Object.keys(rule).some((key) => !allowed.includes(key))) {
    throw new EngineError('INVALID_RULE', 'Unexpected field for rule operator: ' + op);
  }

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

  if (['eq', 'neq', 'gt', 'gte', 'lt', 'lte'].includes(op) && !Object.hasOwn(rule, 'value')) {
    throw new EngineError('INVALID_RULE', op + ' requires a value.');
  }
  if (['gt', 'gte', 'lt', 'lte'].includes(op)
    && (typeof rule.value !== 'number' || !Number.isFinite(rule.value))) {
    throw new EngineError('RULE_TYPE_MISMATCH', op + ' requires a finite numeric value.');
  }
  if (op === 'exists' && rule.value !== undefined && typeof rule.value !== 'boolean') {
    throw new EngineError('INVALID_RULE', 'exists value must be boolean when provided.');
  }
  if (op === 'in' && (!Array.isArray(rule.values) || rule.values.length > 128)) {
    throw new EngineError('INVALID_RULE', 'in requires at most 128 values.');
  }

  const found = readPath(context, rule.path);
  if (op === 'exists') return found.exists === (rule.value ?? true);
  if (!found.exists) return false;
  if (op === 'eq') return jsonEqual(found.value, rule.value);
  if (op === 'neq') return !jsonEqual(found.value, rule.value);

  if (['gt', 'gte', 'lt', 'lte'].includes(op)) {
    if (typeof found.value !== 'number' || !Number.isFinite(found.value)) {
      throw new EngineError('RULE_TYPE_MISMATCH', op + ' requires the context value to be a finite number.');
    }
    if (op === 'gt') return found.value > rule.value;
    if (op === 'gte') return found.value >= rule.value;
    if (op === 'lt') return found.value < rule.value;
    return found.value <= rule.value;
  }

  if (op === 'in') return rule.values.some((value) => jsonEqual(value, found.value));

  throw new EngineError('UNSUPPORTED_RULE_OPERATOR', 'Unsupported operator: ' + op);
}


/**
 * Evaluate a declarative condition without collapsing unavailable context into false.
 *
 * The legacy evaluateCondition API intentionally retains its Boolean behavior for
 * existing callers. This result API treats a missing path as unknown unless the
 * caller explicitly proves that path is absent in the evaluation snapshot.
 */
export function evaluateConditionResult(rule, context, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new EngineError('INVALID_RULE_RESULT_OPTIONS', 'Condition result options must be an object.');
  }
  const allowedOptionKeys = new Set(['knownAbsentPaths']);
  if (Object.keys(options).some((key) => !allowedOptionKeys.has(key))) {
    throw new EngineError('INVALID_RULE_RESULT_OPTIONS', 'Condition result options contain an unsupported field.');
  }
  const rawKnownAbsent = options.knownAbsentPaths ?? [];
  if (!Array.isArray(rawKnownAbsent) || rawKnownAbsent.length > 1000
    || !rawKnownAbsent.every((path) => typeof path === 'string' && path.trim())) {
    throw new EngineError('INVALID_RULE_RESULT_OPTIONS', 'knownAbsentPaths must be an array of at most 1000 non-empty paths.');
  }
  const knownAbsentPaths = new Set(rawKnownAbsent);
  for (const path of knownAbsentPaths) readPath({}, path);

  // Validate the complete rule tree and preserve existing type/error behavior.
  // The returned Boolean is deliberately not trusted for missing context.
  evaluateCondition(rule, context);

  const unresolvedPaths = new Set();
  const evaluate = (current, depth = 0) => {
    if (depth > 24) throw new EngineError('RULE_DEPTH_EXCEEDED', 'Rule nesting exceeds 24 levels.');
    if (current.op === 'all' || current.op === 'any') {
      const children = nestedRules(current, current.op).map((child) => evaluate(child, depth + 1));
      if (current.op === 'all') {
        if (children.some((child) => child.status === 'false')) return { status: 'false' };
        if (children.some((child) => child.status === 'unknown')) return { status: 'unknown' };
        return { status: 'true' };
      }
      if (children.some((child) => child.status === 'true')) return { status: 'true' };
      if (children.some((child) => child.status === 'unknown')) return { status: 'unknown' };
      return { status: 'false' };
    }
    if (current.op === 'not') {
      const child = evaluate(nestedRules(current, 'not')[0], depth + 1);
      if (child.status === 'unknown') return child;
      return { status: child.status === 'true' ? 'false' : 'true' };
    }

    const found = readPath(context, current.path);
    if (!found.exists && !knownAbsentPaths.has(current.path)) {
      unresolvedPaths.add(current.path);
      return { status: 'unknown' };
    }
    return { status: evaluateCondition(current, context) ? 'true' : 'false' };
  };

  const result = evaluate(rule);
  return {
    status: result.status,
    unknown_paths: [...unresolvedPaths].sort(),
  };
}

export function validateEffects(effects) {
  if (!Array.isArray(effects) || effects.length > 200) {
    throw new EngineError('INVALID_EFFECTS', 'effects must contain at most 200 entries.');
  }

  for (const effect of effects) {
    if (!effect || typeof effect !== 'object' || Array.isArray(effect)) {
      throw new EngineError('INVALID_EFFECT', 'Each effect must be an object.');
    }

    const allowedFields = {
      'entity.create': ['kind', 'entity_id', 'entity_type', 'status', 'attributes'],
      'entity.update': ['kind', 'entity_id', 'status', 'attributes', 'remove_attributes'],
      'entity.upsert': ['kind', 'entity_id', 'entity_type', 'status', 'attributes'],
      'entity.delete': ['kind', 'entity_id'],
      'fact.set': ['kind', 'fact_id', 'subject_ref', 'predicate', 'value'],
      'mechanic.instance.create': ['kind', 'instance_id', 'template_id', 'template_version', 'parameters', 'state'],
      'mechanic.instance.enable': ['kind', 'instance_id'],
      'mechanic.instance.disable': ['kind', 'instance_id'],
    }[effect.kind];
    if (allowedFields && Object.keys(effect).some((key) => !allowedFields.includes(key))) {
      throw new EngineError('UNSUPPORTED_EFFECT_FIELD', 'Effect contains a field not supported by its kind: ' + effect.kind, 400, { kind: effect.kind });
    }

    if (effect.kind === 'entity.create') {
      if (typeof effect.entity_id !== 'string' || !effect.entity_id.trim() || effect.entity_id.length > 200
        || typeof effect.entity_type !== 'string' || !effect.entity_type.trim()) {
        throw new EngineError('INVALID_EFFECT', 'entity.create requires entity_id and entity_type.');
      }
      if (effect.status !== undefined && !['active', 'inactive', 'destroyed', 'unknown'].includes(effect.status)) {
        throw new EngineError('INVALID_EFFECT', 'Unsupported entity status.');
      }
      if (effect.attributes !== undefined && (!effect.attributes || typeof effect.attributes !== 'object' || Array.isArray(effect.attributes))) {
        throw new EngineError('INVALID_EFFECT', 'attributes must be an object.');
      }
    } else if (effect.kind === 'entity.update') {
      if (typeof effect.entity_id !== 'string' || !effect.entity_id.trim() || effect.entity_id.length > 200) {
        throw new EngineError('INVALID_EFFECT', 'entity.update requires entity_id.');
      }
      if (effect.status !== undefined && !['active', 'inactive', 'destroyed', 'unknown'].includes(effect.status)) {
        throw new EngineError('INVALID_EFFECT', 'Unsupported entity status.');
      }
      if (effect.attributes !== undefined && (!effect.attributes || typeof effect.attributes !== 'object' || Array.isArray(effect.attributes))) {
        throw new EngineError('INVALID_EFFECT', 'attributes must be an object patch.');
      }
      if (effect.remove_attributes !== undefined && (!Array.isArray(effect.remove_attributes) || effect.remove_attributes.length > 200 || !effect.remove_attributes.every((key) => typeof key === 'string' && key.trim() && key.length <= 200))) {
        throw new EngineError('INVALID_EFFECT', 'remove_attributes must be an array of non-empty attribute names.');
      }
    } else if (effect.kind === 'entity.upsert') {
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
    } else if (effect.kind === 'mechanic.instance.create') {
      for (const key of ['instance_id', 'template_id', 'template_version']) {
        if (typeof effect[key] !== 'string' || !effect[key].trim() || effect[key].length > 200) throw new EngineError('INVALID_MECHANIC_INSTANCE_EFFECT', 'mechanic.instance.create requires non-empty ' + key + ' of at most 200 characters.');
        if (key === 'instance_id' && /^(entity:|fact:)/.test(effect[key])) throw new EngineError('INVALID_MECHANIC_INSTANCE_EFFECT', 'instance_id must not use the reserved entity: or fact: namespace.');
      }
      for (const key of ['parameters', 'state']) if (effect[key] !== undefined && (!effect[key] || typeof effect[key] !== 'object' || Array.isArray(effect[key]))) throw new EngineError('INVALID_MECHANIC_INSTANCE_EFFECT', key + ' must be a JSON object.');
    } else if (effect.kind === 'mechanic.instance.enable' || effect.kind === 'mechanic.instance.disable') {
      if (typeof effect.instance_id !== 'string' || !effect.instance_id.trim() || effect.instance_id.length > 200) throw new EngineError('INVALID_MECHANIC_INSTANCE_EFFECT', effect.kind + ' requires a non-empty instance_id of at most 200 characters.');
    } else {
      throw new EngineError('UNSUPPORTED_EFFECT', 'Unsupported effect kind: ' + String(effect.kind));
    }
  }
}
