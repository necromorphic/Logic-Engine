import test from 'node:test';
import assert from 'node:assert/strict';
import { runRecalculation, assertProjection } from './harness.mjs';

const basicNodes = [
  { id: 'branch', dependsOn: ['infected'], evaluate: ({ read }) => read('infected') ? 'infected' : 'healthy' },
  { id: 'effect', dependsOn: ['branch', 'hp', 'mana'], evaluate: ({ read }) => read('branch') === 'infected' ? read('hp') - 2 : read('mana') + 1 },
  { id: 'summary', dependsOn: ['effect'], evaluate: ({ read }) => 'result:' + read('effect') },
];

test('A recomputes all nodes and matches a literal independent oracle', () => {
  const result = runRecalculation({
    inputs: { infected: true, hp: 10, mana: 4 }, nodes: basicNodes, strategy: 'A',
  });
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.executed, ['branch', 'effect', 'summary']);
  assertProjection(result.values, { branch: 'infected', effect: 8, summary: 'result:8' });
});

test('B recomputes the transitive dependent closure for a declared dependency', () => {
  const result = runRecalculation({
    inputs: { infected: true, hp: 7, mana: 4 },
    nodes: basicNodes,
    strategy: 'B',
    changedInputs: ['hp'],
    previousValues: { branch: 'infected', effect: 8, summary: 'result:8' },
  });
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.executed, ['effect', 'summary']);
  assertProjection(result.values, { branch: 'infected', effect: 5, summary: 'result:5' });
});

test('B exposes stale output when a conditional read was omitted from the declared graph', () => {
  const nodes = [
    { id: 'branch', dependsOn: ['infected'], evaluate: ({ read }) => read('infected') ? 'infected' : 'healthy' },
    // Deliberately broken contract: hp is read but not declared as a dependency.
    { id: 'effect', dependsOn: ['branch'], evaluate: ({ read }) => read('branch') === 'infected' ? read('hp') - 2 : read('mana') + 1 },
    { id: 'summary', dependsOn: ['effect'], evaluate: ({ read }) => 'result:' + read('effect') },
  ];
  const result = runRecalculation({
    inputs: { infected: true, hp: 6, mana: 4 },
    nodes,
    strategy: 'B',
    changedInputs: ['hp'],
    previousValues: { branch: 'infected', effect: 8, summary: 'result:8' },
  });
  assert.equal(result.status, 'ready');
  assertProjection(result.values, { branch: 'infected', effect: 8, summary: 'result:8' });
  // This is the point of the test: incremental graph metadata alone does not prove completeness.
  assert.notEqual(result.values.effect, 4);
});

test('C falls back to A when an invariant catches a missed dependency', () => {
  const nodes = [
    { id: 'branch', dependsOn: ['infected'], evaluate: ({ read }) => read('infected') ? 'infected' : 'healthy' },
    { id: 'effect', dependsOn: ['branch'], evaluate: ({ read }) => read('branch') === 'infected' ? read('hp') - 2 : read('mana') + 1 },
    { id: 'summary', dependsOn: ['effect'], evaluate: ({ read }) => 'result:' + read('effect') },
  ];
  const invariant = ({ inputs, values }) =>
    values.effect === (inputs.infected ? inputs.hp - 2 : inputs.mana + 1);
  const result = runRecalculation({
    inputs: { infected: true, hp: 6, mana: 4 },
    nodes,
    strategy: 'C',
    changedInputs: ['hp'],
    previousValues: { branch: 'infected', effect: 8, summary: 'result:8' },
    invariants: [invariant],
  });
  assert.equal(result.fallback.used, true);
  assert.equal(result.fallback.reason, 'INVARIANT_NOT_PROVEN');
  assert.equal(result.status, 'needs_review');
  assertProjection(result.values, { branch: 'infected', effect: 4, summary: 'result:4' });
  assert.ok(result.dependencyViolations.some((v) => v.node === 'effect' && v.read === 'hp' && v.code === 'UNDECLARED_READ'));
});

test('cycles fail closed rather than choosing an arbitrary evaluation order', () => {
  const nodes = [
    { id: 'a', dependsOn: ['b'], evaluate: ({ read }) => read('b') + 1 },
    { id: 'b', dependsOn: ['a'], evaluate: ({ read }) => read('a') + 1 },
  ];
  assert.throws(() => runRecalculation({ inputs: {}, nodes, strategy: 'A' }), /DEPENDENCY_CYCLE/);
});

test('unknown dependencies are rejected before evaluation', () => {
  const nodes = [{ id: 'effect', dependsOn: ['missing'], evaluate: ({ read }) => read('missing') }];
  assert.throws(() => runRecalculation({ inputs: {}, nodes, strategy: 'A' }), /unknown dependency/);
});


test('changing a branch selector recomputes the selector and its full dependent closure', () => {
  const result = runRecalculation({
    inputs: { infected: false, hp: 10, mana: 4 },
    nodes: basicNodes,
    strategy: 'B',
    changedInputs: ['infected'],
    previousValues: { branch: 'infected', effect: 8, summary: 'result:8' },
  });
  assert.deepEqual(result.executed, ['branch', 'effect', 'summary']);
  assertProjection(result.values, { branch: 'healthy', effect: 5, summary: 'result:5' });
});

test('C detects an undeclared read when the affected node is actually executed', () => {
  const nodes = [
    { id: 'branch', dependsOn: ['infected'], evaluate: ({ read }) => read('infected') ? 'infected' : 'healthy' },
    { id: 'effect', dependsOn: ['branch'], evaluate: ({ read }) => read('branch') === 'infected' ? read('hp') - 2 : read('mana') + 1 },
    { id: 'summary', dependsOn: ['effect'], evaluate: ({ read }) => 'result:' + read('effect') },
  ];
  const result = runRecalculation({
    inputs: { infected: true, hp: 6, mana: 4 },
    nodes,
    strategy: 'C',
    changedInputs: ['infected'],
    previousValues: { branch: 'healthy', effect: 5, summary: 'result:5' },
    invariants: [({ inputs, values }) => values.effect === (inputs.infected ? inputs.hp - 2 : inputs.mana + 1)],
  });
  assert.equal(result.fallback.used, true);
  assert.equal(result.status, 'needs_review');
  assertProjection(result.values, { branch: 'infected', effect: 4, summary: 'result:4' });
});
