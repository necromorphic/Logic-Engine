import test from 'node:test';
import assert from 'node:assert/strict';
import { hashRequest } from '../src/core/request-hash.js';
import { reevaluateHistoricalRelationshipSnapshot } from '../src/relationship/reevaluate-historical-snapshot.js';

const input = {
  subjectId: 'A', targetId: 'B', currentValues: { trust: 'low' },
  patch: { trust: 'guarded' },
  dimensionRules: { trust: { values: ['low', 'guarded', 'high'], allowClear: true,
    transitions: [{ operation: 'set', from: 'low', to: 'guarded' }] } },
  evidence: { status: 'supported', refs: ['event:E1'] },
  ruleVersion: 'relationship-rules@1.0.0',
};
const makeSnapshot = () => {
  const snapshot = {
    originating_event_id: 'E2', schema: 'relationship-evaluation-input/v2',
    evaluator_contract: 'relationship-candidate/v1', rule_module_id: 'relationship-rules',
    rule_module_version: '1.0.0', world_pack_id: 'pack-A', world_pack_version: '3.2.1',
    input: structuredClone(input), input_digest: hashRequest(input),
  };
  snapshot.snapshot_digest = hashRequest(snapshot);
  return snapshot;
};
const context = { eventId: 'E2' };

test('read-only historical evaluation resolves and executes the exact pinned artifact', () => {
  const result = reevaluateHistoricalRelationshipSnapshot(makeSnapshot(), context);
  assert.equal(result.status, 'evaluated');
  assert.equal(result.read_only, true);
  assert.equal(result.candidate.status, 'candidate');
  assert.equal(result.rule_module_version, '1.0.0');
});

test('historical evaluation fails closed for missing, mismatched, or corrupt provenance', () => {
  assert.equal(reevaluateHistoricalRelationshipSnapshot(null, context).status, 'unavailable');
  assert.equal(reevaluateHistoricalRelationshipSnapshot(makeSnapshot(), { ...context, eventId: 'other' }).reason,
    'originating_event_binding_mismatch');
  const missingPackPin = makeSnapshot(); missingPackPin.world_pack_version = null;
  assert.equal(reevaluateHistoricalRelationshipSnapshot(missingPackPin, context).reason,
    'world_pack_pin_missing');
  const corrupt = makeSnapshot(); corrupt.input.patch.trust = 'high';
  const { snapshot_digest: ignoredDigest, ...corruptEnvelope } = corrupt;
  corrupt.snapshot_digest = hashRequest(corruptEnvelope);
  assert.equal(reevaluateHistoricalRelationshipSnapshot(corrupt, context).reason,
    'evaluation_input_digest_mismatch');
});

test('historical evaluation refuses unknown versions and incompatible contracts', () => {
  const unknown = makeSnapshot(); unknown.rule_module_version = '9.0.0';
  unknown.input.ruleVersion = 'relationship-rules@9.0.0'; unknown.input_digest = hashRequest(unknown.input);
  const { snapshot_digest: ignoredUnknownDigest, ...unknownEnvelope } = unknown;
  unknown.snapshot_digest = hashRequest(unknownEnvelope);
  assert.equal(reevaluateHistoricalRelationshipSnapshot(unknown, context).reason,
    'exact_evaluator_artifact_unavailable');
  const incompatible = makeSnapshot(); incompatible.evaluator_contract = 'relationship-candidate/v2';
  assert.equal(reevaluateHistoricalRelationshipSnapshot(incompatible, context).reason,
    'snapshot_contract_unsupported');
});

test('historical evaluation rejects incomplete input snapshots', () => {
  const incomplete = makeSnapshot(); delete incomplete.input.dimensionRules;
  incomplete.input_digest = hashRequest(incomplete.input);
  const { snapshot_digest: ignoredIncompleteDigest, ...incompleteEnvelope } = incomplete;
  incomplete.snapshot_digest = hashRequest(incompleteEnvelope);
  assert.equal(reevaluateHistoricalRelationshipSnapshot(incomplete, context).reason,
    'evaluation_input_incomplete');
});


test('historical evaluation detects tampering with World Pack provenance metadata', () => {
  const tampered = makeSnapshot();
  tampered.world_pack_version = '99.0.0';
  assert.equal(reevaluateHistoricalRelationshipSnapshot(tampered, context).reason,
    'evaluation_snapshot_digest_mismatch');
});
