import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const schema = JSON.parse(readFileSync(
  new URL('../schemas/relationship-state-migration-mapping.schema.json', import.meta.url),
));
const complete = JSON.parse(readFileSync(
  new URL('../examples/relationship-migrations/test-pack-1.0.0-to-fixture-v2-2.0.0.json', import.meta.url),
));
const retirement = JSON.parse(readFileSync(
  new URL('../examples/relationship-migrations/explicit-retirement-fixture.json', import.meta.url),
));

const SPECIAL_STATES = [
  'unset',
  'cleared',
  'withheld',
  'conflict',
  'insufficient',
  'insufficient_support',
  'unsupported',
  'incomplete',
];

const sourceDomains = {
  trust: { values: ['low', 'neutral', 'high'] },
  affinity: { values: ['low', 'high'] },
};
const targetDomains = {
  trust_level: { values: ['cautious', 'balanced', 'confident'] },
  affinity_level: { values: ['distant', 'close'] },
  reliability: { values: ['unrated', 'verified'] },
};
const sourceModules = [{ module_id: 'relationship-rules', version: '1.0.0' }];
const targetModule = { module_id: 'fixture.relationship-rules-v2', version: '2.0.0' };
const sourcePack = {
  world_pack_id: 'test-pack',
  version: '1.0.0',
  sha256: 'a'.repeat(64),
};
const targetPack = {
  world_pack_id: 'fixture.test-pack-v2',
  version: '2.0.0',
  sha256: 'b'.repeat(64),
};

const clone = (value) => JSON.parse(JSON.stringify(value));
const pinKey = (pin) => pin.module_id + '@' + pin.version;
const sameSet = (left, right) =>
  left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);

function validateAgainstDomain(artifact, {
  sourceDomains: sourceDomain,
  targetDomains: targetDomain,
  sourceModules: expectedSourceModules,
  targetModule: expectedTargetModule,
  sourcePack: expectedSourcePack,
  targetPack: expectedTargetPack,
}) {
  const errors = [];
  const add = (code, detail) => errors.push({ code, detail });
  if (artifact.artifact_schema_version !== 'relationships-state-mapping/v1') add('schema_version', 'unsupported schema version');
  if (artifact.artifact_status !== 'draft' || artifact.fixture_only !== true) add('fixture_gate', 'fixture artifacts must remain draft and fixture-only');
  if (artifact.source.world_pack_id !== expectedSourcePack.world_pack_id
      || artifact.source.version !== expectedSourcePack.version
      || artifact.source.sha256 !== expectedSourcePack.sha256) add('source_pin_mismatch', 'source World Pack tuple/digest differs from the exact expected pin');
  if (artifact.target.world_pack_id !== expectedTargetPack.world_pack_id
      || artifact.target.version !== expectedTargetPack.version
      || artifact.target.sha256 !== expectedTargetPack.sha256) add('target_pin_mismatch', 'target World Pack tuple/digest differs from the exact expected pin');
  if (artifact.target_pack_conformance.target_pack_digest !== artifact.target.sha256) add('conformance_digest_mismatch', 'conformance evidence is not bound to the target digest');
  if (artifact.directionality !== 'preserve_subject_target_direction') add('directionality', 'direction must be preserved');
  if (!sameSet(artifact.source_rule_modules.map(pinKey), expectedSourceModules.map(pinKey))) {
    add('source_module_pin_set', 'source rule-module pin set is not exact');
  }
  if (pinKey(artifact.target_rule_module) !== pinKey(expectedTargetModule)) add('target_module_pin', 'target rule-module pin is not exact');

  const declaredModules = new Set(artifact.source_rule_modules.map(pinKey));
  const seenSourceDimensions = new Set();
  const mappedTargetDimensions = new Set();

  for (const mapping of artifact.dimension_mappings) {
    const moduleKey = pinKey(mapping.source_rule_module);
    if (!declaredModules.has(moduleKey)) {
      add('undeclared_source_module', moduleKey);
      continue;
    }
    const sourceKey = moduleKey + ':' + mapping.source_dimension;
    if (seenSourceDimensions.has(sourceKey)) add('duplicate_source_dimension', sourceKey);
    seenSourceDimensions.add(sourceKey);

    const sourceDefinition = sourceDomain[mapping.source_dimension];
    if (!sourceDefinition) {
      add('unknown_source_dimension', mapping.source_dimension);
      continue;
    }
    if (mapping.disposition === 'retire') {
      if (!mapping.retirement_reason?.trim()) add('retirement_reason_required', mapping.source_dimension);
      continue;
    }
    if (mapping.disposition !== 'map') {
      add('unknown_dimension_disposition', mapping.source_dimension);
      continue;
    }
    if (!targetDomain[mapping.target_dimension]) {
      add('unknown_target_dimension', mapping.target_dimension);
      continue;
    }
    if (mappedTargetDimensions.has(mapping.target_dimension)) {
      add('target_dimension_collision', mapping.target_dimension);
    }
    mappedTargetDimensions.add(mapping.target_dimension);

    const sourceValues = mapping.value_mappings.map(item => item.source_value);
    if (!sameSet(sourceValues, sourceDefinition.values)) {
      add('incomplete_value_coverage', mapping.source_dimension);
    }
    if (new Set(sourceValues).size !== sourceValues.length) add('duplicate_source_value', mapping.source_dimension);
    for (const valueMapping of mapping.value_mappings) {
      if (!targetDomain[mapping.target_dimension].values.includes(valueMapping.target_value)) {
        add('unknown_target_value', mapping.target_dimension + ':' + valueMapping.target_value);
      }
    }

    const sourceStates = mapping.special_state_mappings.map(item => item.source_state);
    if (!sameSet(sourceStates, SPECIAL_STATES)) add('incomplete_special_state_coverage', mapping.source_dimension);
    if (new Set(sourceStates).size !== sourceStates.length) add('duplicate_special_state', mapping.source_dimension);
    const stateTargets = mapping.special_state_mappings.map(item =>
      item.target.kind === 'state' ? 'state:' + item.target.status : 'value:' + item.target.value);
    if (new Set(stateTargets).size !== stateTargets.length) {
      add('special_state_collision', mapping.source_dimension);
    }
    for (const stateMapping of mapping.special_state_mappings) {
      if (stateMapping.target.kind === 'value'
          && !targetDomain[mapping.target_dimension].values.includes(stateMapping.target.value)) {
        add('unknown_special_state_target_value', mapping.target_dimension + ':' + stateMapping.target.value);
      }
    }
  }

  for (const modulePin of expectedSourceModules) {
    for (const dimension of Object.keys(sourceDomain)) {
      const key = pinKey(modulePin) + ':' + dimension;
      if (!seenSourceDimensions.has(key)) add('missing_dimension_mapping', key);
    }
  }

  const targetOnlySeen = new Set();
  for (const entry of artifact.target_only_dimensions) {
    if (!targetDomain[entry.target_dimension]) add('unknown_target_only_dimension', entry.target_dimension);
    if (targetOnlySeen.has(entry.target_dimension)) add('duplicate_target_only_dimension', entry.target_dimension);
    targetOnlySeen.add(entry.target_dimension);
    if (mappedTargetDimensions.has(entry.target_dimension)) add('target_only_already_mapped', entry.target_dimension);
    if (entry.disposition === 'initialize_value'
        && !targetDomain[entry.target_dimension]?.values.includes(entry.value)) {
      add('invalid_target_only_initial_value', entry.target_dimension + ':' + entry.value);
    }
    if (!['remain_unset', 'initialize_value'].includes(entry.disposition)) {
      add('invalid_target_only_disposition', entry.target_dimension);
    }
  }
  for (const targetDimension of Object.keys(targetDomain)) {
    if (!mappedTargetDimensions.has(targetDimension) && !targetOnlySeen.has(targetDimension)) {
      add('target_only_disposition_missing', targetDimension);
    }
  }
  for (const sourceModule of artifact.source_rule_modules) {
    for (const dimension of Object.keys(sourceDomain)) {
      if (!seenSourceDimensions.has(pinKey(sourceModule) + ':' + dimension)) {
        add('source_module_dimension_coverage_missing', pinKey(sourceModule) + ':' + dimension);
      }
    }
  }
  return errors;
}

