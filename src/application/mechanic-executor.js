import { EngineError } from '../core/errors.js';
import { hashRequest } from '../core/request-hash.js';
import { evaluateMechanicActionConditions } from '../core/mechanics.js';
import { translateMechanicEffectIntents } from '../core/mechanic-effect-translator.js';
import { collectConditionDependencies } from '../core/rules.js';
import { attestMechanicEvaluation } from './mechanic-evaluation-attestation.js';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function isCanonicalJsonValue(value, active = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || active.has(value)) return false;
  active.add(value);
  let valid = true;
  if (Array.isArray(value)) {
    const keys = Object.keys(value);
    valid = keys.length === value.length
      && Object.getOwnPropertyNames(value).length === value.length + 1
      && keys.every((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return /^\d+$/.test(key) && Number(key) < value.length
          && descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value')
          && isCanonicalJsonValue(descriptor.value, active);
      });
  } else {
    const prototype = Object.getPrototypeOf(value);
    const keys = Object.keys(value);
    valid = (prototype === Object.prototype || prototype === null)
      && Object.getOwnPropertySymbols(value).length === 0
      && Object.getOwnPropertyNames(value).length === keys.length
      && keys.every((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return !['__proto__', 'constructor', 'prototype'].includes(key)
          && descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value')
          && isCanonicalJsonValue(descriptor.value, active);
      });
  }
  active.delete(value);
  return valid;
}

function readPath(root, path) {
  let value = root;
  for (const segment of path.split('.')) {
    if (!segment || ['__proto__', 'constructor', 'prototype'].includes(segment)
      || value === null || typeof value !== 'object' || !Object.hasOwn(value, segment)) return { exists: false };
    value = value[segment];
  }
  return { exists: true, value };
}

function canonicalUnique(values) {
  return [...new Map(values.map((value) => [JSON.stringify(value), value])).values()]
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function deepFreezeSnapshot(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Object.keys(value)) deepFreezeSnapshot(value[key], seen);
  return Object.freeze(value);
}
const unknown = (reasonCode, reason, identity = null) => ({
  status: 'unknown',
  reason_code: reasonCode,
  reason,
  ...(identity ? { snapshot_identity: identity } : {}),
  effects: [],
  effect_provenance: [],
});

function snapshotIdentity(worldId, snapshot, instance, templateEntry, activeMechanicSet = []) {
  return {
    world_id: worldId,
    world_revision: snapshot.world_revision,
    commit_sequence: snapshot.commit_sequence,
    instance_id: instance.instance_id,
    template_id: instance.template_id,
    template_version: instance.template_version,
    template_hash: templateEntry.template_hash,
    active_mechanic_set: activeMechanicSet,
  };
}

/**
 * Small application-layer executor slice. It is deliberately opt-in and read-only.
 * A trusted host must provide context already filtered for the intended actor and
 * recipient, and attest that it was built from this exact snapshot revision/cursor.
 * This slice rejects modules, participant selection, interactions, non-empty action
 * input schemas, and non-deterministic ambiguity policies rather than guessing.
 */
export class MechanicExecutor {
  constructor(engine, { resolveAuthorizedContext } = {}) {
    if (!engine || typeof engine.getSnapshot !== 'function') throw new TypeError('MechanicExecutor requires a LogicEngine');
    if (resolveAuthorizedContext !== undefined && typeof resolveAuthorizedContext !== 'function') {
      throw new TypeError('resolveAuthorizedContext must be a trusted function');
    }
    this.engine = engine;
    this.resolveAuthorizedContext = resolveAuthorizedContext ?? null;
  }

