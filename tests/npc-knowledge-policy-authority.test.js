import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createNpcKnowledgePolicyAuthority,
  isNpcKnowledgePolicyAuthoritySnapshot,
} from '../src/application/npc-knowledge-policy-authority.js';

const source = {
  world_pack_id: 'test.world',
  world_pack_version: '1.0.0',
  source_kind: 'author_initial',
  source_ref: 'authoring:test.world@1.0.0',
  authorization_ref: 'rule:initial-knowledge-v1',
  sha256: 'a'.repeat(64),
};

test('NPC policy authority pins the exact deployment disclosure policy and source registry', () => {
  const first = createNpcKnowledgePolicyAuthority({
    adapterIds: ['adapter-b', 'adapter-a'],
    trustedInitialKnowledgeSources: [source],
  });
  const samePolicy = createNpcKnowledgePolicyAuthority({
    adapterIds: ['adapter-a', 'adapter-b'],
    trustedInitialKnowledgeSources: [{ ...source }],
  });
  const changedPolicy = createNpcKnowledgePolicyAuthority({
    adapterIds: ['adapter-a', 'adapter-b'],
    trustedInitialKnowledgeSources: [{ ...source, sha256: 'b'.repeat(64) }],
  });

  const initial = first.getSnapshot();
  assert.equal(isNpcKnowledgePolicyAuthoritySnapshot(initial), true);
  assert.deepEqual(Object.keys(initial).sort(), [
    'authority_id', 'generation', 'snapshot_fingerprint',
  ]);
  assert.notEqual(initial.authority_id, samePolicy.getSnapshot().authority_id,
    'each process instance receives a distinct authority identity');
  assert.equal(initial.snapshot_fingerprint, samePolicy.getSnapshot().snapshot_fingerprint,
    'canonical policy fingerprint is independent of input ordering');
  assert.notEqual(initial.snapshot_fingerprint, changedPolicy.getSnapshot().snapshot_fingerprint,
    'a changed trusted source digest changes the policy fingerprint');
});

test('NPC policy generation rotation invalidates every previous snapshot', () => {
  const authority = createNpcKnowledgePolicyAuthority({
    adapterIds: ['adapter-a'],
    trustedInitialKnowledgeSources: [source],
  });
  const first = authority.getSnapshot();
  const second = authority.advanceGeneration();

  assert.equal(second.authority_id, first.authority_id);
  assert.equal(second.generation, first.generation + 1);
  assert.equal(second.snapshot_fingerprint, first.snapshot_fingerprint);
  assert.equal(authority.isCurrent(first), false);
  assert.equal(authority.isCurrent(second), true);
  assert.equal(authority.isCurrent({ ...second, extra: true }), false);
});
