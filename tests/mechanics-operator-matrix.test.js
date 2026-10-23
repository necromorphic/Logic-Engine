import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateCondition, SUPPORTED_RULE_OPERATORS } from '../src/core/rules.js';
import { validateMechanicTemplate } from '../src/core/mechanics.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function templateWithRule(rule) {
  return {
    template_id: 'test.mechanic',
    version: '1.0.0',
    schema_version: 'core-1',
    display_name: 'Operator support fixture',
    required_capabilities: [],
    applicability: [rule],
    actions: [],
    conflict_policy: { mode: 'manual' },
    lifecycle_policy: { on_disable: 'require_author_decision' },
    unknown_policy: 'mark_unknown',
  };
}

test('schema, mechanic validator, and evaluator declare the same supported operator set', () => {
  const schema = JSON.parse(readFileSync(resolve(root, 'schemas/declarative-rule.schema.json'), 'utf8'));
  const schemaOps = schema.$defs.rule.properties.op.enum;
  assert.deepEqual([...schemaOps].sort(), [...SUPPORTED_RULE_OPERATORS].sort());

  for (const op of SUPPORTED_RULE_OPERATORS) {
    const rule = op === 'all' || op === 'any' ? { op, rules: [] }
      : op === 'not' ? { op, rules: [{ op: 'exists', path: 'flag' }] }
      : op === 'in' ? { op, path: 'flag', values: [true] }
      : op === 'exists' ? { op, path: 'flag' }
      : ['gt', 'gte', 'lt', 'lte'].includes(op) ? { op, path: 'number', value: 1 }
      : { op, path: 'flag', value: true };
    assert.doesNotThrow(() => validateMechanicTemplate(templateWithRule(rule)), op);
    assert.doesNotThrow(() => evaluateCondition(rule, { flag: true, number: 2 }), op);
  }
});

test('operators without an evaluator implementation are rejected by mechanic validation and runtime evaluation', () => {
  for (const op of ['contains', 'ref_exists', 'status_is', 'time_before', 'time_after', 'needs_review']) {
    const rule = { op, path: 'flag', value: true, ref: 'entity.test', reason: 'test' };
    assert.throws(() => validateMechanicTemplate(templateWithRule(rule)), (error) => error.code === 'INVALID_MECHANIC_CONTRACT', op);
    assert.throws(() => evaluateCondition(rule, { flag: true }), (error) => error.code === 'UNSUPPORTED_RULE_OPERATOR', op);
  }
});

test('exists requires a boolean value when one is provided', () => {
  const invalidRule = { op: 'exists', path: 'flag', value: 'yes' };
  assert.throws(
    () => validateMechanicTemplate(templateWithRule(invalidRule)),
    (error) => error.code === 'INVALID_MECHANIC_CONTRACT',
  );
  assert.throws(
    () => evaluateCondition(invalidRule, { flag: true }),
    (error) => error.code === 'INVALID_RULE',
  );
});
