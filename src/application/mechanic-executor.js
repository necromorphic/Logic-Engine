import { EngineError } from '../core/errors.js';
import { hashRequest } from '../core/request-hash.js';
import { evaluateMechanicActionConditions, translateMechanicEffectIntents } from '../core/mechanics.js';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

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

function snapshotIdentity(worldId, snapshot, instance, templateEntry) {
  return {
    world_id: worldId,
    world_revision: snapshot.world_revision,
    commit_sequence: snapshot.commit_sequence,
    instance_id: instance.instance_id,
    template_id: instance.template_id,
    template_version: instance.template_version,
    template_hash: templateEntry.template_hash,
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
    if (!object(input)) throw new EngineError('INVALID_MECHANIC_ACTION_INPUT', 'Action input must be an object.');

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
    const identity = snapshotIdentity(worldId, snapshot, instance, templateEntry);
    const action = template.actions.find((candidate) => candidate.action_id === actionId);
    if (!action) return { status: 'rejected', reason_code: 'MECHANIC_ACTION_NOT_FOUND', snapshot_identity: identity, effects: [], effect_provenance: [] };

    // The public snapshot API intentionally rejects missing requested IDs, so
    // use the existing consistent state projection internally for existence
    // checks. It is never passed to the context provider or returned to callers.
    // Require the same revision/cursor as the mechanic snapshot to avoid mixing
    // two different world states.
    const entityIds = [...new Set(action.effects.flatMap((effect) => {
      if (['create_entity', 'update_attribute'].includes(effect.kind)) return [effect.target_ref];
      if (effect.kind === 'assert_fact' && typeof effect.payload?.subject_ref === 'string' && effect.payload.subject_ref.trim()) {
        return [effect.payload.subject_ref];
      }
      return [];
    }))];
    let targetEntities = [];
    if (entityIds.length) {
      const targetState = this.engine.getState(worldId);
      if (targetState.world_revision !== snapshot.world_revision || targetState.commit_sequence !== snapshot.commit_sequence) {
        return unknown('SNAPSHOT_CHANGED_DURING_PREPARATION', 'World revision or commit sequence changed while resolving literal effect targets.', identity);
      }
      targetEntities = targetState.entities;
    }

    if ((template.rule_modules?.length ?? 0) > 0 || template.conflict_policy?.mode !== 'manual') {
      return unknown('UNSUPPORTED_MECHANIC_MODULE_OR_CONFLICT_POLICY', 'This executor slice does not invoke registered modules or automatic conflict resolvers.', identity);
    }
    if ((template.eligible_participants?.length ?? 0) > 0 || (template.interactions?.length ?? 0) > 0) {
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
      return unknown('AUTHORIZED_CONTEXT_RESOLUTION_FAILED', 'Trusted context resolution failed; details are retained only in host-side diagnostics.', identity);
    }
    if (!object(resolved) || !object(resolved.context)
      || resolved.world_revision !== snapshot.world_revision
      || resolved.commit_sequence !== snapshot.commit_sequence
      || typeof resolved.policy_version !== 'string' || !resolved.policy_version.trim()
      || !Array.isArray(resolved.knownAbsentPaths ?? [])
      || !(resolved.knownAbsentPaths ?? []).every((path) => typeof path === 'string' && path.trim())) {
      return unknown('AUTHORIZED_CONTEXT_SNAPSHOT_MISMATCH', 'Trusted context must identify the exact world revision and commit sequence and policy version used by this evaluation.', identity);
    }

    const knownAbsentPaths = [...new Set(resolved.knownAbsentPaths ?? [])].sort();
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

    const translated = translateMechanicEffectIntents(template, actionId);
    if (translated.status !== 'ready') {
      return { ...translated, snapshot_identity: identity, condition_result: conditionResult, effects: [], effect_provenance: [] };
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

    const existingEntities = new Set(targetEntities.map((entity) => entity.entity_id));
    const createdEntities = new Set();
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
      } else if (effect.kind === 'entity.update') {
        if (!existingEntities.has(effect.entity_id)) {
          return unknown('MECHANIC_EFFECT_TARGET_NOT_FOUND', 'An update_attribute target must exist in the same-world snapshot.', identity);
        }
      } else if (effect.kind === 'fact.set' && effect.subject_ref !== undefined && effect.subject_ref !== null) {
        if (!existingEntities.has(effect.subject_ref) && !createdEntities.has(effect.subject_ref)) {
          return unknown('MECHANIC_EFFECT_SUBJECT_NOT_FOUND', 'An assert_fact subject_ref must identify an entity in this world or an entity created earlier in this action.', identity);
        }
      }
    }

    let contextFingerprint;
    try {
      contextFingerprint = hashRequest({
        context: resolved.context,
        knownAbsentPaths,
        policy_version: resolved.policy_version,
      });
    } catch {
      return unknown('AUTHORIZED_CONTEXT_NOT_FINGERPRINTABLE', 'Trusted context is not a canonical JSON value; evaluation failed closed.', identity);
    }
    const evaluationIdentity = {
      snapshot_identity: identity,
      action_id: actionId,
      context_fingerprint: contextFingerprint,
      context_policy_version: resolved.policy_version,
      condition_result: conditionResult,
      effects: translated.effects,
      effect_provenance: translated.effect_provenance,
    };
    return {
      status: 'ready',
      reason_code: null,
      ...evaluationIdentity,
      evaluation_fingerprint: hashRequest(evaluationIdentity),
      commit_authority: 'none',
      guarantees: {
        read_only: true,
        context_provider_attested_snapshot: true,
        context_policy_versioned: true,
        complete_mechanic_dependencies: false,
        proposal_created: false,
        canonical_state_mutated: false,
      },
    };
  }
}
