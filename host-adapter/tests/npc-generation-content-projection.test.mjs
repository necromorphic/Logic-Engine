import test from 'node:test';
import assert from 'node:assert/strict';
import {
  projectNpcGenerationContentBlocks,
  snapshotNpcGenerationContent,
} from '../npc-generation-content-projection.mjs';

const candidate = content => ({
  epistemic_kind: 'acquired_report',
  evidence_assessment: 'supported',
  content,
});

test('Provider content is copied into frozen JSON-only snapshots', () => {
  const original = { note: 'known', nested: [{ value: 7 }] };
  const projected = projectNpcGenerationContentBlocks([candidate(original)]);
  original.nested[0].value = 99;
  assert.equal(projected[0].content.nested[0].value, 7);
  assert.equal(Object.isFrozen(projected), true);
  assert.equal(Object.isFrozen(projected[0]), true);
  assert.equal(Object.getPrototypeOf(projected[0]), Object.prototype);
  assert.equal(Object.isFrozen(projected[0].content), true);
  assert.equal(Object.isFrozen(projected[0].content.nested), true);
  assert.equal(Object.getPrototypeOf(projected[0].content), null);
});

test('Provider content rejects proxies before invoking their traps', () => {
  let calls = 0;
  const proxy = new Proxy({}, {
    ownKeys() { calls += 1; throw new Error('proxy trap executed'); },
  });
  assert.throws(() => snapshotNpcGenerationContent(proxy), /NPC_GENERATION_CONTENT_INVALID/);
  assert.throws(() => projectNpcGenerationContentBlocks(new Proxy([], {})), /NPC_GENERATION_CONTENT_INVALID/);
  assert.equal(calls, 0);
});

test('Provider content rejects accessors and executable toJSON properties without invoking them', () => {
  let calls = 0;
  const accessor = {};
  Object.defineProperty(accessor, 'secret', {
    enumerable: true,
    get() { calls += 1; throw new Error('getter executed'); },
  });
  const executable = { value: 'safe', toJSON() { calls += 1; return 'unsafe'; } };
  assert.throws(() => snapshotNpcGenerationContent(accessor), /NPC_GENERATION_CONTENT_INVALID/);
  assert.throws(() => snapshotNpcGenerationContent(executable), /NPC_GENERATION_CONTENT_INVALID/);
  const candidateWithGetter = candidate('safe');
  Object.defineProperty(candidateWithGetter, 'content', {
    enumerable: true,
    get() { calls += 1; throw new Error('candidate getter executed'); },
  });
  assert.throws(() => projectNpcGenerationContentBlocks([candidateWithGetter]), /NPC_GENERATION_CONTENT_INVALID/);
  assert.equal(calls, 0);
});

test('Provider content rejects sparse arrays, cycles, non-JSON values and excessive depth', () => {
  const sparse = new Array(1);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => snapshotNpcGenerationContent(sparse), /NPC_GENERATION_CONTENT_INVALID/);
  assert.throws(() => snapshotNpcGenerationContent(cyclic), /NPC_GENERATION_CONTENT_INVALID/);
  assert.throws(() => snapshotNpcGenerationContent({ value: undefined }), /NPC_GENERATION_CONTENT_INVALID/);
  let deep = 'leaf';
  for (let index = 0; index < 34; index += 1) deep = { child: deep };
  assert.throws(() => snapshotNpcGenerationContent(deep), /NPC_GENERATION_CONTENT_INVALID/);
});

test('Provider candidate arrays require dense entries and exact trusted evidence fields', () => {
  const sparse = new Array(1);
  assert.throws(() => projectNpcGenerationContentBlocks(sparse), /NPC_GENERATION_CONTENT_INVALID/);
  assert.throws(() => projectNpcGenerationContentBlocks([{
    epistemic_kind: 'acquired_report',
    evidence_assessment: 'supported',
    content: 'safe',
    get extra() { throw new Error('unused getter'); },
  }]), /NPC_GENERATION_CONTENT_INVALID/);
  assert.throws(() => projectNpcGenerationContentBlocks([{
    epistemic_kind: 42, evidence_assessment: 'supported', content: 'safe',
  }]), /NPC_GENERATION_CONTENT_INVALID/);
});
