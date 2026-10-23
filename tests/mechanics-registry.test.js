import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';

function setup() {
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  return { store, engine };
}

function template(overrides = {}) {
  return {
    template_id: 'test.mechanic',
    version: '1.0.0',
    schema_version: 'core-1',
    display_name: 'Empty mechanic contract',
    required_capabilities: [],
    applicability: [],
    actions: [],
    conflict_policy: { mode: 'manual' },
    lifecycle_policy: { on_disable: 'require_author_decision' },
    unknown_policy: 'mark_unknown',
    ...overrides,
  };
}

function moduleManifest(overrides = {}) {
  return {
    module_id: 'test.resolver',
    version: '1.0.0',
    contract_version: 'core-1',
    capabilities: ['conflicts.resolve'],
    operations: ['resolve_conflict'],
    input_schema: { type: 'object' },
    output_schema: { type: 'object' },
    failure_policy: 'fail_closed',
    compatibility: { core_contract_versions: ['core-1'] },
    ...overrides,
  };
}

test('mechanic and module registries start empty and keep immutable exact versions', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  assert.deepEqual(engine.listMechanicTemplates(), []);
  assert.deepEqual(engine.listRuleModuleManifests(), []);

  const first = engine.registerMechanicTemplate(template());
  assert.equal(first.already_registered, false);
  assert.equal(first.template.version, '1.0.0');

  const replay = engine.registerMechanicTemplate(template());
  assert.equal(replay.already_registered, true);
  assert.equal(replay.template_hash, first.template_hash);
  assert.equal(engine.listMechanicTemplates().length, 1);
  assert.equal(engine.getMechanicTemplate('test.mechanic', '1.0.0').template.display_name, 'Empty mechanic contract');

  assert.throws(
    () => engine.registerMechanicTemplate(template({ display_name: 'Changed under same version' })),
    (error) => error.code === 'MECHANIC_TEMPLATE_VERSION_IMMUTABLE' && error.status === 409,
  );

  const next = engine.registerMechanicTemplate(template({ version: '1.1.0', display_name: 'New version' }));
  assert.equal(next.already_registered, false);
  assert.equal(engine.listMechanicTemplates('test.mechanic').length, 2);
  assert.throws(
    () => engine.getMechanicTemplate('test.mechanic', '9.9.9'),
    (error) => error.code === 'MECHANIC_TEMPLATE_NOT_FOUND' && error.status === 404,
  );
});

test('rule-module registration is versioned and duplicate versions cannot be replaced', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  const first = engine.registerRuleModuleManifest(moduleManifest());
  assert.equal(first.already_registered, false);
  assert.equal(first.manifest.operations[0], 'resolve_conflict');

  const replay = engine.registerRuleModuleManifest(moduleManifest());
  assert.equal(replay.already_registered, true);
  assert.equal(engine.listRuleModuleManifests().length, 1);
  assert.equal(engine.getRuleModuleManifest('test.resolver', '1.0.0').manifest_hash, first.manifest_hash);

  assert.throws(
    () => engine.registerRuleModuleManifest(moduleManifest({ failure_policy: 'needs_review' })),
    (error) => error.code === 'RULE_MODULE_VERSION_IMMUTABLE' && error.status === 409,
  );
  assert.throws(
    () => engine.getRuleModuleManifest('test.resolver', '2.0.0'),
    (error) => error.code === 'RULE_MODULE_NOT_FOUND' && error.status === 404,
  );
});

test('mechanic contracts fail closed on unsupported fields and incomplete automatic conflict policy', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  assert.throws(
    () => engine.registerMechanicTemplate(template({ executable_code: 'not allowed' })),
    (error) => error.code === 'INVALID_MECHANIC_CONTRACT',
  );
  assert.throws(
    () => engine.registerMechanicTemplate(template({ conflict_policy: { mode: 'automatic' } })),
    (error) => error.code === 'INVALID_MECHANIC_CONTRACT',
  );
  assert.throws(
    () => engine.registerRuleModuleManifest(moduleManifest({ operations: ['execute_arbitrary_code'] })),
    (error) => error.code === 'INVALID_MECHANIC_CONTRACT',
  );
});
