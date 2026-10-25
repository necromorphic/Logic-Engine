import { randomUUID } from 'node:crypto';
import { translateMechanicEffectIntents } from '../core/mechanic-effect-translator.js';
import { EngineError, assert } from '../core/errors.js';
import { hashRequest } from '../core/request-hash.js';

const now = () => new Date().toISOString();
const enc = (value) => JSON.stringify(value);
const dec = (value) => JSON.parse(value);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export class ProposalService {
  constructor(engine) {
    if (!engine?.store?.db) throw new TypeError('ProposalService requires an engine with a persistent store');
    this.engine = engine;
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
        UNIQUE(world_id, idempotency_key)
      );
    `);
    const columns = this.db.prepare('PRAGMA table_info(event_proposals)').all();
    if (!columns.some((column) => column.name === 'validation_result_json')) this.db.exec("ALTER TABLE event_proposals ADD COLUMN validation_result_json TEXT NOT NULL DEFAULT '{}'");
    if (!columns.some((column) => column.name === 'created_by_adapter_id')) this.db.exec('ALTER TABLE event_proposals ADD COLUMN created_by_adapter_id TEXT');
  }

  create(worldId, body, adapterId) {
    assert(typeof adapterId === 'string' && adapterId.trim(), 'ADAPTER_REQUIRED', 'A trusted adapter identity is required.', 403);
    assert(object(body), 'INVALID_BODY', 'Proposal body must be an object.');
    const allowed = ['idempotency_key', 'source_text', 'event'];
    assert(Object.keys(body).every((key) => allowed.includes(key)), 'UNSUPPORTED_PROPOSAL_FIELD', 'Proposal contains a server-owned or unsupported field.');
    assert(typeof body.idempotency_key === 'string' && body.idempotency_key.trim() && body.idempotency_key.length <= 200, 'IDEMPOTENCY_KEY_REQUIRED', 'idempotency_key is required.');
    assert(typeof body.source_text === 'string' && body.source_text.length <= 50000, 'INVALID_SOURCE_TEXT', 'source_text must be a string of at most 50000 characters.');
    assert(object(body.event), 'INVALID_EVENT_PROPOSAL', 'event must be an object containing the proposed event payload.');
    // Resolve an existing idempotency key before translating untrusted intents.
    // A changed request remains an idempotency conflict even if the new intent is malformed.
    const request = { source_text: body.source_text, event: body.event };
    const requestHash = hashRequest(request);
    const existingBeforeTranslation = this.db.prepare('SELECT * FROM event_proposals WHERE world_id=? AND idempotency_key=?')
      .get(worldId, body.idempotency_key.trim());
    if (existingBeforeTranslation) {
      if (existingBeforeTranslation.created_by_adapter_id !== adapterId) throw new EngineError('PROPOSAL_ADAPTER_MISMATCH', 'Proposal idempotency key belongs to another adapter.', 403);
      if (existingBeforeTranslation.request_hash !== requestHash) throw new EngineError('IDEMPOTENCY_KEY_CONFLICT', 'Proposal idempotency key was reused with different content.', 409);
      return this.publicProposal(existingBeforeTranslation, true);
    }
    const allowedEventFields = ['turn_id', 'event_type', 'context_manifest_id', 'generation_id', 'source_message_id', 'time_advance_seconds', 'time_mode', 'duration_proposal', 'caused_by', 'depends_on', 'read_set', 'causal_links', 'effects', 'effect_intents'];
    assert(Object.keys(body.event).every((key) => allowedEventFields.includes(key)), 'UNSUPPORTED_EVENT_FIELD', 'Event payload contains a server-owned or unsupported field.');
    const hasEffects = Object.hasOwn(body.event, 'effects');
    const hasEffectIntents = Object.hasOwn(body.event, 'effect_intents');
    assert(!(hasEffects && hasEffectIntents), 'MUTUALLY_EXCLUSIVE_EFFECT_FIELDS', 'Provide either event.effects or event.effect_intents, not both.');
    assert(typeof body.event.turn_id === 'string' && body.event.turn_id.trim(), 'TURN_ID_REQUIRED', 'event.turn_id is required.');
    assert(typeof body.event.event_type === 'string' && body.event.event_type.trim(), 'EVENT_TYPE_REQUIRED', 'event.event_type is required.');
    assert(Array.isArray(body.event.effects ?? []), 'INVALID_EFFECTS', 'event.effects must be an array.');
    let translatedEffects;
    if (hasEffectIntents) translatedEffects = translateMechanicEffectIntents(body.event.effect_intents);
    if ((body.event.effects ?? []).some((effect) => typeof effect?.kind === 'string' && effect.kind.startsWith('mechanic.instance.'))) {
      throw new EngineError('MECHANIC_CONFIGURATION_REQUIRES_ADMIN', 'Mechanic lifecycle operations require the separate administrative credential and cannot be submitted through adapter proposals.', 403);
    }

    return this.engine.store.tx(() => {
    const world = this.engine.store.world(worldId);
    if (!world) throw new EngineError('WORLD_NOT_FOUND', 'World not found.', 404);
    const sequence = this.engine.store.currentCommitSequence(worldId);
    const request = { source_text: body.source_text, event: body.event };
    const requestHash = hashRequest(request);
    const existing = this.db.prepare('SELECT * FROM event_proposals WHERE world_id=? AND idempotency_key=?').get(worldId, body.idempotency_key.trim());
    if (existing) {
      if (existing.created_by_adapter_id !== adapterId) throw new EngineError('PROPOSAL_ADAPTER_MISMATCH', 'Proposal idempotency key belongs to another adapter.', 403);
      if (existing.request_hash !== requestHash) throw new EngineError('IDEMPOTENCY_KEY_CONFLICT', 'Proposal idempotency key was reused with different content.', 409);
      return this.publicProposal(existing, true);
    }

    const proposalId = randomUUID();
    const createdAt = now();
    const eventPayload = { ...body.event, event_id: randomUUID() };
    if (hasEffectIntents) {
      delete eventPayload.effect_intents;
      eventPayload.effects = translatedEffects;
    }
    const validationKey = 'proposal-validation:' + randomUUID();
    let validation;
    let timePolicyValidation;
    try {
      const prepared = this.engine.prepareEventForWorld(worldId, {
        ...eventPayload,
        idempotency_key: validationKey,
        expected_revision: world.world_revision,
      });
      validation = this.engine.store.validateCommit(worldId, prepared);
      timePolicyValidation = {
        status: prepared.duration_decision ? 'resolved' : 'not_configured',
        decision: prepared.duration_decision ?? null,
      };
    } catch (error) {
      if (error.code !== 'DURATION_NEEDS_AUTHOR') throw error;
      const validationPayload = {
        ...eventPayload,
        idempotency_key: validationKey,
        expected_revision: world.world_revision,
      };
      // The duration remains unresolved at proposal creation, but generic event
      // validation must still run without re-entering the TimePolicy approval gate.
      const preparedForValidation = this.engine.prepareEvent(validationPayload);
      preparedForValidation.request_hash = hashRequest({
        operation: 'event.validate',
        request_hash: preparedForValidation.request_hash,
        idempotency_key: preparedForValidation.idempotency_key,
      });
      validation = this.engine.store.validateCommit(worldId, preparedForValidation);
      timePolicyValidation = { status: 'needs_author', code: error.code, decision: error.details };
    }
    const validationResult = {
      status: ((eventPayload.effects ?? []).length > 0 && body.source_text.trim().length > 0) ? 'needs_review' : 'passed',
      requires_manual_semantic_review: ((eventPayload.effects ?? []).length > 0 && body.source_text.trim().length > 0),
      checked_at: createdAt,
      world_revision: world.world_revision,
      checks: ['payload_schema', 'supported_effects', 'causal_references', 'requires_preconditions', 'revision_consistency', 'time_policy'],
      time_policy: timePolicyValidation,
      not_checked: ['semantic_alignment_with_source_text', 'causal_completeness', 'actor_authorization', 'player_agency_policy'],
      preview_event_id: validation.event_id,
    };
    const proposalHash = hashRequest({
      proposal_id: proposalId, world_id: worldId, base_world_revision: world.world_revision,
      base_commit_sequence: sequence, event: eventPayload, source_text: body.source_text,
    });
    try {
      this.db.prepare(`INSERT INTO event_proposals(
        proposal_id,world_id,idempotency_key,request_hash,proposal_hash,status,base_world_revision,base_commit_sequence,
        event_payload_json,source_text,created_at,validation_result_json,created_by_adapter_id
      ) VALUES(?,?,?,?,?,'pending',?,?,?,?,?,?,?)`).run(
        proposalId, worldId, body.idempotency_key.trim(), requestHash, proposalHash, world.world_revision,
        sequence, enc(eventPayload), body.source_text, createdAt, enc(validationResult), adapterId,
      );
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) throw new EngineError('PROPOSAL_IDEMPOTENCY_CONFLICT', 'Proposal idempotency key conflicts with an existing proposal.', 409);
      throw error;
    }
    this.db.prepare('INSERT INTO audit_entries(world_id,world_revision,action,target_id,payload_json,occurred_at) VALUES(?,?,?,?,?,?)')
      .run(worldId, world.world_revision, 'proposal.created', proposalId, enc({ proposal_hash: proposalHash, base_world_revision: world.world_revision, base_commit_sequence: sequence }), createdAt);
    return this.publicProposal(this.db.prepare('SELECT * FROM event_proposals WHERE proposal_id=?').get(proposalId), false);
    });
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

      const payload = dec(row.event_payload_json);
      const result = this.engine.commitEvent(worldId, {
        ...payload,
        idempotency_key: 'proposal:' + row.proposal_id,
        expected_revision: row.base_world_revision,
      });
      const committedAt = now();
      this.db.prepare("UPDATE event_proposals SET status='committed',committed_at=?,commit_result_json=? WHERE proposal_id=? AND status='approved'")
        .run(committedAt, enc(result), proposalId);
      this.db.prepare('INSERT INTO audit_entries(world_id,world_revision,action,target_id,payload_json,occurred_at) VALUES(?,?,?,?,?,?)')
        .run(worldId, result.world_revision, 'proposal.committed', proposalId, enc({ proposal_hash: row.proposal_hash, event_id: result.event_id }), committedAt);
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
      idempotent_replay: replay,
    };
  }
}