  evaluate({ worldId, instanceId, actionId, input = {} }) {
    if (typeof worldId !== 'string' || !worldId.trim()
      || typeof instanceId !== 'string' || !instanceId.trim()
      || typeof actionId !== 'string' || !actionId.trim()) {
      throw new EngineError('INVALID_MECHANIC_EVALUATION_REQUEST', 'worldId, instanceId, and actionId are required.');
    }
    if (!object(input) || !isCanonicalJsonValue(input)) {
      throw new EngineError('INVALID_MECHANIC_ACTION_INPUT', 'Action input must be a plain canonical JSON object.');
    }

    const snapshot = deepFreezeSnapshot(this.engine.getSnapshot(worldId, { includeMechanicEvaluationState: true }));
    const state = snapshot.mechanic_evaluation_snapshot;
    const instance = state.instances.find((candidate) => candidate.instance_id === instanceId);
    if (!instance) return { status: 'rejected', reason_code: 'MECHANIC_INSTANCE_NOT_FOUND', effects: [], effect_provenance: [] };
    if (instance.status !== 'enabled') return { status: 'rejected', reason_code: 'MECHANIC_INSTANCE_NOT_ENABLED', effects: [], effect_provenance: [] };

    const templateEntry = state.templates.find(({ template }) =>
      template.template_id === instance.template_id && template.version === instance.template_version);
    if (!templateEntry) {
      return unknown('PINNED_TEMPLATE_NOT_FOUND', 'The exact pinned template is absent from the evaluation snapshot.');
    }
    const template = templateEntry.template;
    const activeMechanicInstances = state.instances
      .filter((candidate) => candidate.status === 'enabled' || candidate.status === 'needs_review')
      .sort((a, b) => a.instance_id.localeCompare(b.instance_id));
    const activeMechanicSet = [];
    for (const candidate of activeMechanicInstances) {
      const entry = state.templates.find(({ template: candidateTemplate }) =>
        candidateTemplate.template_id === candidate.template_id
        && candidateTemplate.version === candidate.template_version);
      if (!entry) {
        return unknown('ACTIVE_MECHANIC_TEMPLATE_NOT_FOUND',
          'An enabled or review-required mechanic references a missing pinned template.');
      }
      activeMechanicSet.push({
        instance_id: candidate.instance_id,
        status: candidate.status,
        template_id: candidate.template_id,
        template_version: candidate.template_version,
        template_hash: entry.template_hash,
      });
    }
    const identity = snapshotIdentity(worldId, snapshot, instance, templateEntry, activeMechanicSet);
    const action = template.actions.find((candidate) => candidate.action_id === actionId);
    if (!action) return { status: 'rejected', reason_code: 'MECHANIC_ACTION_NOT_FOUND', snapshot_identity: identity, effects: [], effect_provenance: [] };
    const instanceParameters = instance.parameters;
    const instanceState = instance.state;
    if (!object(instanceParameters) || Object.keys(instanceParameters).length > 0
      || !object(instanceState) || Object.keys(instanceState).length > 0) {
      return unknown('UNSUPPORTED_INSTANCE_PARAMETERS_OR_STATE',
        'This executor slice does not bind or interpret instance parameters or mutable instance state.', identity);
    }
    if (activeMechanicSet.length > 1) {
      return unknown('UNSUPPORTED_MULTIPLE_ACTIVE_MECHANICS',
        'This executor slice requires a single enabled/review-required mechanic because cross-mechanic interaction and conflict completeness is not implemented.', identity);
    }
    if (template.unknown_policy !== 'mark_unknown') {
      return unknown('UNSUPPORTED_UNKNOWN_POLICY',
        'This executor slice supports only unknown_policy=mark_unknown.', identity);
    }

    // Read the current projection only for internal dependency/target checks.
    // It is not returned to callers or passed to the context provider. Its cursor
    // must exactly match the pinned mechanic snapshot.
    const targetState = this.engine.getState(worldId);
    if (targetState.world_revision !== snapshot.world_revision || targetState.commit_sequence !== snapshot.commit_sequence) {
      return unknown('SNAPSHOT_CHANGED_DURING_PREPARATION', 'World revision or commit sequence changed while resolving literal effect targets.', identity);
    }
    const targetEntities = targetState.entities;
    const targetFacts = targetState.facts;
    let conditionDependencyPaths;
    try {
      conditionDependencyPaths = [...new Set([
        ...template.applicability,
        ...action.preconditions,
        ...(action.constraints ?? []),
      ].flatMap((rule) => collectConditionDependencies(rule)))].sort();
    } catch {
      return unknown('MECHANIC_DEPENDENCY_ANALYSIS_FAILED', 'Condition dependencies could not be established safely.', identity);
    }

    if ((template.required_capabilities?.length ?? 0) > 0) {
      return unknown('UNSUPPORTED_MECHANIC_CAPABILITIES', 'This executor slice has no capability grant/authorization contract for mechanic-required capabilities.', identity);
    }
    if ((template.rule_modules?.length ?? 0) > 0 || template.conflict_policy?.mode !== 'manual') {
      return unknown('UNSUPPORTED_MECHANIC_MODULE_OR_CONFLICT_POLICY', 'This executor slice does not invoke registered modules or automatic conflict resolvers.', identity);
    }
    if ((template.eligible_participants?.length ?? 0) > 0
      || (template.participant_constraints?.length ?? 0) > 0
      || (template.interactions?.length ?? 0) > 0) {
      return unknown('UNSUPPORTED_PARTICIPANT_OR_INTERACTION_POLICY', 'Participant selection and mechanic interactions are not implemented in this executor slice.', identity);
    }
    if (action.ambiguity_policy !== 'deterministic_only') {
      return unknown('UNSUPPORTED_ACTION_AMBIGUITY_POLICY', 'Only deterministic_only actions are supported.', identity);
    }
    if (Object.keys(action.input_schema).length !== 1 || action.input_schema.type !== 'object' || Object.keys(input).length > 0) {
      return unknown('UNSUPPORTED_ACTION_INPUT_SCHEMA', 'This slice supports only an empty object action input with input_schema { type: object }.', identity);
    }
    if (!this.resolveAuthorizedContext) {
      return unknown('TRUSTED_CONTEXT_PROVIDER_REQUIRED', 'No trusted context provider is configured; raw snapshot fields are not exposed to condition evaluation.', identity);
    }

    let resolved;
    try {
      resolved = this.resolveAuthorizedContext({ worldId, snapshot, instance, template, action });
    } catch (error) {
      return unknown('AUTHORIZED_CONTEXT_RESOLUTION_FAILED', 'Trusted context resolution failed; details are withheld.', identity);
    }

    // The provider is host code and may take time or trigger concurrent work.
    // Snapshot markers on its return value are assertions, not proof that the
    // world stayed at that revision while authorization and projection ran.
    // Re-read the canonical cursor after the provider returns; proposal handoff
    // still performs its own transactional stale-snapshot check.
    let postProviderState;
    try {
      postProviderState = this.engine.getState(worldId);
    } catch {
      return unknown('SNAPSHOT_FRESHNESS_CHECK_FAILED', 'The evaluation snapshot could not be revalidated after context resolution.', identity);
    }
    if (postProviderState.world_revision !== snapshot.world_revision
      || postProviderState.commit_sequence !== snapshot.commit_sequence) {
      return unknown('SNAPSHOT_CHANGED_DURING_CONTEXT_RESOLUTION', 'World revision or commit sequence changed while resolving authorized context.', identity);
    }

    const allowedResolvedKeys = new Set(['context', 'world_revision', 'commit_sequence', 'policy_version', 'authorization_scope', 'knownAbsentPaths', 'dependencyEvidence', 'policy_authority']);
    let resolvedShapeValid = false;
    try {
      resolvedShapeValid = object(resolved)
        && isCanonicalJsonValue(resolved)
        && Object.keys(resolved).every((key) => allowedResolvedKeys.has(key))
        && object(resolved.context);
    } catch {
      // Host-supplied proxies or reflective traps are not accepted as canonical data.
    }
    if (!resolvedShapeValid) {
      return unknown('INVALID_AUTHORIZED_CONTEXT', 'Trusted context must be a strict canonical JSON object with no unsupported fields or accessors.', identity);
    }
    if (resolved.world_revision !== snapshot.world_revision
      || resolved.commit_sequence !== snapshot.commit_sequence
      || typeof resolved.policy_version !== 'string' || !resolved.policy_version.trim()
      || typeof resolved.authorization_scope !== 'string' || !resolved.authorization_scope.trim()
      || !Array.isArray(resolved.knownAbsentPaths ?? [])
      || !(resolved.knownAbsentPaths ?? []).every((path) => typeof path === 'string' && path.trim())
      || !Array.isArray(resolved.dependencyEvidence)
      || (resolved.policy_authority !== undefined
        && (!object(resolved.policy_authority)
          || Object.keys(resolved.policy_authority).some((key) => !['authority_identity', 'policy_generation', 'policy_version'].includes(key))
          || typeof resolved.policy_authority.authority_identity !== 'string' || !resolved.policy_authority.authority_identity.trim()
          || typeof resolved.policy_authority.policy_generation !== 'string' || !resolved.policy_authority.policy_generation.trim()
          || typeof resolved.policy_authority.policy_version !== 'string' || !resolved.policy_authority.policy_version.trim()))) {
      return unknown('AUTHORIZED_CONTEXT_SNAPSHOT_MISMATCH', 'Trusted context must identify the exact snapshot, policy version, and canonical dependency evidence.', identity);
    }

    const knownAbsentPaths = [...new Set(resolved.knownAbsentPaths ?? [])].sort();
    if (knownAbsentPaths.some((path) => !conditionDependencyPaths.includes(path))) {
      return unknown('INVALID_KNOWN_ABSENCE_SCOPE', 'Known-absence assertions must refer only to declared condition paths.', identity);
    }
    const evidenceByPath = new Map();
    for (const evidence of resolved.dependencyEvidence) {
      if (!object(evidence) || Object.keys(evidence).some((key) => !['path', 'kind', 'entity_id', 'attribute'].includes(key))
        || typeof evidence.path !== 'string' || !evidence.path.trim()
        || evidenceByPath.has(evidence.path) || evidence.kind !== 'entity_attribute'
        || typeof evidence.entity_id !== 'string' || !evidence.entity_id.trim()
        || typeof evidence.attribute !== 'string' || !evidence.attribute.trim()) {
        return unknown('INVALID_DEPENDENCY_EVIDENCE', 'Dependency evidence must uniquely map condition paths to canonical entity attributes.', identity);
      }
      evidenceByPath.set(evidence.path, evidence);
    }
    if (conditionDependencyPaths.some((path) => !evidenceByPath.has(path))
      || [...evidenceByPath.keys()].some((path) => !conditionDependencyPaths.includes(path))) {
      return unknown('DEPENDENCY_EVIDENCE_INCOMPLETE', 'Every declared condition path must have exactly one canonical read-evidence mapping.', identity);
    }

    const readSet = new Set();
    const causalLinks = [];
    for (const path of conditionDependencyPaths) {
      const evidence = evidenceByPath.get(path);
      const entity = targetEntities.find((candidate) => candidate.entity_id === evidence.entity_id && candidate.status !== 'destroyed');
      if (!entity || !object(entity.attributes)) {
        return unknown('DEPENDENCY_EVIDENCE_TARGET_NOT_FOUND', 'A condition dependency target is not present as a canonical entity in this snapshot.', identity);
      }
      const contextValue = readPath(resolved.context, path);
      const attributeExists = Object.hasOwn(entity.attributes, evidence.attribute);
      const knownAbsent = knownAbsentPaths.includes(path);
      if (attributeExists) {
        if (knownAbsent || !contextValue.exists || hashRequest(contextValue.value) !== hashRequest(entity.attributes[evidence.attribute])) {
          return unknown('DEPENDENCY_EVIDENCE_VALUE_MISMATCH', 'Authorized context does not match its canonical entity-attribute evidence.', identity);
        }
      } else if (!knownAbsent || contextValue.exists) {
        return unknown('DEPENDENCY_EVIDENCE_ABSENCE_UNPROVEN', 'Missing context attributes require a same-snapshot canonical absence assertion.', identity);
      }
      readSet.add('entity:' + entity.entity_id);
      causalLinks.push({ relation: 'READS_ENTITY', target_id: entity.entity_id });
    }

    let conditionResult;
    try {
      conditionResult = evaluateMechanicActionConditions(template, actionId, resolved.context, {
        knownAbsentPaths,
      });
    } catch (error) {
      return unknown('MECHANIC_CONDITION_EVALUATION_FAILED', 'Condition evaluation failed closed; details are retained only in host-side diagnostics.', identity);
    }
    if (conditionResult.status !== 'true') {
      return {
        status: conditionResult.status === 'false' ? 'no_match' : 'unknown',
        reason_code: conditionResult.reason_code,
        snapshot_identity: identity,
        condition_result: conditionResult,
        effects: [],
        effect_provenance: [],
      };
    }

    if (action.effects.length === 0) {
      return { status: 'no_match', reason_code: 'MECHANIC_ACTION_HAS_NO_EFFECTS', snapshot_identity: identity, condition_result: conditionResult, effects: [], effect_provenance: [] };
    }

    let translated;
    try {
      const effects = translateMechanicEffectIntents(action.effects);
      translated = {
        status: 'ready',
        effects,
        effect_provenance: action.effects.map((intent, index) => ({
          effect_index: index,
          action_id: action.action_id,
          intent_index: index,
          effect_id: intent.effect_id,
          intent_kind: intent.kind,
          target_ref: intent.target_ref,
        })),
      };
    } catch {
      return unknown('MECHANIC_EFFECT_TRANSLATION_FAILED', 'Mechanic effect intents failed canonical translation; details are withheld.', identity);
    }
    if (translated.effects.length === 0) {
      return {
        status: 'no_match',
        reason_code: 'MECHANIC_ACTION_HAS_NO_EFFECTS',
        snapshot_identity: identity,
        condition_result: conditionResult,
        effects: [],
        effect_provenance: [],
      };
    }

    const entityById = new Map(targetEntities.map((entity) => [entity.entity_id, entity]));
    const existingEntities = new Set(entityById.keys());
    const existingFacts = new Map(targetFacts.map((fact) => [fact.fact_id, fact]));
    const createdEntities = new Set();
    const entityStatusAfterEffects = new Map();
    const writtenEntityIds = new Set();
    const writtenFactIds = new Set();
    for (const effect of translated.effects) {
      if (effect.kind === 'entity.create' || effect.kind === 'entity.update') {
        if (writtenEntityIds.has(effect.entity_id)) {
          return unknown('MECHANIC_EFFECT_WRITE_CONFLICT', 'Core event semantics allow at most one entity effect per entity in a proposal.', identity);
        }
        writtenEntityIds.add(effect.entity_id);
      }
      if (effect.kind === 'fact.set') {
        if (writtenFactIds.has(effect.fact_id)) {
          return unknown('MECHANIC_EFFECT_WRITE_CONFLICT', 'Core event semantics allow at most one fact effect per fact in a proposal.', identity);
        }
        writtenFactIds.add(effect.fact_id);
      }
      if (effect.kind === 'entity.create') {
        if (existingEntities.has(effect.entity_id) || createdEntities.has(effect.entity_id)) {
          return unknown('MECHANIC_EFFECT_TARGET_ALREADY_EXISTS', 'A create_entity target already exists in the snapshot or earlier in this effect batch.', identity);
        }
        createdEntities.add(effect.entity_id);
        entityStatusAfterEffects.set(effect.entity_id, effect.status ?? 'active');
      } else if (effect.kind === 'entity.update') {
        const target = entityById.get(effect.entity_id);
        if (!target || target.status === 'destroyed') {
          return unknown('MECHANIC_EFFECT_TARGET_NOT_FOUND', 'An update_attribute target must be an existing, non-destroyed entity in the same-world snapshot.', identity);
        }
        entityStatusAfterEffects.set(effect.entity_id, effect.status ?? target.status);
      } else if (effect.kind === 'fact.set') {
        const existingFact = existingFacts.get(effect.fact_id);
        if (existingFact
          && ((existingFact.subject_ref ?? null) !== (effect.subject_ref ?? null)
            || existingFact.predicate !== effect.predicate)) {
          return unknown('MECHANIC_EFFECT_FACT_IDENTITY_MISMATCH',
            'An existing fact ID cannot be reused with a different subject or predicate.', identity);
        }
        if (effect.subject_ref !== undefined && effect.subject_ref !== null) {
          const subject = entityById.get(effect.subject_ref);
          const effectiveStatus = entityStatusAfterEffects.has(effect.subject_ref)
            ? entityStatusAfterEffects.get(effect.subject_ref)
            : subject?.status;
          if (effectiveStatus === undefined || effectiveStatus === 'destroyed') {
            return unknown('MECHANIC_EFFECT_SUBJECT_NOT_FOUND',
              'An assert_fact subject_ref must identify a non-destroyed entity at the point the fact effect is applied.', identity);
          }
        }
      }
    }

    const effectTargetDependencies = translated.effects.flatMap((effect) => {
      if (effect.kind === 'entity.create') return [{ kind: 'entity_absence', target_id: effect.entity_id }];
      if (effect.kind === 'entity.update') return [{ kind: 'entity_exists', target_id: effect.entity_id }];
      if (effect.kind === 'fact.set') {
        const existingFact = existingFacts.get(effect.fact_id);
        const dependencies = [{
          kind: existingFact ? 'fact_exists' : 'fact_absence',
          target_id: effect.fact_id,
        }];
        if (existingFact) dependencies.push({
          kind: 'fact_identity',
          target_id: effect.fact_id,
          subject_ref: existingFact.subject_ref ?? null,
          predicate: existingFact.predicate,
        });
        if (effect.subject_ref) dependencies.push({
          kind: createdEntities.has(effect.subject_ref) ? 'entity_created_in_action' : 'entity_exists',
          target_id: effect.subject_ref,
        });
        return dependencies;
      }
      return [];
    }).sort((a, b) => a.kind.localeCompare(b.kind) || a.target_id.localeCompare(b.target_id));

    for (const effect of translated.effects) {
      if (effect.kind === 'entity.create') {
        causalLinks.push({ relation: 'REQUIRES', predicate: { kind: 'entity_absent', entity_id: effect.entity_id } });
      } else if (effect.kind === 'entity.update') {
        readSet.add('entity:' + effect.entity_id);
        causalLinks.push({ relation: 'READS_ENTITY', target_id: effect.entity_id });
        causalLinks.push({ relation: 'REQUIRES', predicate: { kind: 'entity_exists', entity_id: effect.entity_id } });
      } else if (effect.kind === 'fact.set') {
        const currentFact = targetFacts.find((fact) => fact.fact_id === effect.fact_id);
        if (currentFact) {
          readSet.add('fact:' + effect.fact_id);
          causalLinks.push({ relation: 'READS_CLAIM', target_id: effect.fact_id });
        } else {
          causalLinks.push({ relation: 'REQUIRES', predicate: { kind: 'fact_absent', fact_id: effect.fact_id } });
        }
        if (effect.subject_ref && !createdEntities.has(effect.subject_ref)) {
          readSet.add('entity:' + effect.subject_ref);
          causalLinks.push({ relation: 'READS_ENTITY', target_id: effect.subject_ref });
          causalLinks.push({ relation: 'REQUIRES', predicate: { kind: 'entity_exists', entity_id: effect.subject_ref } });
        }
      }
    }
    const normalizedReadSet = [...readSet].sort();
    const normalizedCausalLinks = canonicalUnique(causalLinks);
    const dependencyManifest = {
      scope: 'bounded_deterministic_action_v1',
      global_mechanic_dependencies_complete: false,
      condition_paths: conditionDependencyPaths,
      condition_ast_dependencies_complete: true,
      context_projection_dependencies_complete: true,
      effect_target_dependencies: effectTargetDependencies,
      effect_target_dependencies_complete: true,
      causal_read_set_complete_for_supported_slice: true,
      mechanic_dependencies_complete: true,
      active_mechanic_set_pinned: true,
      active_mechanic_set_scope: 'enabled_and_needs_review_instances',
      supported_active_mechanic_set: 'single_enabled_instance_only',
      supported_instance_data: 'empty_parameters_and_state_only',
      supported_action_input: 'empty_object_only',
      supported_unknown_policy: 'mark_unknown',
      unsupported_sources: [
        'non_empty_instance_parameters',
        'non_empty_instance_state',
        'non_empty_action_input',
        'non_mark_unknown_policy',
        'registered_module_inputs_and_reads',
        'required_capabilities',
        'participant_selection_and_constraints',
        'interaction_conditions',
        'automatic_conflict_resolution',
        'multiple_active_mechanics_and_cross_mechanic_conflicts',
        'fact_or_time_condition_projections',
      ],
      unresolved_sources: [],
      assumptions: [
        'trusted_provider_correctly_maps_condition_paths_to_canonical_attributes',
        ...(resolved.policy_authority ? ['deployment_changes_policy_generation_when_effective_policy_changes'] : []),
      ],
    };
    let contextFingerprint;
    try {
      contextFingerprint = hashRequest({
        context: resolved.context,
        knownAbsentPaths,
        dependency_evidence: [...resolved.dependencyEvidence].sort((a, b) => a.path.localeCompare(b.path)),
        policy_version: resolved.policy_version,
        policy_authority: resolved.policy_authority ?? null,
        authorization_scope: resolved.authorization_scope,
      });
    } catch {
      return unknown('AUTHORIZED_CONTEXT_NOT_FINGERPRINTABLE', 'Trusted context is not a canonical JSON value; evaluation failed closed.', identity);
    }
    const evaluationIdentity = {
      snapshot_identity: identity,
      action_id: actionId,
      context_fingerprint: contextFingerprint,
      context_policy_version: resolved.policy_version,
      ...(resolved.policy_authority ? { policy_authority: resolved.policy_authority } : {}),
      authorization_scope: resolved.authorization_scope,
      condition_result: conditionResult,
      dependency_manifest: dependencyManifest,
      effects: translated.effects,
      effect_provenance: translated.effect_provenance,
      read_set: normalizedReadSet,
      causal_links: normalizedCausalLinks,
    };
    const readyEvaluation = {
      status: 'ready',
      reason_code: null,
      ...evaluationIdentity,
      evaluation_fingerprint: hashRequest(evaluationIdentity),
      commit_authority: 'none',
      guarantees: {
        read_only: true,
        context_provider_attested_snapshot: true,
        context_policy_versioned: true,
        complete_mechanic_dependencies: true,
        complete_global_mechanic_dependencies: false,
        proposal_created: false,
        canonical_state_mutated: false,
      },
    };
    return attestMechanicEvaluation(deepFreezeSnapshot(readyEvaluation));
  }
}
