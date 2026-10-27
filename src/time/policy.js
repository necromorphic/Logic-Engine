import { TemporalModelError } from './model.js';

const obj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const fail = (code, message) => { throw new TemporalModelError(code, message); };
const str = (v, name) => {
  if (typeof v !== 'string' || !v.trim() || v.trim().length > 200) fail('INVALID_TIME_POLICY', name + ' must be a non-empty string.');
  return v.trim();
};
const integer = (v, name, positive = false) => {
  if (!Number.isSafeInteger(v) || v < (positive ? 1 : 0)) fail('INVALID_TIME_POLICY', name + ' must be a safe integer in range.');
  return v;
};
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function assertPlainDataRecord(value, allowed, name) {
  if (!obj(value)) fail('INVALID_TIME_POLICY', name + ' must be an object.');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail('INVALID_TIME_POLICY', name + ' must be a plain data object.');
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.includes(key)) {
      fail('INVALID_TIME_POLICY', name + ' contains an unsupported field.');
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      fail('INVALID_TIME_POLICY', name + ' fields must be own enumerable data properties.');
    }
    if (descriptor.value === undefined) {
      fail('INVALID_TIME_POLICY', name + ' fields must not be explicitly undefined.');
    }
  }
}

function denseArrayValues(value, name, max) {
  if (!Array.isArray(value) || value.length > max || Object.getPrototypeOf(value) !== Array.prototype) {
    fail('INVALID_TIME_POLICY', name + ' must be a plain array with at most ' + max + ' entries.');
  }
  const values = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      fail('INVALID_TIME_POLICY', name + ' cannot contain sparse entries.');
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      fail('INVALID_TIME_POLICY', name + ' entries must be own enumerable data properties.');
    }
    values.push(descriptor.value);
  }
  const allowedKeys = new Set(['length', ...values.map((_, index) => String(index))]);
  if (Reflect.ownKeys(value).some((key) => typeof key !== 'string' || !allowedKeys.has(key))) {
    fail('INVALID_TIME_POLICY', name + ' cannot contain extra array properties.');
  }
  return values;
}

const exactKeys = (value, allowed, name) => {
  assertPlainDataRecord(value, allowed, name);
};

function ruleOf(input, limit) {
  const allowedByKind = {
    fixed: ['kind', 'duration_ms'],
    range: ['kind', 'min_duration_ms', 'max_duration_ms', 'resolution'],
    category_map: ['kind', 'categories'],
  };
  assertPlainDataRecord(input, ['kind', 'duration_ms', 'min_duration_ms', 'max_duration_ms', 'resolution', 'categories'], 'Duration rule');
  if (!allowedByKind[input.kind]) fail('INVALID_TIME_POLICY', 'Unsupported duration rule kind.');
  exactKeys(input, allowedByKind[input.kind], input.kind + ' duration rule');
  if (input.kind === 'fixed') {
    const duration_ms = integer(input.duration_ms, 'duration_ms');
    if (duration_ms > limit) fail('INVALID_TIME_POLICY', 'Fixed duration exceeds policy limit.');
    return { kind: 'fixed', duration_ms };
  }
  if (input.kind === 'range') {
    const min_duration_ms = integer(input.min_duration_ms, 'min_duration_ms');
    const max_duration_ms = integer(input.max_duration_ms, 'max_duration_ms');
    if (max_duration_ms < min_duration_ms || max_duration_ms > limit) fail('INVALID_TIME_POLICY', 'Duration range is outside policy limits.');
    if (!['midpoint', 'author'].includes(input.resolution)) fail('INVALID_TIME_POLICY', 'Range resolution must be midpoint or author.');
    return { kind: 'range', min_duration_ms, max_duration_ms, resolution: input.resolution };
  }
  if (input.kind === 'category_map') {
    const categoryEntries = denseArrayValues(input.categories, 'categories', 1000);
    if (!categoryEntries.length) fail('INVALID_TIME_POLICY', 'category_map requires categories.');
    const seen = new Set();
    const categories = categoryEntries.map((entry) => {
      exactKeys(entry, ['category', 'duration_ms'], 'Duration category');
      const category = str(entry.category, 'category');
      const duration_ms = integer(entry.duration_ms, 'category duration_ms');
      if (duration_ms > limit || seen.has(category)) fail('INVALID_TIME_POLICY', 'Duration categories must be unique and within policy limits.');
      seen.add(category);
      return { category, duration_ms };
    }).sort((a, b) => compareText(a.category, b.category));
    return { kind: 'category_map', categories };
  }
}

