import { EngineError } from './errors.js';
import { SUPPORTED_RULE_OPERATORS, collectConditionDependencies } from './rules.js';

const obj = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,127}$/;
const versionPattern = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/;
const capabilityPattern = /^[a-z][a-z0-9_.-]{0,63}$/;
const typeIdPattern = /^[a-zA-Z][a-zA-Z0-9_.-]{0,95}$/;
const ruleOps = new Set(SUPPORTED_RULE_OPERATORS);
const effectKinds = new Set([
  'create_entity', 'update_attribute', 'create_relation', 'retract_relation',
  'assert_fact', 'retract_fact', 'propose_knowledge', 'reconcile_knowledge',
  'start_process', 'advance_process', 'cancel_process', 'create_task', 'update_task',
  'create_goal', 'update_goal', 'emit_event', 'request_adjudication', 'needs_review',
]);
const templateKeys = new Set([
  'template_id', 'version', 'schema_version', 'display_name', 'description',
  'required_capabilities', 'applicability', 'eligible_participants', 'actions',
  'interactions', 'conflict_policy', 'lifecycle_policy', 'unknown_policy',
  'rule_modules', 'metadata',
]);
const moduleKeys = new Set([
  'module_id', 'version', 'contract_version', 'capabilities', 'operations',
  'input_schema', 'output_schema', 'failure_policy', 'compatibility', 'metadata',
]);

function fail(code, message) { throw new EngineError(code, message, 400); }
function assertObject(value, label) {
  if (!obj(value)) fail('INVALID_MECHANIC_CONTRACT', label + ' must be an object.');
}
function checkKeys(value, allowed, label) {
  const extra = Object.keys(value).filter((key) => !allowed.has(key));
  if (extra.length) fail('INVALID_MECHANIC_CONTRACT', label + ' has unsupported field(s): ' + extra.join(', '));
}
function required(value, keys, label) {
  const missing = keys.filter((key) => !Object.hasOwn(value, key));
  if (missing.length) fail('INVALID_MECHANIC_CONTRACT', label + ' is missing required field(s): ' + missing.join(', '));
}
function text(value, label, max = 4000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail('INVALID_MECHANIC_CONTRACT', label + ' must be a non-empty string of at most ' + max + ' characters.');
}
function id(value, label) {
  if (typeof value !== 'string' || !idPattern.test(value)) fail('INVALID_MECHANIC_CONTRACT', label + ' has an invalid identifier.');
}
function version(value, label) {
  if (typeof value !== 'string' || !versionPattern.test(value)) fail('INVALID_MECHANIC_CONTRACT', label + ' must be a version string.');
}
function stringArray(value, label, pattern = null, max = 128) {
  if (!Array.isArray(value) || value.length > max) fail('INVALID_MECHANIC_CONTRACT', label + ' must be an array of at most ' + max + ' strings.');
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim() || (pattern && !pattern.test(item))) fail('INVALID_MECHANIC_CONTRACT', label + ' contains an invalid string.');
    if (seen.has(item)) fail('INVALID_MECHANIC_CONTRACT', label + ' must not contain duplicates.');
    seen.add(item);
  }
}
function boundedArray(value, label, max = 128) {
  if (!Array.isArray(value) || value.length > max) fail('INVALID_MECHANIC_CONTRACT', label + ' must be an array of at most ' + max + ' items.');
}
function validateRule(rule, label, depth = 0) {
  if (depth > 24) fail('INVALID_MECHANIC_CONTRACT', label + ' exceeds the maximum rule nesting depth.');
  assertObject(rule, label);
  checkKeys(rule, new Set(['op', 'path', 'value', 'values', 'rules']), label);
  if (!ruleOps.has(rule.op)) fail('INVALID_MECHANIC_CONTRACT', label + ' uses an unsupported rule operator.');
  const need = (...keys) => required(rule, keys, label);
  if (['eq', 'neq', 'gt', 'gte', 'lt', 'lte'].includes(rule.op)) {
    need('path', 'value'); text(rule.path, label + '.path', 256);
    if (['gt', 'gte', 'lt', 'lte'].includes(rule.op) && (typeof rule.value !== 'number' || !Number.isFinite(rule.value))) fail('INVALID_MECHANIC_CONTRACT', label + ' numeric comparison requires a finite number.');
  } else if (rule.op === 'in') {
    need('path', 'values'); text(rule.path, label + '.path', 256);
    if (!Array.isArray(rule.values) || rule.values.length > 128) fail('INVALID_MECHANIC_CONTRACT', label + '.values must be an array of at most 128 items.');
  } else if (rule.op === 'exists') {
    need('path'); text(rule.path, label + '.path', 256);
    if (rule.value !== undefined && typeof rule.value !== 'boolean') fail('INVALID_MECHANIC_CONTRACT', label + '.value must be boolean when provided for exists.');
  } else if (rule.op === 'all' || rule.op === 'any' || rule.op === 'not') {
    need('rules');
    const max = rule.op === 'not' ? 1 : 64;
    if (!Array.isArray(rule.rules) || rule.rules.length < (rule.op === 'not' ? 1 : 0) || rule.rules.length > max) fail('INVALID_MECHANIC_CONTRACT', label + '.rules has an invalid size.');
    rule.rules.forEach((child, index) => validateRule(child, label + '.rules[' + index + ']', depth + 1));
  }
}
function validateEffectIntent(effect, label) {
  assertObject(effect, label);
  checkKeys(effect, new Set(['effect_id', 'kind', 'target_ref', 'payload', 'source_refs', 'caused_by']), label);
  required(effect, ['effect_id', 'kind', 'target_ref'], label);
  text(effect.effect_id, label + '.effect_id', 128);
  if (!effectKinds.has(effect.kind)) fail('INVALID_MECHANIC_CONTRACT', label + '.kind is unsupported.');
  text(effect.target_ref, label + '.target_ref', 256);
  if (effect.payload !== undefined) assertObject(effect.payload, label + '.payload');
  for (const key of ['source_refs', 'caused_by']) if (effect[key] !== undefined) stringArray(effect[key], label + '.' + key);
}
function validateRuleArray(value, label, max = 128) {
  boundedArray(value, label, max);
  value.forEach((rule, index) => validateRule(rule, label + '[' + index + ']'));
}

