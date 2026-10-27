import { EngineError } from './errors.js';

export const SUPPORTED_RULE_OPERATORS = Object.freeze(['eq', 'neq', 'exists', 'gt', 'gte', 'lt', 'lte', 'in', 'all', 'any', 'not']);
const OPS = new Set(SUPPORTED_RULE_OPERATORS);
const UNSAFE_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

function assertPlainDataObject(value, code = 'INVALID_RULE', label = 'Rule') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new EngineError(code, label + ' must be an object.');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new EngineError(code, label + ' must be a plain data object.');
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length > 1000) throw new EngineError(code, label + ' contains too many fields.');
  for (const key of keys) {
    if (typeof key !== 'string') throw new EngineError(code, label + ' must not contain symbol keys.');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new EngineError(code, label + ' must contain only enumerable data properties.');
    }
  }
}

function assertDenseDataArray(value, maxLength, code, label) {
  if (!Array.isArray(value) || value.length > maxLength) {
    throw new EngineError(code, label + ' must be an array of at most ' + maxLength + ' items.');
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1) throw new EngineError(code, label + ' must be dense and contain no extra properties.');
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new EngineError(code, label + ' must contain only dense data items.');
    }
  }
}

function readPath(root, path) {
  if (typeof path !== 'string' || !path || path.split('.').some((key) => !key || UNSAFE_PATH_SEGMENTS.has(key))) {
    throw new EngineError('INVALID_RULE_PATH', 'Unsafe or empty rule path.');
  }

  let value = root;
  for (const key of path.split('.')) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) return { exists: false };
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      throw new EngineError('INVALID_RULE_CONTEXT', 'Rule context must not expose accessor-backed properties.');
    }
    value = descriptor.value;
  }
  return { exists: true, value };
}

// JSON object member order is not semantically meaningful; array order is.
// Accept only bounded JSON data so equality never executes getters or recurses forever.
function canonicalJson(value, state = { depth: 0, nodes: 0, ancestors: new WeakSet() }) {
  state.nodes += 1;
  if (state.nodes > 10000 || state.depth > 32) {
    throw new EngineError('INVALID_RULE_VALUE', 'Rule comparison values exceed the supported JSON complexity limit.');
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object') {
    throw new EngineError('INVALID_RULE_VALUE', 'Rule comparison values must be JSON data.');
  }
  if (state.ancestors.has(value)) {
    throw new EngineError('INVALID_RULE_VALUE', 'Rule comparison values must not contain cycles.');
  }

  state.ancestors.add(value);
  state.depth += 1;
  try {
    if (Array.isArray(value)) {
      assertDenseDataArray(value, 10000, 'INVALID_RULE_VALUE', 'Comparison array');
      return value.map((item) => canonicalJson(item, state));
    }
    assertPlainDataObject(value, 'INVALID_RULE_VALUE', 'Comparison object');
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key], state)]));
  } finally {
    state.depth -= 1;
    state.ancestors.delete(value);
  }
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
    assertDenseDataArray(rule.rules, 64, 'INVALID_RULE', op + ' rules');
    return rule.rules;
  }
  if (op === 'not' && hasLegacy) return [rule.condition];
  if (op !== 'not' && hasLegacy) {
    assertDenseDataArray(rule.conditions, 64, 'INVALID_RULE', op + ' conditions');
    return rule.conditions;
  }
  throw new EngineError('INVALID_RULE', op === 'not' ? 'not requires exactly one nested rule.' : op + ' requires a rules array.');
}

