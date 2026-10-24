import { EngineError } from '../core/errors.js';
import { evaluateMechanicActionConditions, translateMechanicEffectIntents } from '../core/mechanics.js';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
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

    let snapshot = this.engine.getSnapshot(worldId, { includeMechanicEvaluationState: true });
    let state = snapshot.mechanic_evaluation_snapshot;
    let instance = state.instances.find((candidate) => candidate.instance_id === instanceId);
    if (!instance) return { status: 'rejected', reason_code: 'MECHANIC_INSTANCE_NOT_FOUND', effects: [], effect_provenance: [] };
    if (instance.status !== 'enabled') return { status: 'rejected', reason_code: 'MECHANIC_INSTANCE_NOT_ENABLED', effects: [], effect_provenance: [] };

    const templateEntry = state.templates.find(({ template }) =>
      template.template_id === instance.template_id && template.version === instance.template_version);
    if (!templateEntry) {
      return unknown('PINNED_TEMPLATE_NOT_FOUND', 'The exact pinned template is absent from the evaluation snapshot.');
    }
    let template = templateEntry.template;
    let identity = snapshotIdentity(worldId, snapshot, instance, templateEntry);
    let action = template.actions.find((candidate) => candidate.action_id === actionId);
    if (!action) return { status: 'rejected', reason_code: 'MECHANIC_ACTION_NOT_FOUND', snapshot_identity: identity, effects: [], effect_provenance: [] };

    // The canonical snapshot API selects entity rows explicitly. Discover the
    // selected action's literal entity targets, then take a second bounded
    // snapshot and require the same revision/cursor before using those rows.
    const entityIds = [...new Set(action.effects
      .filter((effect) => ['create_entity', 'update_attribute'].includes(effect.kind))
      .map((effect) => effect.target_ref))];
    if (entityIds.length) {
      const firstRevision = snapshot.world_revision;
      const firstSequence = snapshot.commit_sequence;
      const detailed = this.engine.getSnapshot(worldId, {
        includeMechanicEvaluationState: true,
        entityIds,
      });
      if (detailed.world_revision !== firstRevision || detailed.commit_sequence !== firstSequence) {
        return unknown('SNAPSHOT_CHANGED_DURING_PREPARATION', 'World revision or commit sequence changed while resolving literal effect targets.', identity);
      }
      snapshot = detailed;
      state = snapshot.mechanic_evaluation_snapshot;
      instance = state.instances.find((candidate) => candidate.instance_id === instanceId);
      const refreshedEntry = state.templates.find(({ template: candidate }) =>
        candidate.template_id === instance?.template_id && candidate.version === instance?.template_version);
      if (!instance || instance.status !== 'enabled' || !refreshedEntry
        || instance.template_id !== identity.template_id
        || instance.template_version !== identity.template_version
        || refreshedEntry.template_hash !== identity.template_hash) {
        return unknown('PINNED_MECHANIC_CHANGED_DURING_PREPARATION', 'The enabled instance or exact template identity changed while resolving effect targets.', identity);
      }
      template = refreshedEntry.template;
      action = template.actions.find((candidate) => candidate.action_id === actionId);
      if (!action) return { status: 'rejected', reason_code: 'MECHANIC_ACTION_NOT_FOUND', snapshot_identity: identity, effects: [], effect_provenance: [] };
      identity = snapshotIdentity(worldId, snapshot, instance, refreshedEntry);
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
      return unknown('AUTHORIZED_CONTEXT_RESOLUTION_FAILED', 'Trusted context resolution failed: ' + error.message, identity);
    }
    if (!object(resolved) || !object(resolved.context)
      || resolved.world_revision !== snapshot.world_revision
      || resolved.commit_sequence !== snapshot.commit_sequence) {
      return unknown('AUTHORIZED_CONTEXT_SNAPSHOT_MISMATCH', 'Trusted context must identify the exact world revision and commit sequence used by this evaluation.', identity);
    }

    let conditionResult;
    try {
      conditionResult = evaluateMechanicActionConditions(template, actionId, resolved.context, {
        knownAbsentPaths: resolved.knownAbsentPaths ?? [],
      });
    } catch (error) {
      return unknown('MECHANIC_CONDITION_EVALUATION_FAILED', 'Condition evaluation failed closed: ' + error.message, identity);
    }
    if (conditionResult.status !== 'true') {
      return {
        status: conditionResult.status === 'false' ? 'rejected' : 'unknown',
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

    const existingEntities = new Set(snapshot.entities.map((entity) => entity.entity_id));
    const createdEntities = new Set();
    for (const effect of translated.effects) {
      if (effect.kind === 'entity.create') {
        if (existingEntities.has(effect.entity_id) || createdEntities.has(effect.entity_id)) {
          return unknown('MECHANIC_EFFECT_TARGET_ALREADY_EXISTS', 'A create_entity target already exists in the snapshot or earlier in this effect batch.', identity);
        }
        createdEntities.add(effect.entity_id);
      } else if (effect.kind === 'entity.update') {
        if (!existingEntities.has(effect.entity_id) && !createdEntities.has(effect.entity_id)) {
          return unknown('MECHANIC_EFFECT_TARGET_NOT_FOUND', 'An update_attribute target must exist in the same-world snapshot or be created earlier in this batch.', identity);
        }
      }
    }

    return {
      status: 'ready',
      reason_code: null,
      snapshot_identity: identity,
      action_id: actionId,
      condition_result: conditionResult,
      effects: translated.effects,
      effect_provenance: translated.effect_provenance,
      guarantees: {
        read_only: true,
        context_provider_attested_snapshot: true,
        complete_mechanic_dependencies: false,
        proposal_created: false,
        canonical_state_mutated: false,
      },
    };
  }
}