export function validateMechanicTemplate(value) {
  assertObject(value, 'Mechanic template');
  checkKeys(value, templateKeys, 'Mechanic template');
  required(value, ['template_id', 'version', 'schema_version', 'display_name', 'required_capabilities', 'applicability', 'actions', 'conflict_policy', 'lifecycle_policy', 'unknown_policy'], 'Mechanic template');
  id(value.template_id, 'template_id');
  version(value.version, 'version');
  text(value.schema_version, 'schema_version', 64);
  text(value.display_name, 'display_name', 160);
  if (value.description !== undefined && (typeof value.description !== 'string' || value.description.length > 4000)) fail('INVALID_MECHANIC_CONTRACT', 'description must be a string of at most 4000 characters.');
  stringArray(value.required_capabilities, 'required_capabilities', capabilityPattern);
  validateRuleArray(value.applicability, 'applicability');
  if (value.eligible_participants !== undefined) {
    boundedArray(value.eligible_participants, 'eligible_participants');
    value.eligible_participants.forEach((item, index) => {
      const label = 'eligible_participants[' + index + ']';
      assertObject(item, label);
      checkKeys(item, new Set(['role_id', 'description', 'constraints']), label);
      required(item, ['role_id'], label);
      if (typeof item.role_id !== 'string' || !typeIdPattern.test(item.role_id)) fail('INVALID_MECHANIC_CONTRACT', label + '.role_id is invalid.');
      if (item.description !== undefined && (typeof item.description !== 'string' || item.description.length > 1000)) fail('INVALID_MECHANIC_CONTRACT', label + '.description is too long.');
      if (item.constraints !== undefined) validateRuleArray(item.constraints, label + '.constraints');
    });
  }
  boundedArray(value.actions, 'actions', 256);
  const actionIds = new Set();
  value.actions.forEach((action, index) => {
    const label = 'actions[' + index + ']';
    assertObject(action, label);
    checkKeys(action, new Set(['action_id', 'input_schema', 'preconditions', 'constraints', 'effects', 'ambiguity_policy']), label);
    required(action, ['action_id', 'input_schema', 'preconditions', 'effects', 'ambiguity_policy'], label);
    if (typeof action.action_id !== 'string' || !typeIdPattern.test(action.action_id)) fail('INVALID_MECHANIC_CONTRACT', label + '.action_id is invalid.');
    if (actionIds.has(action.action_id)) fail('INVALID_MECHANIC_CONTRACT', 'action_id values must be unique.');
    actionIds.add(action.action_id);
    assertObject(action.input_schema, label + '.input_schema');
    validateRuleArray(action.preconditions, label + '.preconditions');
    if (action.constraints !== undefined) validateRuleArray(action.constraints, label + '.constraints');
    boundedArray(action.effects, label + '.effects');
    action.effects.forEach((effect, effectIndex) => validateEffectIntent(effect, label + '.effects[' + effectIndex + ']'));
    if (!['deterministic_only', 'model_proposal_then_validate', 'author_adjudication', 'unsupported'].includes(action.ambiguity_policy)) fail('INVALID_MECHANIC_CONTRACT', label + '.ambiguity_policy is invalid.');
  });
  if (value.interactions !== undefined) {
    boundedArray(value.interactions, 'interactions', 256);
    value.interactions.forEach((item, index) => {
      const label = 'interactions[' + index + ']';
      assertObject(item, label);
      checkKeys(item, new Set(['interaction_id', 'other_template_id', 'other_version', 'policy', 'conditions']), label);
      required(item, ['interaction_id', 'other_template_id', 'policy'], label);
      if (typeof item.interaction_id !== 'string' || !typeIdPattern.test(item.interaction_id)) fail('INVALID_MECHANIC_CONTRACT', label + '.interaction_id is invalid.');
      id(item.other_template_id, label + '.other_template_id');
      if (item.other_version !== undefined) version(item.other_version, label + '.other_version');
      if (!['compatible', 'conflicts', 'requires', 'excludes', 'manual_review'].includes(item.policy)) fail('INVALID_MECHANIC_CONTRACT', label + '.policy is invalid.');
      if (item.conditions !== undefined) validateRuleArray(item.conditions, label + '.conditions');
    });
  }
  assertObject(value.conflict_policy, 'conflict_policy');
  if (value.conflict_policy.mode === 'automatic') {
    checkKeys(value.conflict_policy, new Set(['mode', 'resolver_module_id', 'resolver_module_version', 'requires_capabilities']), 'conflict_policy');
    required(value.conflict_policy, ['mode', 'resolver_module_id', 'resolver_module_version'], 'conflict_policy');
    id(value.conflict_policy.resolver_module_id, 'conflict_policy.resolver_module_id');
    version(value.conflict_policy.resolver_module_version, 'conflict_policy.resolver_module_version');
    if (value.conflict_policy.requires_capabilities !== undefined) stringArray(value.conflict_policy.requires_capabilities, 'conflict_policy.requires_capabilities');
  } else if (value.conflict_policy.mode === 'manual') {
    checkKeys(value.conflict_policy, new Set(['mode']), 'conflict_policy');
    required(value.conflict_policy, ['mode'], 'conflict_policy');
  } else fail('INVALID_MECHANIC_CONTRACT', 'conflict_policy.mode must be automatic or manual.');
  assertObject(value.lifecycle_policy, 'lifecycle_policy');
  checkKeys(value.lifecycle_policy, new Set(['on_disable']), 'lifecycle_policy');
  required(value.lifecycle_policy, ['on_disable'], 'lifecycle_policy');
  if (!['continue_pinned_version', 'pause_blocked', 'archive', 'require_author_decision'].includes(value.lifecycle_policy.on_disable)) fail('INVALID_MECHANIC_CONTRACT', 'lifecycle_policy.on_disable is invalid.');
  if (!['mark_unknown', 'block', 'needs_review', 'author_adjudication'].includes(value.unknown_policy)) fail('INVALID_MECHANIC_CONTRACT', 'unknown_policy is invalid.');
  if (value.rule_modules !== undefined) {
    boundedArray(value.rule_modules, 'rule_modules');
    const seen = new Set();
    value.rule_modules.forEach((item, index) => {
      const label = 'rule_modules[' + index + ']';
      assertObject(item, label);
      checkKeys(item, new Set(['module_id', 'version', 'required_capabilities']), label);
      required(item, ['module_id', 'version', 'required_capabilities'], label);
      id(item.module_id, label + '.module_id'); version(item.version, label + '.version');
      stringArray(item.required_capabilities, label + '.required_capabilities', capabilityPattern);
      const key = item.module_id + '@' + item.version;
      if (seen.has(key)) fail('INVALID_MECHANIC_CONTRACT', 'rule_modules must not contain duplicate module versions.');
      seen.add(key);
    });
  }
  if (value.metadata !== undefined) assertObject(value.metadata, 'metadata');
  return value;
}