export function evaluateCondition(rule, context, depth = 0) {
  if (depth > 24) throw new EngineError('RULE_DEPTH_EXCEEDED', 'Rule nesting exceeds 24 levels.');
  assertPlainDataObject(rule, 'INVALID_RULE', 'Condition');

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
  if (op === 'in') assertDenseDataArray(rule.values, 128, 'INVALID_RULE', 'in values');

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
 *
 * The returned `status` is the condition result. `unknown_paths` is diagnostic:
 * it lists unresolved leaves visited during evaluation even when a decisive
 * sibling makes the overall status true or false (for example, all(false, unknown)
 * returns status false and still reports the unresolved path). Consumers must not
 * override a decisive status merely because this diagnostic list is non-empty.
 *
 * `knownAbsentPaths` is a trusted-caller assertion, not authenticated evidence.
 * Callers must derive it from the same consistent, authorized snapshot as context;
 * never populate it directly from model- or user-supplied claims.
 */
export function evaluateConditionResult(rule, context, options = {}) {
  assertPlainDataObject(options, 'INVALID_RULE_RESULT_OPTIONS', 'Condition result options');
  const allowedOptionKeys = new Set(['knownAbsentPaths']);
  if (Object.keys(options).some((key) => !allowedOptionKeys.has(key))) {
    throw new EngineError('INVALID_RULE_RESULT_OPTIONS', 'Condition result options contain an unsupported field.');
  }
  const rawKnownAbsent = options.knownAbsentPaths ?? [];
  assertDenseDataArray(rawKnownAbsent, 1000, 'INVALID_RULE_RESULT_OPTIONS', 'knownAbsentPaths');
  if (!rawKnownAbsent.every((path) => typeof path === 'string' && path.trim())) {
    throw new EngineError('INVALID_RULE_RESULT_OPTIONS', 'knownAbsentPaths must contain only non-empty paths.');
  }
  const knownAbsentPaths = new Set(rawKnownAbsent);
  for (const path of knownAbsentPaths) {
    const found = readPath(context, path);
    if (found.exists) {
      throw new EngineError('CONTRADICTORY_KNOWN_ABSENCE', 'A path cannot be both present in context and declared known absent.');
    }
  }

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
    if (!found.exists && knownAbsentPaths.has(current.path) && current.op === 'neq') {
      return { status: 'true' };
    }
    return { status: evaluateCondition(current, context) ? 'true' : 'false' };
  };

  const result = evaluate(rule);
  return {
    status: result.status,
    unknown_paths: [...unresolvedPaths].sort(),
  };
}

function validateEffectJson(value, label) {
  try {
    canonicalJson(value);
  } catch (error) {
    throw new EngineError('INVALID_EFFECT', label + ' must contain bounded, accessor-free JSON data.', 400, {
      cause: error?.code ?? 'INVALID_JSON_DATA',
    });
  }
}

export function validateEffects(effects, options = {}) {
  assertDenseDataArray(effects, 200, 'INVALID_EFFECTS', 'effects');
  assertPlainDataObject(options, 'INVALID_EFFECT_OPTIONS', 'Effect validation options');
  if (Object.keys(options).some((key) => key !== 'allowRelationshipTransition')) {
    throw new EngineError('INVALID_EFFECT_OPTIONS', 'Effect validation options contain an unsupported field.');
  }
  if (options.allowRelationshipTransition !== undefined && typeof options.allowRelationshipTransition !== 'boolean') {
    throw new EngineError('INVALID_EFFECT_OPTIONS', 'allowRelationshipTransition must be boolean.');
  }

  for (const effect of effects) {
    assertPlainDataObject(effect, 'INVALID_EFFECT', 'Effect');

    const allowedFields = {
      'entity.create': ['kind', 'entity_id', 'entity_type', 'status', 'attributes'],
      'entity.update': ['kind', 'entity_id', 'status', 'attributes', 'remove_attributes'],
      'entity.upsert': ['kind', 'entity_id', 'entity_type', 'status', 'attributes'],
      'entity.delete': ['kind', 'entity_id'],
      'fact.set': ['kind', 'fact_id', 'subject_ref', 'predicate', 'value'],
      'mechanic.instance.create': ['kind', 'instance_id', 'template_id', 'template_version', 'parameters', 'state'],
      'mechanic.instance.enable': ['kind', 'instance_id'],
      'mechanic.instance.disable': ['kind', 'instance_id'],
      'relationship.transition': ['kind', 'subject_id', 'target_id', 'rule_module_id', 'rule_module_version', 'patch', 'evidence_refs', 'executor_type'],
    }[effect.kind];
    if (effect.kind === 'relationship.transition' && options.allowRelationshipTransition !== true) {
      throw new EngineError('UNSUPPORTED_EFFECT', 'Relationship transitions must use the trusted Core transition operation.', 403);
    }
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
        || effect.fact_id !== effect.fact_id.trim()
        || typeof effect.predicate !== 'string' || !effect.predicate.trim()
        || effect.predicate !== effect.predicate.trim()
        || !Object.hasOwn(effect, 'value')) {
        throw new EngineError('INVALID_EFFECT', 'fact.set requires fact_id and predicate without surrounding whitespace, and value.');
      }
      if (effect.subject_ref !== undefined && effect.subject_ref !== null
        && (typeof effect.subject_ref !== 'string' || !effect.subject_ref.trim()
          || effect.subject_ref !== effect.subject_ref.trim())) {
        throw new EngineError('INVALID_EFFECT', 'subject_ref must be a non-empty string or null without surrounding whitespace.');
      }
    } else if (effect.kind === 'relationship.transition') {
      for (const key of ['subject_id', 'target_id', 'rule_module_id', 'rule_module_version']) {
        if (typeof effect[key] !== 'string' || !effect[key].trim() || effect[key].length > 200) {
          throw new EngineError('INVALID_RELATIONSHIP_TRANSITION', 'relationship.transition requires non-empty ' + key + '.', 400);
        }
      }
      if (!effect.patch || typeof effect.patch !== 'object' || Array.isArray(effect.patch) || !Object.keys(effect.patch).length || Object.keys(effect.patch).length > 128) {
        throw new EngineError('INVALID_RELATIONSHIP_TRANSITION', 'patch must be a non-empty object of at most 128 dimensions.', 400);
      }
      if (!Array.isArray(effect.evidence_refs) || !effect.evidence_refs.length || effect.evidence_refs.length > 128
        || !effect.evidence_refs.every((value) => typeof value === 'string' && value.trim() && value.length <= 200)
        || new Set(effect.evidence_refs).size !== effect.evidence_refs.length) {
        throw new EngineError('INVALID_RELATIONSHIP_TRANSITION', 'evidence_refs must contain 1–128 unique non-empty references.', 400);
      }
      if (effect.executor_type !== 'admin_credential') {
        throw new EngineError('INVALID_RELATIONSHIP_EXECUTOR', 'Relationship transition executor must be server-derived.', 403);
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

    for (const key of ['attributes', 'patch', 'parameters', 'state']) {
      if (Object.hasOwn(effect, key)) validateEffectJson(effect[key], effect.kind + '.' + key);
    }
    if (effect.kind === 'fact.set' && Object.hasOwn(effect, 'value')) {
      validateEffectJson(effect.value, 'fact.set.value');
    }
    if (effect.kind === 'relationship.transition') {
      assertDenseDataArray(effect.evidence_refs, 128, 'INVALID_RELATIONSHIP_TRANSITION', 'evidence_refs');
    }
    if (effect.kind === 'entity.update' && effect.remove_attributes !== undefined) {
      assertDenseDataArray(effect.remove_attributes, 200, 'INVALID_EFFECT', 'remove_attributes');
    }
  }
}