test('mapping schema declares an immutable, exact-pin, Relationships-owned artifact shape', () => {
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.properties.artifact_schema_version.const, 'relationships-state-mapping/v1');
  assert.equal(schema.properties.directionality.const, 'preserve_subject_target_direction');
  assert.equal(schema.additionalProperties, false);
  assert.ok(schema.required.includes('source'));
  assert.ok(schema.required.includes('target'));
  assert.ok(schema.required.includes('source_rule_modules'));
  assert.ok(schema.required.includes('target_rule_module'));
  assert.ok(schema.required.includes('dimension_mappings'));
  assert.ok(schema.required.includes('target_only_dimensions'));
  assert.ok(schema.allOf.some(rule => rule.if?.properties?.artifact_status?.const === 'approved'));
});

test('complete fixture maps the exact Core test-pack source domain and pins', () => {
  assert.deepEqual(validateAgainstDomain(complete, {
    sourceDomains,
    targetDomains,
    sourceModules,
    targetModule,
    sourcePack,
    targetPack,
  }), []);
});

test('a missing source value mapping rejects the whole artifact', () => {
  const candidate = clone(complete);
  candidate.dimension_mappings
    .find(item => item.source_dimension === 'trust')
    .value_mappings = candidate.dimension_mappings
      .find(item => item.source_dimension === 'trust')
      .value_mappings.filter(item => item.source_value !== 'neutral');

  assert.ok(validateAgainstDomain(candidate, {
    sourceDomains, targetDomains, sourceModules, targetModule, sourcePack, targetPack,
  }).some(error => error.code === 'incomplete_value_coverage'));
});

