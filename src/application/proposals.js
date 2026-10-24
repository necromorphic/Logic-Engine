import { randomUUID } from 'node:crypto';
import { EngineError, assert } from '../core/errors.js';
import { hashRequest } from '../core/request-hash.js';
import { isAttestedMechanicEvaluation } from './mechanic-evaluation-attestation.js';

const now = () => new Date().toISOString();
const enc = (value) => JSON.stringify(value);
const dec = (value) => JSON.parse(value);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export class ProposalService {
  constructor(engine, { validateMechanicPolicy } = {}) {
    if (!engine?.store?.db) throw new TypeError('ProposalService requires an engine with a persistent store');
    if (validateMechanicPolicy !== undefined && typeof validateMechanicPolicy !== 'function') {
      throw new TypeError('validateMechanicPolicy must be a trusted synchronous policy validator');
    }
    this.engine = engine;
    this.validateMechanicPolicy = validateMechanicPolicy ?? null;
    this.db = engine.store.db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS event_proposals (
        proposal_id TEXT PRIMARY KEY,
        world_id TEXT NOT NULL REFERENCES worlds(world_id),
        idempotency_key TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        proposal_hash TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','approved','committed','cancelled')),
        base_world_revision INTEGER NOT NULL,
        base_commit_sequence INTEGER NOT NULL,
        event_payload_json TEXT NOT NULL,
        source_text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        approved_at TEXT,
        committed_at TEXT,
        commit_result_json TEXT,
        validation_result_json TEXT NOT NULL DEFAULT '{}',
        created_by_adapter_id TEXT,
        mechanic_execution_json TEXT,
        UNIQUE(world_id, idempotency_key)
      );
    `);
    const columns = this.db.prepare('PRAGMA table_info(event_proposals)').all();
    if (!columns.some((column) => column.name === 'validation_result_json')) this.db.exec("ALTER TABLE event_proposals ADD COLUMN validation_result_json TEXT NOT NULL DEFAULT '{}'");
    if (!columns.some((column) => column.name === 'created_by_adapter_id')) this.db.exec('ALTER TABLE event_proposals ADD COLUMN created_by_adapter_id TEXT');
    if (!columns.some((column) => column.name === 'mechanic_execution_json')) this.db.exec('ALTER TABLE event_proposals ADD COLUMN mechanic_execution_json TEXT');
  }

  create(worldId, body, adapterId, mechanicExecution = null) {
    assert(typeof adapterId === 'string' && adapterId.trim(), 'ADAPTER_REQUIRED', 'A trusted adapter identity is required.', 403);
    assert(object(body), 'INVALID_BODY', 'Proposal body must be an object.');
    const allowed = ['idempotency_key', 'source_text', 'event'];
    assert(Object.keys(body).every((key) => allowed.includes(key)), 'UNSUPPORTED_PROPOSAL_FIELD', 'Proposal contains a server-owned or unsupported field.');
    assert(typeof body.idempotency_key === 'string' && body.idempotency_key.trim() && body.idempotency_key.length <= 200, 'IDEMPOTENCY_KEY_REQUIRED', 'idempotency_key is required.');
    assert(typeof body.source_text === 'string' && body.source_text.length <= 50000, 'INVALID_SOURCE_TEXT', 'source_text must be a string of at most 50000 characters.');
    assert(object(body.event), 'INVALID_EVENT_PROPOSAL', 'event must be an object containing the proposed event payload.');
    const allowedEventFields = ['turn_id', 'event_type', 'context_manifest_id', 'generation_id', 'source_message_id', 'time_advance_seconds', 'time_mode', 'duration_proposal', 'caused_by', 'depends_on', 'read_set', 'causal_links', 'effects'];
    assert(Object.keys(body.event).every((key) => allowedEventFields.includes(key)), 'UNSUPPORTED_EVENT_FIELD', 'Event payload contains an unsupported or server-owned field.');
    assert(typeof body.event.turn_id === 'string' && body.event.turn_id.trim(), 'TURN_ID_REQUIRED', 'event.turn_id is required.');
    assert(typeof body.event.event_type === 'string' && body.event.event_type.trim(), 'EVENT_TYPE_REQUIRED', 'event.event_type is required.');
    assert(Array.isArray(body.event.effects ?? []), 'INVALID_EFFECTS', 'event.effects must be an array.');
    if ((body.event.effects ?? []).some((effect) => typeof effect?.kind === 'string' && effect.kind.startsWith('mechanic.instance.'))) {
      throw new EngineError('MECHANIC_CONFIGURATION_REQUIRES_ADMIN', 'Mechanic lifecycle operations require the separate administrative credential and cannot be submitted through adapter proposals.', 403);
    }

    return this.engine.store.tx(() => {
    const world = this.engine.store.world(worldId);
    if (!world) throw new EngineError('WORLD_NOT_FOUND', 'World not found.', 404);
    const sequence = this.engine.store.currentCommitSequence(worldId);
    const request = { source_text: body.source_text, event: body.event };
    const requestHash = hashRequest(mechanicExecution === null ? request : { ...request, mechanic_execution: mechanicExecution });
    const existing = this.db.prepare('SELECT * FROM event_proposals WHERE world_id=? AND idempotency_key=?').get(worldId, body.idempotency_key.trim());
    if (existing) {
      if (existing.created_by_adapter_id !== adapterId) throw new EngineError('PROPOSAL_ADAPTER_MISMATCH', 'Proposal idempotency key belongs to another adapter.', 403);
      if (existing.request_hash !== requestHash) throw new EngineError('IDEMPOTENCY_KEY_CONFLICT', 'Proposal idempotency key was reused with different content.', 409);
      return this.publicProposal(existing, true);
    }

    const proposalId = randomUUID();
    const createdAt = now();
    const eventPayload = { ...body.event, event_id: randomUUID() };
    const validation = this.engine.validateEvent(worldId, {
      ...eventPayload,
      idempotency_key: 'proposal-validation:' + randomUUID(),
      expected_revision: world.world_revision,
    });
    const validationResult = {
      status: ((eventPayload.effects ?? []).length > 0 && body.source_text.trim().length > 0) ? 'needs_review' : 'passed',
      requires_manual_semantic_review: ((eventPayload.effects ?? []).length > 0 && body.source_text.trim().length > 0),
      checked_at: createdAt,
      world_revision: world.world_revision,
      checks: ['payload_schema', 'supported_effects', 'causal_references', 'requires_preconditions', 'revision_consistency'],
      not_checked: ['semantic_alignment_with_source_text', 'causal_completeness', 'actor_authorization', 'player_agency_policy'],
      preview_event_id: validation.event_id,
    };
    const proposalHash = hashRequest({
      proposal_id: proposalId, world_id: worldId, base_world_revision: world.world_revision,
      base_commit_sequence: sequence, event: eventPayload, source_text: body.source_text,
      ...(mechanicExecution === null ? {} : { mechanic_execution: mechanicExecution }),
    });
    try {
      this.db.prepare(`INSERT INTO event_proposals(
        proposal_id,world_id,idempotency_key,request_hash,proposal_hash,status,base_world_revision,base_commit_sequence,
        event_payload_json,source_text,created_at,validation_result_json,created_by_adapter_id,mechanic_execution_json
      ) VALUES(?,?,?,?,?,'pending',?,?,?,?,?,?,?,?)`).run(
        proposalId, worldId, body.idempotency_key.trim(), requestHash, proposalHash, world.world_revision,
        sequence, enc(eventPayload), body.source_text, createdAt, enc(validationResult), adapterId,
        mechanicExecution === null ? null : enc(mechanicExecution),
      );
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) throw new EngineError('PROPOSAL_IDEMPOTENCY_CONFLICT', 'Proposal idempotency key conflicts with an existing proposal.', 409);
      throw error;
    }
    this.db.prepare('INSERT INTO audit_entries(world_id,world_revision,action,target_id,payload_json,occurred_at) VALUES(?,?,?,?,?,?)')
      .run(worldId, world.world_revision, 'proposal.created', proposalId, enc({
        proposal_hash: proposalHash,
        base_world_revision: world.world_revision,
        base_commit_sequence: sequence,
        ...(mechanicExecution === null ? {} : { mechanic_execution: mechanicExecution }),
      }), createdAt);
    return this.publicProposal(this.db.prepare('SELECT * FROM event_proposals WHERE proposal_id=?').get(proposalId), false);
    });
  }


  /**
   * Internal handoff for a snapshot-bound deterministic mechanic evaluation.
   * Rechecks exact revision/cursor in the proposal transaction and stores effect
   * provenance with the durable proposal. Approval and commit remain on the
   * ordinary proposal lifecycle and its stale-snapshot guards.
   */
  createFromMechanicEvaluation(worldId, evaluation, { idempotencyKey, turnId, sourceText, adapterId } = {}) {
    assert(object(evaluation) && evaluation.status === 'ready', 'INVALID_MECHANIC_EVALUATION', 'Only a ready mechanic evaluation can be handed off.');
    assert(isAttestedMechanicEvaluation(evaluation), 'UNATTESTED_MECHANIC_EVALUATION', 'Only the original immutable result produced by the trusted MechanicExecutor can be handed off.');
    const identity = evaluation.snapshot_identity;
    assert(object(identity) && identity.world_id === worldId
      && Number.isSafeInteger(identity.world_revision) && identity.world_revision >= 0
      && Number.isSafeInteger(identity.commit_sequence) && identity.commit_sequence >= 0
      && typeof identity.instance_id === 'string' && identity.instance_id.trim()
      && typeof identity.template_id === 'string' && identity.template_id.trim()
      && typeof identity.template_version === 'string' && identity.template_version.trim()
      && typeof identity.template_hash === 'string' && /^[a-f0-9]{64}$/i.test(identity.template_hash),
    'INVALID_MECHANIC_EVALUATION_IDENTITY', 'Evaluation must include a complete world, snapshot, instance, and pinned-template identity.');
    assert(typeof evaluation.action_id === 'string' && evaluation.action_id.trim(), 'INVALID_MECHANIC_EVALUATION', 'action_id is required.');
    assert(object(evaluation.condition_result) && evaluation.condition_result.status === 'true', 'INVALID_MECHANIC_EVALUATION', 'Only evaluations with proven-true conditions may be proposed.');
    assert(typeof evaluation.context_fingerprint === 'string' && /^[a-f0-9]{64}$/i.test(evaluation.context_fingerprint)
      && typeof evaluation.evaluation_fingerprint === 'string' && /^[a-f0-9]{64}$/i.test(evaluation.evaluation_fingerprint)
      && typeof evaluation.context_policy_version === 'string' && evaluation.context_policy_version.trim()
      && typeof evaluation.authorization_scope === 'string' && evaluation.authorization_scope.trim(),
    'INVALID_MECHANIC_EVALUATION_FINGERPRINT', 'Context and evaluation fingerprints are required.');
    const expectedEvaluationFingerprint = hashRequest({
      snapshot_identity: identity,
      action_id: evaluation.action_id,
      context_fingerprint: evaluation.context_fingerprint,
      context_policy_version: evaluation.context_policy_version,
      authorization_scope: evaluation.authorization_scope,
      condition_result: evaluation.condition_result,
      dependency_manifest: evaluation.dependency_manifest,
      effects: evaluation.effects,
      effect_provenance: evaluation.effect_provenance,
      read_set: evaluation.read_set,
      causal_links: evaluation.causal_links,
    });
    assert(expectedEvaluationFingerprint === evaluation.evaluation_fingerprint,
      'INVALID_MECHANIC_EVALUATION_FINGERPRINT', 'Evaluation content does not match its fingerprint.');
    assert(object(evaluation.guarantees) && evaluation.guarantees.read_only === true
      && evaluation.guarantees.context_provider_attested_snapshot === true
      && evaluation.guarantees.context_policy_versioned === true
      && evaluation.guarantees.complete_mechanic_dependencies === true
      && evaluation.guarantees.complete_global_mechanic_dependencies === false
      && evaluation.guarantees.proposal_created === false && evaluation.guarantees.canonical_state_mutated === false,
    'INVALID_MECHANIC_EVALUATION', 'Evaluation must carry read-only, snapshot-attestation, and dependency-completeness guarantees.');
    assert(object(evaluation.dependency_manifest)
      && evaluation.dependency_manifest.scope === 'bounded_deterministic_action_v1'
      && evaluation.dependency_manifest.global_mechanic_dependencies_complete === false
      && evaluation.dependency_manifest.condition_ast_dependencies_complete === true
      && evaluation.dependency_manifest.context_projection_dependencies_complete === true
      && evaluation.dependency_manifest.effect_target_dependencies_complete === true
      && evaluation.dependency_manifest.causal_read_set_complete_for_supported_slice === true
      && evaluation.dependency_manifest.mechanic_dependencies_complete === true
      && Array.isArray(evaluation.dependency_manifest.unresolved_sources)
      && evaluation.dependency_manifest.unresolved_sources.length === 0
      && Array.isArray(evaluation.dependency_manifest.assumptions)
      && evaluation.dependency_manifest.assumptions.every((item) => typeof item === 'string' && item.trim()),
    'INCOMPLETE_MECHANIC_DEPENDENCIES', 'Mechanic proposal requires a complete dependency manifest for the supported execution slice.');
    assert(Array.isArray(evaluation.read_set) && Array.isArray(evaluation.causal_links),
      'INVALID_MECHANIC_DEPENDENCY_PROVENANCE', 'Evaluation must include canonical read_set and causal_links.');
    assert(Array.isArray(evaluation.effects) && evaluation.effects.length > 0, 'INVALID_MECHANIC_EVALUATION', 'At least one translated effect is required.');
    assert(Array.isArray(evaluation.read_set) && evaluation.read_set.every((item) => typeof item === 'string' && item.trim()),
      'INVALID_MECHANIC_READ_SET', 'A ready mechanic evaluation must include a normalized canonical read_set.');
    assert(Array.isArray(evaluation.causal_links),
      'INVALID_MECHANIC_CAUSAL_LINKS', 'A ready mechanic evaluation must include its canonical causal links.');
    assert(Array.isArray(evaluation.effect_provenance) && evaluation.effect_provenance.length === evaluation.effects.length,
      'INVALID_MECHANIC_EFFECT_PROVENANCE', 'Every translated effect must have exactly one provenance entry.');
    const provenance = evaluation.effect_provenance;
    const indexes = new Set();
    const effectIds = new Set();
    const translatedKinds = { create_entity: 'entity.create', update_attribute: 'entity.update', assert_fact: 'fact.set' };
    for (let i = 0; i < provenance.length; i += 1) {
      const item = provenance[i];
      assert(object(item) && item.effect_index === i && item.action_id === evaluation.action_id
        && typeof item.effect_id === 'string' && item.effect_id.trim()
        && typeof item.intent_kind === 'string' && item.intent_kind.trim()
        && typeof item.target_ref === 'string' && item.target_ref.trim()
        && !indexes.has(item.effect_index) && !effectIds.has(item.effect_id)
        && translatedKinds[item.intent_kind] === evaluation.effects[i]?.kind,
      'INVALID_MECHANIC_EFFECT_PROVENANCE', 'Effect provenance must be ordered, complete, and action-scoped.');
      indexes.add(item.effect_index);
      effectIds.add(item.effect_id);
      const effect = evaluation.effects[i];
      const actualTarget = effect?.kind === 'entity.create' || effect?.kind === 'entity.update'
        ? effect.entity_id
        : effect?.kind === 'fact.set' ? effect.fact_id : null;
      assert(actualTarget === item.target_ref, 'INVALID_MECHANIC_EFFECT_PROVENANCE', 'Effect provenance target does not match the translated Core effect.');
    }
    assert(typeof idempotencyKey === 'string' && idempotencyKey.trim() && idempotencyKey.length <= 200,
      'IDEMPOTENCY_KEY_REQUIRED', 'A proposal idempotency key is required.');
    assert(typeof turnId === 'string' && turnId.trim() && turnId.length <= 200,
      'TURN_ID_REQUIRED', 'A turn id is required.');
    assert(typeof sourceText === 'string' && sourceText.trim() && sourceText.length <= 50000,
      'INVALID_SOURCE_TEXT', 'Non-empty source text is required so semantic review is retained.');
    assert(typeof adapterId === 'string' && adapterId.trim(), 'ADAPTER_REQUIRED', 'A trusted adapter identity is required.', 403);

    const mechanicExecution = {
      snapshot_identity: identity,
      action_id: evaluation.action_id,
      condition_result: evaluation.condition_result,
      context_fingerprint: evaluation.context_fingerprint,
      context_policy_version: evaluation.context_policy_version,
      authorization_scope: evaluation.authorization_scope,
      evaluation_fingerprint: evaluation.evaluation_fingerprint,
      dependency_manifest: evaluation.dependency_manifest,
      effect_provenance: provenance,
      read_set: evaluation.read_set,
      causal_links: evaluation.causal_links,
      dependency_completeness: 'complete_for_supported_slice',
      global_dependency_completeness: 'not_proven',
      semantic_review_required: true,
    };
    return this.engine.store.tx(() => {
      const event = {
        turn_id: turnId,
        event_type: 'action.completed',
        effects: evaluation.effects,
        read_set: evaluation.read_set,
        causal_links: evaluation.causal_links,
      };
      const expectedRequestHash = hashRequest({
        source_text: sourceText,
        event,
        mechanic_execution: mechanicExecution,
      });
      const existing = this.db.prepare('SELECT * FROM event_proposals WHERE world_id=? AND idempotency_key=?')
        .get(worldId, idempotencyKey.trim());
      if (existing) {
        if (existing.created_by_adapter_id !== adapterId) {
          throw new EngineError('PROPOSAL_ADAPTER_MISMATCH', 'Proposal idempotency key belongs to another adapter.', 403);
        }
        if (existing.request_hash !== expectedRequestHash) {
          throw new EngineError('IDEMPOTENCY_KEY_CONFLICT', 'Proposal idempotency key was reused with different mechanic evaluation content.', 409);
        }
        return this.publicProposal(existing, true);
      }

      const world = this.engine.store.world(worldId);
      if (!world) throw new EngineError('WORLD_NOT_FOUND', 'World not found.', 404);
      const sequence = this.engine.store.currentCommitSequence(worldId);
      if (world.world_revision !== identity.world_revision || sequence !== identity.commit_sequence) {
        throw new EngineError('STALE_MECHANIC_EVALUATION', 'World revision or commit sequence changed after mechanic evaluation; evaluate again before proposing.', 409, {
          evaluated_world_revision: identity.world_revision,
          current_world_revision: world.world_revision,
          evaluated_commit_sequence: identity.commit_sequence,
          current_commit_sequence: sequence,
        });
      }
      return this.create(worldId, {
        idempotency_key: idempotencyKey,
        source_text: sourceText,
        event: {
          turn_id: turnId,
          event_type: 'action.completed',
          effects: evaluation.effects,
          read_set: evaluation.read_set,
          causal_links: evaluation.causal_links,
        },
      }, adapterId, mechanicExecution);
    });
  }

  /**
   * Revalidate deployment-owned visibility policy before a mechanic proposal
   * crosses an approval/commit boundary. The callback must synchronously compare
   * the pinned policy fingerprint and authorization scope with the currently
   * active policy; it must not mutate canonical state. Missing or non-true
   * decisions fail closed. Ordinary non-mechanic proposals are unaffected.
   */
  assertMechanicPolicyCurrent(row, stage) {
    if (!row.mechanic_execution_json) return;
    if (typeof this.validateMechanicPolicy !== 'function') {
      throw new EngineError(
        'MECHANIC_POLICY_REVALIDATION_REQUIRED',
        'Mechanic proposals require a trusted current-policy validator at approval and commit.',
        409,
        { stage },
      );
    }

    let metadata;
    try {
      metadata = dec(row.mechanic_execution_json);
    } catch {
      throw new EngineError('STALE_MECHANIC_POLICY', 'Mechanic policy metadata is invalid; proposal cannot proceed.', 409, { stage });
    }
    if (typeof metadata.context_policy_version !== 'string' || !metadata.context_policy_version.trim()
      || typeof metadata.authorization_scope !== 'string' || !metadata.authorization_scope.trim()) {
      throw new EngineError('STALE_MECHANIC_POLICY', 'Mechanic proposal lacks a valid pinned policy identity.', 409, { stage });
    }

    let current = false;
    try {
      current = this.validateMechanicPolicy(Object.freeze({
        worldId: row.world_id,
        policyVersion: metadata.context_policy_version,
        authorizationScope: metadata.authorization_scope,
        snapshotIdentity: metadata.snapshot_identity,
        stage,
      })) === true;
    } catch {
      current = false;
    }
    if (!current) {
      throw new EngineError(
        'STALE_MECHANIC_POLICY',
        'The policy version or authorization scope is no longer current; re-evaluate and create a new proposal.',
        409,
        { stage },
      );
    }
  }

  get(worldId, proposalId, adapterId = null) {
    const row = this.db.prepare('SELECT * FROM event_proposals WHERE world_id=? AND proposal_id=?').get(worldId, proposalId);
    if (!row) throw new EngineError('PROPOSAL_NOT_FOUND', 'Proposal not found.', 404);
    if (adapterId !== null && row.created_by_adapter_id !== adapterId) {
      throw new EngineError('PROPOSAL_NOT_FOUND', 'Proposal not found.', 404);
    }
    return this.publicProposal(row, false);
  }

  approve(worldId, proposalId) {
    return this.engine.store.tx(() => {
      const row = this.db.prepare('SELECT * FROM event_proposals WHERE world_id=? AND proposal_id=?').get(worldId, proposalId);
      if (!row) throw new EngineError('PROPOSAL_NOT_FOUND', 'Proposal not found.', 404);
      if (row.status !== 'pending') throw new EngineError('PROPOSAL_STATE_CONFLICT', 'Only pending proposals can be approved.', 409, { status: row.status });
      const world = this.engine.store.world(worldId);
      if (!world) throw new EngineError('WORLD_NOT_FOUND', 'World not found.', 404);
      const sequence = this.engine.store.currentCommitSequence(worldId);
      if (world.world_revision !== row.base_world_revision || sequence !== row.base_commit_sequence) throw new EngineError('STALE_PROPOSAL', 'World history changed after this proposal was created.', 409, { base_world_revision: row.base_world_revision, current_world_revision: world.world_revision, base_commit_sequence: row.base_commit_sequence, current_commit_sequence: sequence });
      this.assertMechanicPolicyCurrent(row, 'approval');
      const approvedAt = now();
      this.db.prepare("UPDATE event_proposals SET status='approved',approved_at=? WHERE proposal_id=? AND status='pending'").run(approvedAt, proposalId);
      this.db.prepare('INSERT INTO audit_entries(world_id,world_revision,action,target_id,payload_json,occurred_at) VALUES(?,?,?,?,?,?)')
        .run(worldId, world.world_revision, 'proposal.approved', proposalId, enc({ proposal_hash: row.proposal_hash, approver: 'approval_credential' }), approvedAt);
      return this.publicProposal(this.db.prepare('SELECT * FROM event_proposals WHERE proposal_id=?').get(proposalId), false);
    });
  }

  commit(worldId, proposalId) {
    return this.engine.store.tx(() => {
      const row = this.db.prepare('SELECT * FROM event_proposals WHERE world_id=? AND proposal_id=?').get(worldId, proposalId);
      if (!row) throw new EngineError('PROPOSAL_NOT_FOUND', 'Proposal not found.', 404);
      if (row.status === 'committed') return { ...this.publicProposal(row, true), commit_result: { ...dec(row.commit_result_json), idempotent_replay: true } };
      if (row.status !== 'approved') throw new EngineError('PROPOSAL_NOT_APPROVED', 'Proposal must be approved before commit.', 409, { status: row.status });
      const world = this.engine.store.world(worldId);
      if (!world) throw new EngineError('WORLD_NOT_FOUND', 'World not found.', 404);
      const sequence = this.engine.store.currentCommitSequence(worldId);
      if (world.world_revision !== row.base_world_revision || sequence !== row.base_commit_sequence) {
        throw new EngineError('STALE_PROPOSAL', 'World history changed after this proposal was created; create a fresh proposal.', 409, {
          base_world_revision: row.base_world_revision, current_world_revision: world.world_revision,
          base_commit_sequence: row.base_commit_sequence, current_commit_sequence: sequence,
        });
      }

      this.assertMechanicPolicyCurrent(row, 'commit');
      const payload = dec(row.event_payload_json);
      const result = this.engine.commitEvent(worldId, {
        ...payload,
        idempotency_key: 'proposal:' + row.proposal_id,
        expected_revision: row.base_world_revision,
      }, row.mechanic_execution_json ? { mechanicExecution: dec(row.mechanic_execution_json) } : undefined);
      const committedAt = now();
      this.db.prepare("UPDATE event_proposals SET status='committed',committed_at=?,commit_result_json=? WHERE proposal_id=? AND status='approved'")
        .run(committedAt, enc(result), proposalId);
      const committedAuditPayload = {
        proposal_hash: row.proposal_hash,
        event_id: result.event_id,
        ...(row.mechanic_execution_json
          ? { mechanic_execution: dec(row.mechanic_execution_json) }
          : {}),
      };
      this.db.prepare('INSERT INTO audit_entries(world_id,world_revision,action,target_id,payload_json,occurred_at) VALUES(?,?,?,?,?,?)')
        .run(worldId, result.world_revision, 'proposal.committed', proposalId, enc(committedAuditPayload), committedAt);
      const updated = this.db.prepare('SELECT * FROM event_proposals WHERE proposal_id=?').get(proposalId);
      return { ...this.publicProposal(updated, false), commit_result: result };
    });
  }

  cancel(worldId, proposalId, reason = 'adapter_cancelled', adapterId) {
    return this.engine.store.tx(() => {
      const row = this.db.prepare('SELECT * FROM event_proposals WHERE world_id=? AND proposal_id=?').get(worldId, proposalId);
      if (!row) throw new EngineError('PROPOSAL_NOT_FOUND', 'Proposal not found.', 404);
      if (!adapterId || row.created_by_adapter_id !== adapterId) throw new EngineError('PROPOSAL_ADAPTER_MISMATCH', 'Only the adapter that created this proposal may cancel it.', 403);
      if (row.status === 'committed') throw new EngineError('PROPOSAL_STATE_CONFLICT', 'A committed proposal cannot be cancelled.', 409, { status: row.status });
      if (row.status === 'cancelled') return this.publicProposal(row, true);
      const cancelledAt = now();
      this.db.prepare("UPDATE event_proposals SET status='cancelled' WHERE proposal_id=? AND status IN ('pending','approved')").run(proposalId);
      this.db.prepare('INSERT INTO audit_entries(world_id,world_revision,action,target_id,payload_json,occurred_at) VALUES(?,?,?,?,?,?)')
        .run(worldId, this.engine.store.world(worldId).world_revision, 'proposal.cancelled', proposalId, enc({ proposal_hash: row.proposal_hash, reason }), cancelledAt);
      return this.publicProposal(this.db.prepare('SELECT * FROM event_proposals WHERE proposal_id=?').get(proposalId), false);
    });
  }

  publicProposal(row, replay) {
    return {
      proposal_id: row.proposal_id, world_id: row.world_id, status: row.status,
      proposal_hash: row.proposal_hash, base_world_revision: row.base_world_revision,
      base_commit_sequence: row.base_commit_sequence, source_text: row.source_text, event: dec(row.event_payload_json),
      created_at: row.created_at, approved_at: row.approved_at, committed_at: row.committed_at,
      validation_result: dec(row.validation_result_json || '{}'),
      mechanic_execution: row.mechanic_execution_json ? dec(row.mechanic_execution_json) : null,
      idempotent_replay: replay,
    };
  }
}
