import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadSchema(path) {
  const source = readFileSync(resolve(root, path), 'utf8');
  const schema = JSON.parse(source);
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.type, 'object');
  return schema;
}

function collectRefs(value, result = []) {
  if (!value || typeof value !== 'object') return result;
  if (typeof value.$ref === 'string') result.push(value.$ref);
  for (const child of Object.values(value)) collectRefs(child, result);
  return result;
}

test('mechanics schemas are valid JSON and local schema references resolve', () => {
  const paths = [
    'schemas/mechanic-template.schema.json',
    'schemas/mechanic-instance.schema.json',
    'schemas/rule-module-manifest.schema.json',
    'schemas/declarative-rule.schema.json',
  ];
  const schemas = new Map(paths.map((path) => [path, loadSchema(path)]));

  for (const [path, schema] of schemas) {
    for (const ref of collectRefs(schema)) {
      if (ref.startsWith('#/')) {
        const pointer = ref.slice(2).split('/');
        let target = schema;
        for (const segment of pointer) target = target?.[segment.replace(/~1/g, '/').replace(/~0/g, '~')];
        assert.notEqual(target, undefined, path + ' has unresolved reference ' + ref);
        continue;
      }
      const [file, pointer] = ref.split('#');
      const targetSchema = schemas.get(resolve(dirname(resolve(root, path)), file));
      assert.ok(targetSchema, path + ' references an unavailable schema file: ' + file);
      let target = targetSchema;
      if (pointer) {
        for (const segment of pointer.slice(2).split('/')) target = target?.[segment.replace(/~1/g, '/').replace(/~0/g, '~')];
      }
      assert.notEqual(target, undefined, path + ' has unresolved reference ' + ref);
    }
  }
});

test('mechanics contracts require exact versions, world scope, and explicit lifecycle policies', () => {
  const template = loadSchema('schemas/mechanic-template.schema.json');
  const instance = loadSchema('schemas/mechanic-instance.schema.json');
  const moduleManifest = loadSchema('schemas/rule-module-manifest.schema.json');

  for (const key of ['template_id', 'version', 'schema_version', 'actions', 'conflict_policy', 'lifecycle_policy', 'unknown_policy']) {
    assert.ok(template.required.includes(key), 'template contract must require ' + key);
  }
  assert.ok(instance.required.includes('world_id'));
  assert.ok(instance.required.includes('template_version'));
  assert.deepEqual(instance.properties.status.enum, ['disabled', 'enabled', 'needs_review']);
  assert.deepEqual(template.properties.lifecycle_policy.properties.on_disable.enum, [
    'continue_pinned_version',
    'pause_blocked',
    'archive',
    'require_author_decision',
  ]);
  assert.ok(moduleManifest.required.includes('version'));
  assert.ok(moduleManifest.required.includes('operations'));
  assert.equal(template.properties.conflict_policy.oneOf.length, 2);
  assert.equal(template.properties.conflict_policy.oneOf[0].properties.mode.const, 'automatic');
  assert.equal(template.properties.conflict_policy.oneOf[1].properties.mode.const, 'manual');
});