export function createTimePolicy(input) {
  const allowed = ['policy_id', 'version', 'max_action_duration_ms', 'max_skip_duration_ms', 'duration_rules'];
  assertPlainDataRecord(input, allowed, 'Time policy');
  const policy_id = str(input.policy_id, 'policy_id');
  const version = str(input.version, 'version');
  const max_action_duration_ms = integer(input.max_action_duration_ms, 'max_action_duration_ms', true);
  const max_skip_duration_ms = integer(input.max_skip_duration_ms, 'max_skip_duration_ms', true);
  if (max_action_duration_ms % 1000 || max_skip_duration_ms % 1000) {
    fail('INVALID_TIME_POLICY', 'Current runtime durations must be whole seconds.');
  }
  const ruleEntries = denseArrayValues(input.duration_rules, 'duration_rules', 1000);
  const seen = new Set();
  const duration_rules = ruleEntries.map((entry) => {
    assertPlainDataRecord(entry, ['event_type', 'rule'], 'Duration rule entry');
    const event_type = str(entry.event_type, 'event_type');
    if (seen.has(event_type)) fail('INVALID_TIME_POLICY', 'event_type duration rules must be unique.');
    seen.add(event_type);
    return { event_type, rule: ruleOf(entry.rule, max_action_duration_ms) };
  }).sort((a, b) => compareText(a.event_type, b.event_type));
  return { policy_id, version, max_action_duration_ms, max_skip_duration_ms, duration_rules };
}

export function resolveDurationDecision(policyInput, eventType, proposal = null, requestedDurationMs = 0, options = {}) {
  const policy = createTimePolicy(policyInput);
  // Preserve the existing null sentinel behavior while validating numeric claims
  // regardless of which duration-rule branch will resolve the event.
  if (requestedDurationMs !== null) integer(requestedDurationMs, 'requestedDurationMs');
  const rule = policy.duration_rules.find((entry) => entry.event_type === str(eventType, 'event_type'))?.rule;
  if (!rule) {
    if (requestedDurationMs === 0 && proposal == null) return { status: 'resolved', certainty: 'fixed', duration_ms: 0, source: 'implicit_zero', policy_id: policy.policy_id, policy_version: policy.version };
    return { status: 'rejected', reason: 'DURATION_RULE_MISSING', policy_id: policy.policy_id, policy_version: policy.version };
  }
  if (rule.kind === 'fixed') {
    if (proposal != null) return { status: 'rejected', reason: 'UNEXPECTED_DURATION_PROPOSAL' };
    return { status: 'resolved', certainty: 'fixed', duration_ms: rule.duration_ms, source: 'world_rule', policy_id: policy.policy_id, policy_version: policy.version };
  }
  if (rule.kind === 'range') {
    if (rule.resolution === 'author') {
      if (proposal == null) {
        return { status: 'needs_author', min_duration_ms: rule.min_duration_ms, max_duration_ms: rule.max_duration_ms, policy_id: policy.policy_id, policy_version: policy.version };
      }
      if (!obj(proposal) || Object.keys(proposal).length !== 1 || !Object.hasOwn(proposal, 'duration_ms')
        || !Number.isSafeInteger(proposal.duration_ms)) {
        return { status: 'rejected', reason: 'INVALID_AUTHOR_DURATION_PROPOSAL', policy_id: policy.policy_id, policy_version: policy.version };
      }
      if (proposal.duration_ms < rule.min_duration_ms || proposal.duration_ms > rule.max_duration_ms) {
        return { status: 'rejected', reason: 'AUTHOR_DURATION_OUT_OF_RANGE', min_duration_ms: rule.min_duration_ms, max_duration_ms: rule.max_duration_ms, proposed_duration_ms: proposal.duration_ms, policy_id: policy.policy_id, policy_version: policy.version };
      }
      if (options.authorApproved !== true) {
        return { status: 'needs_author', min_duration_ms: rule.min_duration_ms, max_duration_ms: rule.max_duration_ms, proposed_duration_ms: proposal.duration_ms, policy_id: policy.policy_id, policy_version: policy.version };
      }
      return {
        status: 'resolved', certainty: 'author', duration_ms: proposal.duration_ms,
        min_duration_ms: rule.min_duration_ms, max_duration_ms: rule.max_duration_ms,
        source: 'author_approved_range', policy_id: policy.policy_id, policy_version: policy.version,
      };
    }
    return { status: 'resolved', certainty: 'range', duration_ms: rule.min_duration_ms + Math.floor((rule.max_duration_ms - rule.min_duration_ms) / 2), min_duration_ms: rule.min_duration_ms, max_duration_ms: rule.max_duration_ms, source: 'world_rule_midpoint', policy_id: policy.policy_id, policy_version: policy.version };
  }
  if (proposal == null) return { status: 'needs_author', reason: 'CATEGORY_PROPOSAL_REQUIRED', policy_id: policy.policy_id, policy_version: policy.version };
  if (!obj(proposal) || Object.keys(proposal).some((key) => key !== 'category') || typeof proposal.category !== 'string') return { status: 'rejected', reason: 'INVALID_CATEGORY_PROPOSAL' };
  const selected = rule.categories.find((entry) => entry.category === proposal.category.trim());
  if (!selected) return { status: 'rejected', reason: 'CATEGORY_NOT_ALLOWED', policy_id: policy.policy_id, policy_version: policy.version };
  return { status: 'resolved', certainty: 'fixed', duration_ms: selected.duration_ms, category: selected.category, source: 'world_rule_category', policy_id: policy.policy_id, policy_version: policy.version };
}