/**
 * Conservatively enumerate every context path that a supported declarative
 * condition can read, including paths in branches not taken by a particular
 * evaluation. This is a static potential-read set, not authorization and not a
 * claim about dependencies hidden in code outside this bounded AST.
 *
 * Returns a deterministic sorted list. Absence is still a dependency: callers
 * must invalidate when a path changes from absent to present or vice versa.
 */
export function collectConditionDependencies(rule) {
  const paths = new Set();
  const visit = (current, depth = 0) => {
    if (depth > 24) throw new EngineError('RULE_DEPTH_EXCEEDED', 'Rule nesting exceeds 24 levels.');
    assertPlainDataObject(current, 'INVALID_RULE', 'Condition');

    const op = current.op;
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
    if (Object.keys(current).some((key) => !allowed.includes(key))) {
      throw new EngineError('INVALID_RULE', 'Unexpected field for rule operator: ' + op);
    }

    if (op === 'all' || op === 'any' || op === 'not') {
      const children = nestedRules(current, op);
      if (children.length > 64) throw new EngineError('INVALID_RULE', op + ' supports at most 64 nested rules.');
      if (op === 'not' && children.length !== 1) {
        throw new EngineError('INVALID_RULE', 'not requires exactly one nested rule.');
      }
      for (const child of children) visit(child, depth + 1);
      return;
    }

    // Reuse the evaluator's path parser to enforce the same unsafe-path rules.
    if (typeof current.path !== 'string' || !current.path) {
      throw new EngineError('INVALID_RULE_PATH', 'Unsafe or empty rule path.');
    }
    readPath({}, current.path);
    if (['eq', 'neq', 'gt', 'gte', 'lt', 'lte'].includes(op) && !Object.hasOwn(current, 'value')) {
      throw new EngineError('INVALID_RULE', op + ' requires a value.');
    }
    if (['gt', 'gte', 'lt', 'lte'].includes(op)
      && (typeof current.value !== 'number' || !Number.isFinite(current.value))) {
      throw new EngineError('RULE_TYPE_MISMATCH', op + ' requires a finite numeric value.');
    }
    if (op === 'exists' && current.value !== undefined && typeof current.value !== 'boolean') {
      throw new EngineError('INVALID_RULE', 'exists value must be boolean when provided.');
    }
    if (op === 'in') assertDenseDataArray(current.values, 128, 'INVALID_RULE', 'in values');
    paths.add(current.path);
  };

  visit(rule);
  return [...paths].sort();
}
