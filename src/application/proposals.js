import { randomUUID } from 'node:crypto';
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
        UNIQUE(world_id, idempotency_key)
      );
    `);
  }

  create(worldId, body) {
    assert(object(body), 'INVALID_BODY', 'Proposal body must be an object.');
    const allowed = ['idempotency_key', 'source_text', 'event'];
    assert(Object.keys(body).every((key) => allowed.includes(key)), 'UNSUPPORTED_PROPOSAL_FIELD', 'Proposal contains a server-owned or unsupported field.');
    assert(typeof body.idempotency_key === 'string' && body.idempotency_key.trim() && body.idempotency_key.length <= 200, 'IDEMPOTENCY_KEY_REQUIRED', 'idempotency_key is required.');
    assert(typeof body.source_text === 'string' && body.source_text.length <= 50000, 'INVALID_SOURCE_TEXT', 'source_text must be a string of at most 50000 characters.');
    assert(object(body.event), 'INVALID_EVENT_PROPOSAL', 'event must be an object containing the proposed event payload.');
    assert(typeof body.event.turn_id === 'string' && body.event.turn_id.trim(), 'TURN_ID_REQUIRED', 'event.turn_id is required.');
    assert(typeof body.event.event_type === 'string' && body.event.event_type.trim(), 'EVENT_TYPE_REQUIRED', 'event.event_type is required.');
    assert(Array.isArray(body.event.effects ?? []), 'INVALID_EFFECTS', 'event.effects must be an array.');
    assert(!Object.hasOwn(body.event, 'proposal_id') && !Object.hasOwn(body.event, 'status') && !Object.hasOwn(body.event, 'proposal_hash'), 'INVALID_EVENT_PROPOSAL', 'Proposal metadata is server-owned.');

    const world = this.engine.getState(worldId);
    const sequence = this.engine.getEvents(worldId, true).reduce((max, event) => Math.max(max, event.commit_sequence || 0), 0);
    const eventPayload = { ...body.event };
    delete eventPayload.idempotency_key;
    delete eventPayload.expected_revision;
    const request = { source_text: body.source_text, event: eventPayload };
    const requestHash = hashRequest(request);
    const existing = this.db.prepare('SELECT * FROM event_proposals WHERE world_id=? AND idempotency_key=?').get(worldId, body.idempotency_key.trim());
    if (existing) {
      if (existing.request_hash !== requestHash) throw new EngineError('IDEMPOTENCY_KEY_CONFLICT', 'Proposal idempotency key was reused with different content.', 409);
      return this.publicProposal(existing, true);
    }

    const proposalId = randomUUID();
    const createdAt = now();
    const proposalHash = hashRequest({
      proposal_id: proposalId, world_id: worldId, base_world_revision: world.world_revision,
      base_commit_sequence: sequence, event: eventPayload, source_text: body.source_text,
    });
    try {
      this.db.prepare(`INSERT INTO event_proposals(
        proposal_id,world_id,idempotency_key,request_hash,proposal_hash,status,base_world_revision,base_commit_sequence,
        event_payload_json,source_text,created_at
      ) VALUES(?,?,?,?,?,'pending',?,?,?,?,?)`).run(
        proposalId, worldId, body.idempotency_key.trim(), requestHash, proposalHash, world.world_revision,
        sequence, enc(eventPayload), body.source_text, createdAt,
      );
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) throw new EngineError('PROPOSAL_IDEMPOTENCY_CONFLICT', 'Proposal idempotency key conflicts with an existing proposal.', 409);
      throw error;
    }
    this.db.prepare('INSERT INTO audit_entries(world_id,world_revision,action,target_id,payload_json,occurred_at) VALUES(?,?,?,?,?,?)')
      .run(worldId, world.world_revision, 'proposal.created', proposalId, enc({ proposal_hash: proposalHash, base_world_revision: world.world_revision, base_commit_sequence: sequence }), createdAt);
    return this.publicProposal(this.db.prepare('SELECT * FROM event_proposals WHERE proposal_id=?').get(proposalId), false);
  }

  get(worldId, proposalId) {
    const row = this.db.prepare('SELECT * FROM event_proposals WHERE world_id=? AND proposal_id=?').get(worldId, proposalId);
    if (!row) throw new EngineError('PROPOSAL_NOT_FOUND', 'Proposal not found.', 404);
    return this.publicProposal(row, false);
  }

  approve(worldId, proposalId) {
    return this.engine.store.tx(() => {
      const row = this.db.prepare('SELECT * FROM event_proposals WHERE world_id=? AND proposal_id=?').get(worldId, proposalId);
      if (!row) throw new EngineError('PROPOSAL_NOT_FOUND', 'Proposal not found.', 404);
      if (row.status !== 'pending') throw new EngineError('PROPOSAL_STATE_CONFLICT', 'Only pending proposals can be approved.', 409, { status: row.status });
      const world = this.engine.store.world(worldId);
      if (!world) throw new EngineError('WORLD_NOT_FOUND', 'World not found.', 404);
      if (world.world_revision !== row.base_world_revision) throw new EngineError('STALE_PROPOSAL', 'World changed after this proposal was created.', 409, { base_world_revision: row.base_world_revision, current_world_revision: world.world_revision });
      const approvedAt = now();
      this.db.prepare("UPDATE event_proposals SET status='approved',approved_at=? WHERE proposal_id=? AND status='pending'").run(approvedAt, proposalId);
      this.db.prepare('INSERT INTO audit_entries(world_id,world_revision,action,target_id,payload_json,occurred_at) VALUES(?,?,?,?,?,?)')
        .run(worldId, world.world_revision, 'proposal.approved', proposalId, enc({ proposal_hash: row.proposal_hash, approver: 'approval_credential' }), approvedAt);
      return this.publicProposal(this.db.prepare('SELECT * FROM event_proposals WHERE proposal_id=?').get(proposalId), false);
    });
  }

  commit(worldId, proposalId) {
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
    return this.engine.store.tx(() => {
      const current = this.db.prepare('SELECT * FROM event_proposals WHERE proposal_id=?').get(proposalId);
      if (current.status === 'committed') return { ...this.publicProposal(current, true), commit_result: dec(current.commit_result_json) };
      const committedAt = now();
      this.db.prepare("UPDATE event_proposals SET status='committed',committed_at=?,commit_result_json=? WHERE proposal_id=? AND status='approved'")
        .run(committedAt, enc(result), proposalId);
      this.db.prepare('INSERT INTO audit_entries(world_id,world_revision,action,target_id,payload_json,occurred_at) VALUES(?,?,?,?,?,?)')
        .run(worldId, result.world_revision, 'proposal.committed', proposalId, enc({ proposal_hash: row.proposal_hash, event_id: result.event_id }), committedAt);
      const updated = this.db.prepare('SELECT * FROM event_proposals WHERE proposal_id=?').get(proposalId);
      return { ...this.publicProposal(updated, false), commit_result: result };
    });
  }


  cancel(worldId, proposalId, reason = 'adapter_cancelled') {
    return this.engine.store.tx(() => {
      const row = this.db.prepare('SELECT * FROM event_proposals WHERE world_id=? AND proposal_id=?').get(worldId, proposalId);
      if (!row) throw new EngineError('PROPOSAL_NOT_FOUND', 'Proposal not found.', 404);
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
      base_commit_sequence: row.base_commit_sequence, source_text: row.source_text,
      created_at: row.created_at, approved_at: row.approved_at, committed_at: row.committed_at,
      idempotent_replay: replay,
    };
  }
}
