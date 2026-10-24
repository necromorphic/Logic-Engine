import { assertTimeCoordinate } from './coordinate.js';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonNegativeInteger = (value) => Number.isSafeInteger(value) && value >= 0;

function validateRule(rule) {
  if (!object(rule)) throw new TypeError('duration rule must be an object.');
  if (rule.kind === 'fixed') {
    if (!nonNegativeInteger(rule.units)) throw new TypeError('fixed duration units must be a non-negative safe integer.');
    return;
  }
  if (rule.kind === 'range') {
    if (!nonNegativeInteger(rule.min_units) || !nonNegativeInteger(rule.max_units) || rule.max_units < rule.min_units) {
      throw new TypeError('duration range must have ordered non-negative safe-integer bounds.');
    }
    if (!['midpoint', 'author'].includes(rule.resolution)) {
      throw new TypeError('duration range resolution must be midpoint or author.');
    }
    return;
  }
  if (rule.kind === 'category_map') {
    if (!Array.isArray(rule.categories) || rule.categories.length === 0) {
      throw new TypeError('category_map must contain at least one category.');
    }
    const seen = new Set();
    for (const entry of rule.categories) {
      if (!object(entry) || typeof entry.category !== 'string' || !entry.category.trim()
        || !nonNegativeInteger(entry.units)) {
        throw new TypeError('Each duration category must have a non-empty category and non-negative safe-integer units.');
      }
      const category = entry.category.trim();
      if (seen.has(category)) throw new TypeError('Duration categories must be unique.');
      seen.add(category);
    }
    return;
  }
  throw new TypeError('Unsupported duration rule kind.');
}

/**
 * Resolves a duration without allowing a model proposal to supply arbitrary units.
 * A category proposal can only select a value already defined by the world rule.
 */
export function resolveDurationDecision(rule, proposal = null) {
  validateRule(rule);

  if (rule.kind === 'fixed') {
    return { status: 'resolved', certainty: 'fixed', units: rule.units, source: 'world_rule' };
  }

  if (rule.kind === 'range') {
    if (rule.resolution === 'author') {
      return {
        status: 'needs_author',
        certainty: 'range',
        min_units: rule.min_units,
        max_units: rule.max_units,
        source: 'world_rule',
      };
    }
    const span = rule.max_units - rule.min_units;
    const units = rule.min_units + Math.floor(span / 2);
    assertTimeCoordinate(units, 'resolved duration');
    return {
      status: 'resolved',
      certainty: 'range',
      units,
      min_units: rule.min_units,
      max_units: rule.max_units,
      source: 'world_rule_midpoint',
    };
  }

  if (proposal === null || proposal === undefined) {
    return { status: 'needs_author', certainty: 'unknown', reason: 'CATEGORY_PROPOSAL_REQUIRED' };
  }
  if (!object(proposal) || Object.keys(proposal).some((key) => key !== 'category')
    || typeof proposal.category !== 'string' || !proposal.category.trim()) {
    return { status: 'rejected', certainty: 'unknown', reason: 'INVALID_CATEGORY_PROPOSAL' };
  }
  const selected = rule.categories.find((entry) => entry.category.trim() === proposal.category.trim());
  if (!selected) {
    return { status: 'rejected', certainty: 'unknown', reason: 'CATEGORY_NOT_ALLOWED' };
  }
  return {
    status: 'resolved',
    certainty: 'fixed',
    units: selected.units,
    category: selected.category.trim(),
    source: 'world_rule_category',
  };
}
