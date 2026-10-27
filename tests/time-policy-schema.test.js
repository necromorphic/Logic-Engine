import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('TimePolicy schema permits whole-operation skip ceilings above seven days', () => {
  const schema = JSON.parse(readFileSync(new URL('../schemas/time-policy.schema.json', import.meta.url), 'utf8'));
  const properties = schema.properties;
  assert.equal(properties.max_action_duration_ms.maximum, 604800000);
  assert.equal(properties.max_skip_duration_ms.minimum, 1000);
  assert.equal(properties.max_skip_duration_ms.maximum, 9007199254740000);
  assert.equal(properties.max_skip_duration_ms.multipleOf, 1000);
  assert.ok(properties.max_skip_duration_ms.maximum > 604800000);
});
