import { EngineError } from '../core/errors.js';
import { evaluateMechanicActionAgainstSnapshot } from '../core/mechanics.js';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function freezeDeep(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) freezeDeep(child, seen);
  return Object.freeze(value);
}

/**
 * Application seam for bounded mechanic evaluation.
 *
 * The service owns canonical snapshot capture. A deployment must inject a
 * trusted context provider that projects only authorized data from that exact
 * snapshot and supplies a versioned policy identity. No HTTP/model-provided
 * context provider is accepted. This service does not directly mutate state.
 */
export class MechanicEvaluationService {
  constructor(engine, { contextProvider, proposalService = null } = {}) {
    if (!engine || typeof engine.getSnapshot !== 'function') {
      throw new TypeError('MechanicEvaluationService requires an engine with getSnapshot().');
    }
    if (typeof contextProvider !== 'function') {
      throw new TypeError('A trusted contextProvider is required; raw snapshot reads are not an authorization policy.');
    }
    if (proposalService !== null && typeof proposalService.createFromMechanicEvaluation !== 'function') {
      throw new TypeError('proposalService must implement createFromMechanicEvaluation().');
    }
    this.engine = engine;
    this.contextProvider = contextProvider;
    this.proposalService = proposalService;
  }

  async evaluate({ worldId, instanceId, actionId, actorContext = null }) {
    if (typeof worldId !== 'string' || !worldId.trim()
      || typeof instanceId !== 'string' || !instanceId.trim()
      || typeof actionId !== 'string' || !actionId.trim()) {
      throw new EngineError('INVALID_MECHANIC_EVALUATION_REQUEST', 'worldId, instanceId, and actionId must be non-empty strings.', 400);
    }

    const snapshot = freezeDeep(this.engine.getSnapshot(worldId, {
      includeMechanicEvaluationState: true,
    }));
    let projected;
    try {
      projected = await this.contextProvider({
        worldId,
        snapshot,
        instanceId,
        actionId,
        actorContext,
      });
    } catch (error) {
      return {
        status: 'unknown',
        reason_code: 'TRUSTED_CONTEXT_UNAVAILABLE',
        diagnostic: error?.message ?? 'Trusted context provider failed.',
        world_id: snapshot.world_id,
        world_revision: snapshot.world_revision,
        commit_sequence: snapshot.commit_sequence,
        instance_id: instanceId,
        action_id: actionId,
        effects: [],
        effect_provenance: [],
        commit_authority: 'none',
      };
    }

    if (!object(projected)
      || !object(projected.context)
      || !Array.isArray(projected.knownAbsentPaths ?? [])
      || !(projected.knownAbsentPaths ?? []).every((path) => typeof path === 'string' && path.trim())
      || typeof projected.policyVersion !== 'string'
      || !projected.policyVersion.trim()
      || Object.keys(projected).some((key) => !['context', 'knownAbsentPaths', 'policyVersion', 'manifestId'].includes(key))
      || (projected.manifestId !== undefined && (typeof projected.manifestId !== 'string' || !projected.manifestId.trim()))) {
      return {
        status: 'unknown',
        reason_code: 'TRUSTED_CONTEXT_CONTRACT_INVALID',
        world_id: snapshot.world_id,
        world_revision: snapshot.world_revision,
        commit_sequence: snapshot.commit_sequence,
        instance_id: instanceId,
        action_id: actionId,
        effects: [],
        effect_provenance: [],
        commit_authority: 'none',
      };
    }

    return evaluateMechanicActionAgainstSnapshot({
      snapshot,
      instanceId,
      actionId,
      authorizedContext: projected.context,
      knownAbsentPaths: projected.knownAbsentPaths ?? [],
      contextIdentity: {
        policy_version: projected.policyVersion,
        ...(projected.manifestId ? { manifest_id: projected.manifestId } : {}),
      },
    });
  }

  /**
   * Evaluate and, only for a ready supported result, create a proposal through
   * the existing proposal service. That service rechecks exact revision/cursor
   * in its write transaction and persists effect provenance. Approval and
   * commit remain separate mandatory operations.
   */
  async evaluateAndPropose({
    worldId, instanceId, actionId, actorContext = null,
    idempotencyKey, turnId, sourceText, adapterId,
  }) {
    if (!this.proposalService) {
      throw new TypeError('A ProposalService is required for evaluateAndPropose().');
    }
    const evaluation = await this.evaluate({ worldId, instanceId, actionId, actorContext });
    if (evaluation.status !== 'ready') return { evaluation, proposal: null };
    const proposal = this.proposalService.createFromMechanicEvaluation(worldId, evaluation, {
      idempotencyKey,
      turnId,
      sourceText,
      adapterId,
    });
    return { evaluation, proposal };
  }
}