export function validateRuleModuleManifest(value) {
  assertObject(value, 'Rule module manifest');
  checkKeys(value, moduleKeys, 'Rule module manifest');
  required(value, ['module_id', 'version', 'contract_version', 'capabilities', 'operations', 'input_schema', 'output_schema', 'failure_policy', 'compatibility'], 'Rule module manifest');
  id(value.module_id, 'module_id');
  version(value.version, 'version');
  text(value.contract_version, 'contract_version', 64);
  stringArray(value.capabilities, 'capabilities', capabilityPattern);
  const operations = ['propose_effects', 'evaluate_predicate', 'resolve_conflict', 'validate_transition'];
  stringArray(value.operations, 'operations', null, 16);
  if (!value.operations.length || value.operations.some((operation) => !operations.includes(operation))) fail('INVALID_MECHANIC_CONTRACT', 'operations contains an unsupported operation.');
  assertObject(value.input_schema, 'input_schema');
  assertObject(value.output_schema, 'output_schema');
  if (!['fail_closed', 'mark_unknown', 'needs_review'].includes(value.failure_policy)) fail('INVALID_MECHANIC_CONTRACT', 'failure_policy is invalid.');
  assertObject(value.compatibility, 'compatibility');
  checkKeys(value.compatibility, new Set(['core_contract_versions', 'required_capabilities']), 'compatibility');
  required(value.compatibility, ['core_contract_versions'], 'compatibility');
  stringArray(value.compatibility.core_contract_versions, 'compatibility.core_contract_versions', null, 64);
  if (!value.compatibility.core_contract_versions.length) fail('INVALID_MECHANIC_CONTRACT', 'compatibility.core_contract_versions cannot be empty.');
  if (value.compatibility.required_capabilities !== undefined) stringArray(value.compatibility.required_capabilities, 'compatibility.required_capabilities', capabilityPattern);
  if (value.metadata !== undefined) assertObject(value.metadata, 'metadata');
  return value;
}


/**
 * Collect potential reads from every declarative condition in a validated
 * mechanic template. This is intentionally explicit about its boundary:
 * effect-intent payload binding and executable module inputs are not yet
 * specified as dependency-bearing semantics, so the returned condition set
 * must not be used as a proof of complete mechanic dependencies.
 */
export function collectMechanicConditionDependencies(value) {
  const template = validateMechanicTemplate(value);
  const paths = new Set();
  const addRules = (rules = []) => {
    for (const rule of rules) {
      for (const path of collectConditionDependencies(rule)) paths.add(path);
    }
  };

  addRules(template.applicability);
  for (const participant of template.eligible_participants ?? []) addRules(participant.constraints);
  for (const action of template.actions) {
    addRules(action.preconditions);
    addRules(action.constraints);
  }
  for (const interaction of template.interactions ?? []) addRules(interaction.conditions);

  return {
    condition_paths: [...paths].sort(),
    condition_dependencies_complete: true,
    mechanic_dependencies_complete: false,
    unresolved_sources: ['effect-intent payload binding', 'registered module inputs and reads'],
  };
}
