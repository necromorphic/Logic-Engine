import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateTrustedInitialKnowledgeSource } from '../src/application/trusted-initial-knowledge-source.js';

const source = (overrides = {}) => JSON.stringify({
  schema_version: 1,
  world_pack_id: 'test.world',
  world_pack_version: '1.0.0',
  source_kind: 'author_initial',
  source_ref: 'authoring:test.world@1.0.0',
  authorization_ref: 'rule:initial-knowledge-v1',
  assignments: [{ subject_id: 'npc-a', fact_id: 'fact-secret-a' }],
  ...overrides,
});

const registryFor = (bytes, overrides = {}) => {
  const doc = JSON.parse(bytes);
  return [{
    world_pack_id: doc.world_pack_id,
    world_pack_version: doc.world_pack_version,
    source_kind: doc.source_kind,
    source_ref: doc.source_ref,
    authorization_ref: doc.authorization_ref,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    ...overrides,
  }];
};

test('accepts exact source bytes only when a deployment-owned allowlist pins identity and digest', () => {
  const bytes = source();
  const validated = validateTrustedInitialKnowledgeSource(bytes, registryFor(bytes));
  assert.equal(validated.source_digest, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(validated.source_kind, 'author_initial');
  assert.deepEqual(validated.assignments, [{ subject_id: 'npc-a', fact_id: 'fact-secret-a' }]);
  assert.ok(Object.isFrozen(validated));
  assert.ok(Object.isFrozen(validated.assignments));
  assert.ok(Object.isFrozen(validated.assignments[0]));
});

test('rejects missing trusted registry and unapproved source bytes', () => {
  const bytes = source();
  assert.throws(() => validateTrustedInitialKnowledgeSource(bytes, null), { code: 'TRUSTED_SOURCE_REGISTRY_REQUIRED' });
  assert.throws(() => validateTrustedInitialKnowledgeSource(bytes, []), { code: 'TRUSTED_SOURCE_NOT_APPROVED' });
});

test('rejects caller-forged digest and source identity mismatch', () => {
  const bytes = source();
  assert.throws(() => validateTrustedInitialKnowledgeSource(bytes, registryFor(bytes, { sha256: 'a'.repeat(64) })), {
    code: 'TRUSTED_SOURCE_NOT_APPROVED',
  });
  assert.throws(() => validateTrustedInitialKnowledgeSource(bytes, registryFor(bytes, { source_ref: 'other-source' })), {
    code: 'TRUSTED_SOURCE_NOT_APPROVED',
  });
});

test('rejects unknown fields, unsupported kinds, and malformed assignments', () => {
  for (const invalid of [
    source({ extra: true }),
    source({ source_kind: 'observed' }),
    source({ assignments: [{ subject_id: 'npc-a', fact_id: 'fact-a', trusted: true }] }),
    source({ assignments: [{ subject_id: 'npc-a', fact_id: 'fact-a' }, { subject_id: 'npc-a', fact_id: 'fact-a' }] }),
    source({ assignments: [] }),
  ]) {
    const doc = JSON.parse(invalid);
    assert.throws(() => validateTrustedInitialKnowledgeSource(invalid, registryFor(invalid)), /./);
  }
});

test('changing even one source byte invalidates the pinned digest', () => {
  const original = source();
  const altered = original.replace('fact-secret-a', 'fact-secret-b');
  assert.throws(() => validateTrustedInitialKnowledgeSource(altered, registryFor(original)), {
    code: 'TRUSTED_SOURCE_NOT_APPROVED',
  });
});

test('rejects invalid JSON, empty input, and oversized source bytes', () => {
  const registry = [];
  assert.throws(() => validateTrustedInitialKnowledgeSource('', registry), { code: 'INVALID_TRUSTED_SOURCE' });
  assert.throws(() => validateTrustedInitialKnowledgeSource('{', registry), { code: 'INVALID_TRUSTED_SOURCE_JSON' });
  assert.throws(() => validateTrustedInitialKnowledgeSource(' '.repeat(1_000_001), registry), { code: 'INVALID_TRUSTED_SOURCE' });
});
