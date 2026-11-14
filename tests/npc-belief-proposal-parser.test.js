import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNpcBeliefProposalOutput } from '../src/application/npc-belief-proposal-parser.js';

const contextHandle = 'nctx1.' + 'A'.repeat(22) + '.1800000000000.' + 'B'.repeat(43);
const propositionHandle = 'prh1.' + 'C'.repeat(43);
const evidenceHandle = 'evh1.' + 'D'.repeat(43);

function envelope(overrides = {}) {
  return {
    schema_version: 1,
    context_handle: contextHandle,
    proposition_handle: propositionHandle,
    object: { value: 'claim-a' },
    modality: 'asserted',
    stance: 'supported',
    supporting_evidence_handles: [evidenceHandle],
    contradicting_evidence_handles: [],
    ...overrides,
  };
}

test('parses the exact proposal envelope and freezes returned data', () => {
  const result = parseNpcBeliefProposalOutput(JSON.stringify(envelope()));

  assert.equal(result.status, 'parsed');
  assert.equal(result.stance, 'supported');
  assert.equal(result.modality, 'asserted');
  assert.deepEqual(result.proposal, {
    schema_version: 1,
    context_handle: contextHandle,
    proposition_handle: propositionHandle,
    object: { value: 'claim-a' },
    supporting_evidence_handles: [evidenceHandle],
    contradicting_evidence_handles: [],
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.proposal), true);
  assert.equal(Object.isFrozen(result.proposal.supporting_evidence_handles), true);
});

test('rejects non-string, empty, and oversized model output', () => {
  assert.equal(parseNpcBeliefProposalOutput(null).reason, 'invalid_output_size_or_type');
  assert.equal(parseNpcBeliefProposalOutput('').reason, 'invalid_output_size_or_type');
  assert.equal(parseNpcBeliefProposalOutput('x'.repeat(16 * 1024 + 1)).reason, 'invalid_output_size_or_type');
});

test('rejects markdown, free text, malformed JSON, and trailing JSON values', () => {
  for (const raw of [
    '```json\n' + JSON.stringify(envelope()) + '\n```',
    'The answer is: ' + JSON.stringify(envelope()),
    '{"schema_version":',
    JSON.stringify(envelope()) + ' false',
  ]) {
    assert.notEqual(parseNpcBeliefProposalOutput(raw).status, 'parsed');
  }
});

test('rejects unknown, missing, and model-controlled scope fields', () => {
  const base = envelope();
  assert.equal(parseNpcBeliefProposalOutput(JSON.stringify({ ...base, extra: true })).reason, 'proposal_schema_invalid');
  const missing = { ...base };
  delete missing.modality;
  assert.equal(parseNpcBeliefProposalOutput(JSON.stringify(missing)).reason, 'proposal_schema_invalid');
  assert.equal(parseNpcBeliefProposalOutput(JSON.stringify({
    ...base,
    world_id: 'world:forged',
  })).reason, 'proposal_schema_invalid');
});

test('rejects duplicate JSON keys, including escaped duplicate spellings', () => {
  const duplicate = '{"schema_version":1,"context_handle":"' + contextHandle
    + '","proposition_handle":"' + propositionHandle
    + '","object":{},"modality":"asserted","stance":"supported",'
    + '"\\u0073tance":"uncertain","supporting_evidence_handles":["' + evidenceHandle
    + '"],"contradicting_evidence_handles":[]}';
  const nestedDuplicate = JSON.stringify(envelope()).replace(
    '"object":{"value":"claim-a"}',
    '"object":{"value":"claim-a","value":"claim-b"}',
  );

  assert.equal(parseNpcBeliefProposalOutput(duplicate).reason, 'invalid_or_ambiguous_json');
  assert.equal(parseNpcBeliefProposalOutput(nestedDuplicate).reason, 'invalid_or_ambiguous_json');
});

test('rejects invalid handles, unsupported stances, and invalid modalities', () => {
  for (const proposal of [
    envelope({ context_handle: 'forged' }),
    envelope({ proposition_handle: 'prh1.short' }),
    envelope({ stance: 'believes_true' }),
    envelope({ modality: 'Not-A-Canonical-Modality' }),
  ]) {
    assert.equal(parseNpcBeliefProposalOutput(JSON.stringify(proposal)).reason, 'proposal_schema_invalid');
  }
});

test('requires at least one unique evidence handle across both sides', () => {
  assert.equal(parseNpcBeliefProposalOutput(JSON.stringify(envelope({
    supporting_evidence_handles: [],
    contradicting_evidence_handles: [],
  }))).reason, 'evidence_handles_invalid_or_duplicated');
  assert.equal(parseNpcBeliefProposalOutput(JSON.stringify(envelope({
    supporting_evidence_handles: [evidenceHandle],
    contradicting_evidence_handles: [evidenceHandle],
  }))).reason, 'evidence_handles_invalid_or_duplicated');
});

test('rejects non-finite numbers and excessive nesting in proposal object', () => {
  const nonFinite = JSON.stringify(envelope()).replace('"object":{"value":"claim-a"}', '"object":{"value":1e999}');
  assert.equal(parseNpcBeliefProposalOutput(nonFinite).reason, 'proposal_schema_invalid');

  const nested = '{"x":'.repeat(34) + 'null' + '}'.repeat(34);
  assert.equal(parseNpcBeliefProposalOutput(JSON.stringify(envelope({ object: JSON.parse(nested) }))).reason,
    'invalid_or_ambiguous_json');
});
