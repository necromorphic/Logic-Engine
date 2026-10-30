import { hashRequest } from '../core/request-hash.js';
import { resolveHistoricalRelationshipEvaluator } from './historical-evaluator-registry.js';

const REQUIRED_INPUT_FIELDS = Object.freeze([
  'subjectId', 'targetId', 'currentValues', 'patch',
  'dimensionRules', 'evidence', 'ruleVersion',
]);

function unavailable(reason) {
  return Object.freeze({ status: 'unavailable', reason, read_only: true });
}

/**
 * Re-evaluate one persisted Relationship candidate snapshot without consulting
 * mutable projections/manifests and without writing to Core state.
 *
 * The caller must bind the snapshot to the event it was read from and supply
 * the target world's current World Pack identity/version. This function does
 * not load events or perform persistence; it is a pure read-side operation.
 */
export function reevaluateHistoricalRelationshipSnapshot(snapshot, context = {}) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return unavailable('snapshot_missing_or_invalid');
  }
  if (snapshot.schema !== 'relationship-evaluation-input/v1'
      || snapshot.evaluator_contract !== 'relationship-candidate/v1') {
    return unavailable('snapshot_contract_unsupported');
  }
  if (typeof context.eventId !== 'string' || !context.eventId
      || snapshot.originating_event_id !== context.eventId) {
    return unavailable('originating_event_binding_mismatch');
  }
  if (typeof context.worldPackId !== 'string' || !context.worldPackId
      || typeof context.worldPackVersion !== 'string' || !context.worldPackVersion
      || snapshot.world_pack_id !== context.worldPackId
      || snapshot.world_pack_version !== context.worldPackVersion) {
    return unavailable('world_pack_pin_mismatch');
  }
  if (typeof snapshot.rule_module_id !== 'string' || !snapshot.rule_module_id
      || typeof snapshot.rule_module_version !== 'string' || !snapshot.rule_module_version) {
    return unavailable('rule_module_pin_missing');
  }
  const input = snapshot.input;
  if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).length !== REQUIRED_INPUT_FIELDS.length
      || !REQUIRED_INPUT_FIELDS.every((key) => Object.prototype.hasOwnProperty.call(input, key))) {
    return unavailable('evaluation_input_incomplete');
  }
  if (input.ruleVersion !== snapshot.rule_module_id + '@' + snapshot.rule_module_version) {
    return unavailable('input_rule_pin_mismatch');
  }
  if (typeof snapshot.input_digest !== 'string'
      || !/^[a-f0-9]{64}$/.test(snapshot.input_digest)
      || hashRequest(input) !== snapshot.input_digest) {
    return unavailable('evaluation_input_digest_mismatch');
  }
  const artifact = resolveHistoricalRelationshipEvaluator(
    snapshot.rule_module_id,
    snapshot.rule_module_version,
  );
  if (!artifact) return unavailable('exact_evaluator_artifact_unavailable');
  if (artifact.evaluatorContract !== snapshot.evaluator_contract) {
    return unavailable('evaluator_contract_incompatible');
  }
  let candidate;
  try {
    candidate = artifact.evaluator(structuredClone(input));
  } catch {
    return unavailable('historical_evaluator_failed');
  }
  return Object.freeze({
    status: 'evaluated',
    read_only: true,
    originating_event_id: context.eventId,
    rule_module_id: artifact.ruleModuleId,
    rule_module_version: artifact.ruleModuleVersion,
    world_pack_id: snapshot.world_pack_id,
    world_pack_version: snapshot.world_pack_version,
    candidate,
  });
}
