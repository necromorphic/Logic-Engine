import { randomUUID } from 'node:crypto';
import { EngineError } from '../core/errors.js';
import { hashRequest } from '../core/request-hash.js';
import { evaluateConditionResult } from '../core/rules.js';
import { translateMechanicEffectIntents } from '../core/mechanic-effect-translator.js';

const obj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const plain = (v) => obj(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const actionIdPattern = /^[a-zA-Z][a-zA-Z0-9_.-]{0,95}$/;
const requestKeys = new Set(['action_id', 'action_input', 'context_manifest_id', 'expected_world_revision', 'expected_commit_sequence', 'event']);
const eventKeys = new Set(['turn_id', 'event_type', 'generation_id', 'source_message_id', 'time_advance_seconds', 'time_mode', 'caused_by', 'depends_on', 'read_set', 'causal_links']);
const contextKeys = new Set(['values', 'knownAbsentPaths']);

function boundedObject(value, label) {
  if (!plain(value)) throw new EngineError('INVALID_EVALUATION_INPUT', label + ' must be a plain object.');
  let json;
  try { json = JSON.stringify(value); } catch { throw new EngineError('INVALID_EVALUATION_INPUT', label + ' must be JSON-serializable.'); }
  if (json === undefined || json.length > 100000) throw new EngineError('INVALID_EVALUATION_INPUT', label + ' exceeds the bounded JSON size.');
}

function allRules(rules, context, knownAbsentPaths) {
  const details = rules.map((rule, index) => ({ index, ...evaluateConditionResult(rule, context, { knownAbsentPaths }) }));
  const status = details.some((x) => x.status === 'false') ? 'false'
    : details.some((x) => x.status === 'unknown') ? 'unknown' : 'true';
  return { status, details, unknown_paths: [...new Set(details.flatMap((x) => x.unknown_paths))].sort() };
}

function eventFromManifest(manifest, event) {
  const readSet = new Set(event.read_set);
  const links = [...event.causal_links];
  for (const item of manifest.items) {
    if (item.kind === 'entity') readSet.add('entity:' + item.target_id);
    else if (item.kind === 'fact') readSet.add('fact:' + item.target_id);
    else if (item.kind === 'event') links.push({ relation: 'READS_SOURCE', target_id: item.target_id });
    else if (item.kind === 'entity_absence') links.push({ relation: 'REQUIRES', predicate: { kind: 'entity_absent', entity_id: item.target_id } });
    else if (item.kind === 'fact_absence') links.push({ relation: 'REQUIRES', predicate: { kind: 'fact_absent', fact_id: item.target_id } });
    else throw new EngineError('INVALID_CONTEXT_MANIFEST', 'Unsupported context manifest item kind.');
  }
  const uniqueLinks = [];
  const seen = new Set();
  for (const link of links) {
    const key = hashRequest(link);
    if (!seen.has(key)) { seen.add(key); uniqueLinks.push(link); }
  }
  return { ...event, generation_id: event.generation_id ?? manifest.generation_id, read_set: [...readSet].sort(), causal_links: uniqueLinks };
}

export class MechanicEvaluationService {
  constructor(engine, { policyVersion = 'stage1.3-deterministic-slice-v1' } = {}) {
    if (!engine || typeof engine.getSnapshot !== 'function' || typeof engine.validateEvent !== 'function') {
      throw new EngineError('INVALID_EVALUATOR_DEPENDENCY', 'A LogicEngine with snapshot and validation APIs is required.');
    }
    if (typeof policyVersion !== 'string' || !policyVersion.trim() || policyVersion.length > 128) {
      throw new EngineError('INVALID_EVALUATOR_POLICY_VERSION', 'policyVersion must be a non-empty string of at most 128 characters.');
    }
    this.engine = engine;
    this.policyVersion = policyVersion;
  }

  evaluate(worldId, request, trustedContext) {
    try {
      if (typeof worldId !== 'string' || !worldId.trim() || worldId.length > 200) throw new EngineError('INVALID_WORLD_ID', 'worldId is invalid.');
      if (!plain(request) || Object.keys(request).some((key) => !requestKeys.has(key))) throw new EngineError('INVALID_EVALUATION_REQUEST', 'Unsupported evaluation request fields.');
      if (typeof request.action_id !== 'string' || !actionIdPattern.test(request.action_id)) throw new EngineError('INVALID_ACTION_ID', 'action_id is invalid.');
      if (typeof request.context_manifest_id !== 'string' || !request.context_manifest_id.trim() || request.context_manifest_id.length > 200) throw new EngineError('INVALID_CONTEXT_MANIFEST_ID', 'context_manifest_id is invalid.');
      for (const key of ['expected_world_revision', 'expected_commit_sequence']) {
        if (!Number.isSafeInteger(request[key]) || request[key] < 0) throw new EngineError('INVALID_SNAPSHOT_MARKER', key + ' must be a non-negative safe integer.');
      }
      if (!plain(request.event) || Object.keys(request.event).some((key) => !eventKeys.has(key))
        || !['turn_id', 'event_type'].every((key) => typeof request.event[key] === 'string' && request.event[key].trim() && request.event[key].length <= 200)) {
        throw new EngineError('INVALID_EVALUATION_EVENT', 'event must contain valid turn_id/event_type and only supported metadata fields.');
      }
      const event = {
        ...request.event,
        caused_by: request.event.caused_by ?? [],
        depends_on: request.event.depends_on ?? [],
        read_set: request.event.read_set ?? [],
        causal_links: request.event.causal_links ?? [],
      };
      if (!plain(trustedContext) || Object.keys(trustedContext).some((key) => !contextKeys.has(key))) throw new EngineError('INVALID_TRUSTED_CONTEXT', 'trustedContext must contain values and knownAbsentPaths only.');
      boundedObject(trustedContext.values, 'trustedContext.values');
      const knownAbsentPaths = trustedContext.knownAbsentPaths ?? [];
      if (!Array.isArray(knownAbsentPaths) || knownAbsentPaths.length > 1000 || !knownAbsentPaths.every((x) => typeof x === 'string' && x.trim())) throw new EngineError('INVALID_TRUSTED_CONTEXT', 'knownAbsentPaths must be an array of at most 1000 non-empty paths.');
      const actionInput = request.action_input ?? {};
      boundedObject(actionInput, 'action_input');

      const snapshot = this.engine.getSnapshot(worldId, { contextManifestIds: [request.context_manifest_id], includeMechanicEvaluationState: true });
      const marker = { world_revision: snapshot.world_revision, commit_sequence: snapshot.commit_sequence };
      const base = { snapshot: marker, context_manifest_id: request.context_manifest_id, applicable_candidates: [], matched_conditions: [], unknown_paths: [] };
      const finish = (value) => {
        const current = this.engine.getSnapshot(worldId);
        if (current.world_revision !== marker.world_revision || current.commit_sequence !== marker.commit_sequence) {
          return { ...base, outcome: 'rejected', reason_codes: ['STALE_SNAPSHOT'], diagnostics: ['World changed during evaluation.'] };
        }
        return value;
      };
      const result = (outcome, code, diagnostic, extra = {}) => finish({
        ...base, outcome, reason_codes: [code], diagnostics: [diagnostic.slice(0, 500)], ...extra,
      });
      if (snapshot.missing_context_manifest_ids.includes(request.context_manifest_id)) return result('unknown', 'CONTEXT_MANIFEST_MISSING', 'The required context manifest is not registered in this world.');
      if (snapshot.world_revision !== request.expected_world_revision || snapshot.commit_sequence !== request.expected_commit_sequence) return result('rejected', 'STALE_SNAPSHOT', 'Expected revision/cursor does not match the captured snapshot.');
      const manifest = snapshot.context_manifests.find((x) => x.manifest_id === request.context_manifest_id);
      if (!manifest) return result('unknown', 'CONTEXT_MANIFEST_MISSING', 'The required context manifest is missing.');
      if (manifest.base_world_revision !== marker.world_revision || manifest.base_commit_sequence !== marker.commit_sequence) return result('rejected', 'STALE_CONTEXT_MANIFEST', 'The context manifest is anchored to a different snapshot.');
      if (event.generation_id !== undefined && event.generation_id !== manifest.generation_id) return result('rejected', 'CONTEXT_GENERATION_MISMATCH', 'Event generation does not match the context manifest.');

      const mechanicState = snapshot.mechanic_evaluation_snapshot;
      const templates = new Map(mechanicState.templates.map((x) => [x.template.template_id + '@' + x.template.version, x]));
      const active = mechanicState.instances.filter((x) => x.status === 'enabled').sort((a, b) => a.instance_id.localeCompare(b.instance_id));
      const activeVersions = active.map((x) => ({ instance_id: x.instance_id, template_id: x.template_id, template_version: x.template_version }));
      const candidates = [];
      const uncertain = [];
      const matched = [];
      const unknownPaths = new Set();

      for (const instance of active) {
        const entry = templates.get(instance.template_id + '@' + instance.template_version);
        if (!entry) { uncertain.push({ instance_id: instance.instance_id, code: 'PINNED_TEMPLATE_MISSING' }); continue; }
        const template = entry.template;
        const action = template.actions.find((x) => x.action_id === request.action_id);
        if (!action) continue;

        const applicability = allRules(template.applicability, trustedContext.values, knownAbsentPaths);
        matched.push({ instance_id: instance.instance_id, phase: 'applicability', ...applicability });
        applicability.unknown_paths.forEach((x) => unknownPaths.add(x));
        if (applicability.status === 'false') continue;
        if (applicability.status === 'unknown') { uncertain.push({ instance_id: instance.instance_id, code: 'APPLICABILITY_UNKNOWN', unknown_paths: applicability.unknown_paths, policy: template.unknown_policy }); continue; }

        const unsupported = [];
        if (Object.keys(instance.parameters || {}).length || Object.keys(instance.state || {}).length) unsupported.push('INSTANCE_PARAMETERS_OR_STATE_UNSUPPORTED');
        if ((template.required_capabilities || []).length) unsupported.push('TEMPLATE_CAPABILITIES_UNSUPPORTED');
        if ((template.eligible_participants || []).length) unsupported.push('ELIGIBLE_PARTICIPANTS_UNSUPPORTED');
        if ((template.interactions || []).length) unsupported.push('TEMPLATE_INTERACTIONS_UNSUPPORTED');
        if ((template.rule_modules || []).length) unsupported.push('RULE_MODULE_EXECUTION_UNAVAILABLE');
        if (!plain(action.input_schema) || Object.keys(action.input_schema).length !== 1 || action.input_schema.type !== 'object') unsupported.push('ACTION_INPUT_SCHEMA_UNSUPPORTED');
        if (Object.keys(actionInput).length) unsupported.push('ACTION_INPUT_BINDING_UNSUPPORTED');
        if (action.ambiguity_policy !== 'deterministic_only') unsupported.push('ACTION_AMBIGUITY_POLICY_UNSUPPORTED');
        if (unsupported.length) { uncertain.push({ instance_id: instance.instance_id, code: 'UNSUPPORTED_MECHANIC_FEATURE', features: unsupported, policy: template.unknown_policy }); continue; }

        const preconditions = allRules(action.preconditions, trustedContext.values, knownAbsentPaths);
        const constraints = allRules(action.constraints || [], trustedContext.values, knownAbsentPaths);
        matched.push({ instance_id: instance.instance_id, phase: 'preconditions', ...preconditions });
        matched.push({ instance_id: instance.instance_id, phase: 'constraints', ...constraints });
        [...preconditions.unknown_paths, ...constraints.unknown_paths].forEach((x) => unknownPaths.add(x));
        if (preconditions.status === 'false' || constraints.status === 'false') continue;
        if (preconditions.status === 'unknown' || constraints.status === 'unknown') {
          uncertain.push({ instance_id: instance.instance_id, code: 'ACTION_CONDITION_UNKNOWN', unknown_paths: [...new Set([...preconditions.unknown_paths, ...constraints.unknown_paths])].sort(), policy: template.unknown_policy });
          continue;
        }
        if (!action.effects.length) continue;
        try {
          candidates.push({
            instance_id: instance.instance_id, template_id: template.template_id, template_version: template.version,
            template_hash: entry.template_hash, action_id: action.action_id, conflict_policy: template.conflict_policy,
            unknown_policy: template.unknown_policy, effects: translateMechanicEffectIntents(action.effects),
          });
        } catch (error) {
          uncertain.push({ instance_id: instance.instance_id, code: error?.code === 'UNSUPPORTED_MECHANIC_EFFECT_INTENT' ? 'EFFECT_TRANSLATION_UNSUPPORTED' : 'EFFECT_TRANSLATION_INVALID', policy: template.unknown_policy, blocking: error?.code !== 'UNSUPPORTED_MECHANIC_EFFECT_INTENT' });
        }
      }

      const fingerprintBase = {
        evaluator_version: 'stage1.3-deterministic-slice-v1', policy_version: this.policyVersion, world_id: worldId,
        snapshot: marker, context_manifest_id: manifest.manifest_id, context_manifest_hash: manifest.manifest_hash,
        action_id: request.action_id, action_input: actionInput, trusted_context: trustedContext.values,
        known_absent_paths: [...knownAbsentPaths].sort(), event_metadata: event, active_instances: activeVersions,
        template_hashes: mechanicState.templates.map((x) => ({ id: x.template.template_id, version: x.template.version, hash: x.template_hash })),
        module_manifests: mechanicState.modules.map((x) => ({ id: x.manifest.module_id, version: x.manifest.version, hash: x.manifest_hash })),
      };
      const fingerprint = (effects = []) => hashRequest({ ...fingerprintBase, proposed_effects: effects });

      if (uncertain.some((x) => x.blocking)) return result('rejected', 'INVALID_MECHANIC_EFFECT_INTENT', 'A potentially applicable mechanic contains an invalid effect intent.', {
        matched_conditions: matched, unknown_paths: [...unknownPaths].sort(), evaluation_details: uncertain, evaluation_fingerprint: fingerprint(candidates.flatMap((x) => x.effects)),
      });
      if (uncertain.length) {
        const blocked = uncertain.some((x) => x.policy === 'block');
        return result(blocked ? 'rejected' : 'unknown', blocked ? 'MECHANIC_UNKNOWN_POLICY_BLOCK' : 'MECHANIC_BEHAVIOR_UNSUPPORTED', 'The evaluator cannot safely determine every potentially applicable mechanic.', {
          applicable_candidates: candidates.map(({ effects, ...x }) => x), matched_conditions: matched,
          unknown_paths: [...unknownPaths].sort(), evaluation_details: uncertain, evaluation_fingerprint: fingerprint(candidates.flatMap((x) => x.effects)),
        });
      }
      if (!candidates.length) return result('no_match', 'NO_APPLICABLE_EFFECTS', 'No enabled supported mechanic produced applicable effects.', {
        matched_conditions: matched, unknown_paths: [...unknownPaths].sort(), evaluation_fingerprint: fingerprint(),
      });
      if (candidates.length > 1) {
        const automatic = candidates.some((x) => x.conflict_policy.mode === 'automatic');
        return result('unknown', automatic ? 'AUTOMATIC_RESOLVER_NOT_ALLOWLISTED' : 'MANUAL_CONFLICT_REVIEW_UNAVAILABLE',
          automatic ? 'Automatic conflict resolution requires an enabled host-allowlisted resolver.' : 'Manual conflict is unresolved; no candidate was selected and durable review storage is not implemented.', {
            applicable_candidates: candidates.map(({ effects, ...x }) => x), matched_conditions: matched,
            unknown_paths: [...unknownPaths].sort(), evaluation_fingerprint: fingerprint(candidates.flatMap((x) => x.effects)),
          });
      }

      const candidate = candidates[0];
      const proposalEvent = eventFromManifest(manifest, event);
      const eventToValidate = {
        ...proposalEvent, event_id: randomUUID(), idempotency_key: 'evaluation-preview:' + randomUUID(),
        expected_revision: marker.world_revision, context_manifest_id: manifest.manifest_id, effects: candidate.effects,
      };
      let validation;
      try { validation = this.engine.validateEvent(worldId, eventToValidate); } catch (error) {
        const stale = ['REVISION_CONFLICT', 'CONTEXT_SNAPSHOT_STALE'].includes(error?.code);
        return result('rejected', stale ? 'STALE_SNAPSHOT' : 'CANONICAL_EVENT_VALIDATION_FAILED',
          String(error?.message || 'Canonical event validation failed.'), {
            applicable_candidates: [{ instance_id: candidate.instance_id, template_id: candidate.template_id, template_version: candidate.template_version, action_id: candidate.action_id }],
            matched_conditions: matched, unknown_paths: [...unknownPaths].sort(),
            validation_errors: [{ code: error?.code || 'VALIDATION_FAILED', details: error?.details ?? null }],
            evaluation_fingerprint: fingerprint(candidate.effects),
          });
      }
      const proposedEvent = {
        turn_id: proposalEvent.turn_id, event_type: proposalEvent.event_type, generation_id: proposalEvent.generation_id,
        context_manifest_id: manifest.manifest_id, expected_revision: marker.world_revision,
        ...(proposalEvent.source_message_id ? { source_message_id: proposalEvent.source_message_id } : {}),
        ...(proposalEvent.time_advance_seconds !== undefined ? { time_advance_seconds: proposalEvent.time_advance_seconds } : {}),
        ...(proposalEvent.time_mode !== undefined ? { time_mode: proposalEvent.time_mode } : {}),
        caused_by: proposalEvent.caused_by, depends_on: proposalEvent.depends_on, read_set: proposalEvent.read_set,
        causal_links: proposalEvent.causal_links, effects: candidate.effects,
      };
      return finish({
        ...base, outcome: 'ready', reason_codes: ['DETERMINISTIC_MECHANIC_MATCH'],
        diagnostics: ['A single supported deterministic mechanic produced an effect set that passed canonical event validation.'],
        applicable_candidates: [{ instance_id: candidate.instance_id, template_id: candidate.template_id, template_version: candidate.template_version, action_id: candidate.action_id }],
        matched_conditions: matched, unknown_paths: [...unknownPaths].sort(), evaluation_fingerprint: fingerprint(candidate.effects),
        proposed_event: proposedEvent, validation_summary: { valid: validation?.valid ?? true },
      });
    } catch (error) {
      return {
        outcome: error instanceof EngineError ? 'rejected' : 'unknown',
        reason_codes: [error?.code || 'EVALUATION_INTERNAL_ERROR'],
        diagnostics: [String(error?.message || 'Mechanic evaluation failed.').slice(0, 500)],
        applicable_candidates: [], matched_conditions: [], unknown_paths: [],
      };
    }
  }
}
