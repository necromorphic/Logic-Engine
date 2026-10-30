import { hashRequest } from '../core/request-hash.js';
import { resolveHistoricalRelationshipEvaluator } from './historical-evaluator-registry.js';

const SNAPSHOT_FIELDS = Object.freeze([
  'originating_event_id', 'schema', 'evaluator_contract',
  'rule_module_id', 'rule_module_version', 'world_pack_id',
  'world_pack_version', 'input', 'input_digest', 'snapshot_digest',
]);
const INPUT_FIELDS = Object.freeze([
  'subjectId', 'targetId', 'currentValues', 'patch',
  'dimensionRules', 'evidence', 'ruleVersion',
]);

function unavailable(reason) {
  return Object.freeze({ status: 'unavailable', reason, read_only: true });
}

/** Re-evaluate a persisted Relationship candidate snapshot without mutable inputs or writes. */
export function reevaluateHistoricalRelationshipSnapshot(snapshot, context = {}) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return unavailable('snapshot_missing_or_invalid');
  if (Object.keys(snapshot).length !== SNAPSHOT_FIELDS.length
      || !SNAPSHOT_FIELDS.every((key) => Object.prototype.hasOwnProperty.call(snapshot, key))) return unavailable('snapshot_shape_unsupported');
  if (snapshot.schema !== 'relationship-evaluation-input/v2'
      || snapshot.evaluator_contract !== 'relationship-candidate/v1') return unavailable('snapshot_contract_unsupported');
  if (typeof context.eventId !== 'string' || !context.eventId
      || snapshot.originating_event_id !== context.eventId) return unavailable('originating_event_binding_mismatch');
  if (typeof snapshot.world_pack_id !== 'string' || !snapshot.world_pack_id.trim()
      || typeof snapshot.world_pack_version !== 'string' || !snapshot.world_pack_version.trim()) return unavailable('world_pack_pin_missing');
  if (typeof snapshot.rule_module_id !== 'string' || !snapshot.rule_module_id.trim()
      || typeof snapshot.rule_module_version !== 'string' || !snapshot.rule_module_version.trim()) return unavailable('rule_module_pin_missing');
  const { snapshot_digest: suppliedSnapshotDigest, ...snapshotEnvelope } = snapshot;
  if (typeof suppliedSnapshotDigest !== 'string' || !/^[a-f0-9]{64}$/.test(suppliedSnapshotDigest)
      || hashRequest(snapshotEnvelope) !== suppliedSnapshotDigest) return unavailable('evaluation_snapshot_digest_mismatch');
  const input = snapshot.input;
  if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).length !== INPUT_FIELDS.length
      || !INPUT_FIELDS.every((key) => Object.prototype.hasOwnProperty.call(input, key))) return unavailable('evaluation_input_incomplete');
  if (typeof snapshot.input_digest !== 'string' || !/^[a-f0-9]{64}$/.test(snapshot.input_digest)
      || hashRequest(input) !== snapshot.input_digest) return unavailable('evaluation_input_digest_mismatch');
  if (input.ruleVersion !== snapshot.rule_module_id + '@' + snapshot.rule_module_version) return unavailable('input_rule_pin_mismatch');
  const artifact = resolveHistoricalRelationshipEvaluator(snapshot.rule_module_id, snapshot.rule_module_version);
  if (!artifact) return unavailable('exact_evaluator_artifact_unavailable');
  if (artifact.evaluatorContract !== snapshot.evaluator_contract) return unavailable('evaluator_contract_incompatible');
  let candidate;
  try { candidate = artifact.evaluator(structuredClone(input)); } catch { return unavailable('historical_evaluator_failed'); }
  return Object.freeze({
    status: 'evaluated', read_only: true, originating_event_id: context.eventId,
    rule_module_id: artifact.ruleModuleId, rule_module_version: artifact.ruleModuleVersion,
    world_pack_id: snapshot.world_pack_id, world_pack_version: snapshot.world_pack_version, candidate,
  });
}