test('unset and cleared remain explicit and distinct; special states are not collapsed', () => {
  for (const mapping of complete.dimension_mappings) {
    const unset = mapping.special_state_mappings.find(item => item.source_state === 'unset');
    const cleared = mapping.special_state_mappings.find(item => item.source_state === 'cleared');
    assert.deepEqual(unset.target, { kind: 'state', status: 'unset' });
    assert.deepEqual(cleared.target, { kind: 'state', status: 'cleared' });
    assert.equal(mapping.special_state_mappings.length, SPECIAL_STATES.length);
  }

  const candidate = clone(complete);
  const trust = candidate.dimension_mappings.find(item => item.source_dimension === 'trust');
  trust.special_state_mappings.find(item => item.source_state === 'cleared').target = {
    kind: 'state', status: 'unset',
  };
  assert.ok(validateAgainstDomain(candidate, {
    sourceDomains, targetDomains, sourceModules, targetModule, sourcePack, targetPack,
  }).some(error => error.code === 'special_state_collision'));
});

test('target-only dimensions require an explicit remain-unset or initialize-value disposition', () => {
  assert.deepEqual(complete.target_only_dimensions, [
    { target_dimension: 'reliability', disposition: 'remain_unset' },
  ]);
  const candidate = clone(complete);
  candidate.target_only_dimensions = [];
  assert.ok(validateAgainstDomain(candidate, {
    sourceDomains, targetDomains, sourceModules, targetModule, sourcePack, targetPack,
  }).some(error => error.code === 'target_only_disposition_missing'));
});

test('many-to-one target dimension collision is rejected in mapping v1', () => {
  const candidate = clone(complete);
  candidate.dimension_mappings.find(item => item.source_dimension === 'affinity').target_dimension = 'trust_level';
  assert.ok(validateAgainstDomain(candidate, {
    sourceDomains, targetDomains, sourceModules, targetModule, sourcePack, targetPack,
  }).some(error => error.code === 'target_dimension_collision'));
});

test('wrong source or target digest rejects the entire mapping', () => {
  const candidate = clone(complete);
  candidate.source.sha256 = 'f'.repeat(64);
  assert.ok(validateAgainstDomain(candidate, {
    sourceDomains, targetDomains, sourceModules, targetModule, sourcePack, targetPack,
  }).some(error => error.code === 'source_pin_mismatch'));

  const wrongTargetEvidence = clone(complete);
  wrongTargetEvidence.target_pack_conformance.target_pack_digest = 'e'.repeat(64);
  assert.ok(validateAgainstDomain(wrongTargetEvidence, {
    sourceDomains, targetDomains, sourceModules, targetModule, sourcePack, targetPack,
  }).some(error => error.code === 'conformance_digest_mismatch'));
});

test('an extra unsupported source rule-module pin rejects the artifact', () => {
  const candidate = clone(complete);
  candidate.source_rule_modules.push({ module_id: 'relationship-rules', version: '0.9.0' });
  assert.ok(validateAgainstDomain(candidate, {
    sourceDomains, targetDomains, sourceModules, targetModule, sourcePack, targetPack,
  }).some(error => error.code === 'source_module_pin_set'));
});

test('removed dimensions require an explicit retirement disposition and reason', () => {
  const legacySourceDomains = { legacy_affinity: { values: ['low', 'high'] } };
  const legacySourceModules = [{ module_id: 'fixture.legacy-relationship-rules', version: '1.0.0' }];
  const legacyTargetModule = { module_id: 'fixture.replacement-relationship-rules', version: '2.0.0' };
  const legacySourcePack = {
    world_pack_id: 'fixture.legacy-pack', version: '1.0.0', sha256: 'c'.repeat(64),
  };
  const legacyTargetPack = {
    world_pack_id: 'fixture.replacement-pack', version: '2.0.0', sha256: 'd'.repeat(64),
  };
  assert.deepEqual(validateAgainstDomain(retirement, {
    sourceDomains: legacySourceDomains,
    targetDomains: {},
    sourceModules: legacySourceModules,
    targetModule: legacyTargetModule,
    sourcePack: legacySourcePack,
    targetPack: legacyTargetPack,
  }), []);
  const candidate = clone(retirement);
  delete candidate.dimension_mappings[0].retirement_reason;
  assert.ok(validateAgainstDomain(candidate, {
    sourceDomains: legacySourceDomains,
    targetDomains: {},
    sourceModules: legacySourceModules,
    targetModule: legacyTargetModule,
    sourcePack: legacySourcePack,
    targetPack: legacyTargetPack,
  }).some(error => error.code === 'retirement_reason_required'));
});

test('an artifact cannot be approved while fixture-only or without passed conformance evidence', () => {
  const candidate = clone(complete);
  candidate.artifact_status = 'approved';
  assert.equal(candidate.fixture_only, true);
  assert.equal(candidate.target_pack_conformance.status, 'not-established');
  assert.ok(schema.allOf.some(rule =>
    rule.if?.properties?.artifact_status?.const === 'approved'
      && rule.then?.properties?.fixture_only?.const === false
      && rule.then?.required?.includes('approval')));
});
