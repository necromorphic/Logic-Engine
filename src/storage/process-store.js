import { EngineError } from '../core/errors.js';
import { hashRequest } from '../core/request-hash.js';
import { deriveProcessProgress, deriveProcessState, validateProcessTransition } from '../process/contract.js';

const now = () => new Date().toISOString();
const enc = (value) => JSON.stringify(value);
const dec = (value) => value == null ? null : JSON.parse(value);

function publicProcess(row, milestoneRows) {
  if (!row) return null;
  const definition = dec(row.definition_json);
  const milestones = milestoneRows.map((milestone) => ({
    ...dec(milestone.definition_json),
    status: milestone.status,
    completed_event_ids: dec(milestone.completed_event_ids_json),
    checkpoint_version: milestone.checkpoint_version,
    updated_at: milestone.updated_at,
  }));
  const statuses = Object.fromEntries(milestones.map((item) => [item.milestone_id, item.status]));
  const progress = deriveProcessProgress(definition, statuses);
  return {
    process_id: row.process_id,
    world_id: row.world_id,
    definition_version: row.definition_version,
    status: deriveProcessState(row.status, progress),
    stored_status: row.status,
    version: row.version,
    definition,
    progress,
    created_revision: row.created_revision,
    created_at: row.created_at,
    updated_at: row.updated_at,
    milestones,
    last_error: dec(row.last_error_json),
  };
}

export class ProcessStore {
  constructor(store) {
    this.store = store;
    this.db = store.db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS world_processes(
        world_id TEXT NOT NULL REFERENCES worlds(world_id),
        process_id TEXT NOT NULL,
        definition_version TEXT NOT NULL,
        definition_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('scheduled','running','paused','completed','cancelled','failed','needs_review')),
        version INTEGER NOT NULL DEFAULT 1,
        idempotency_key TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        created_revision INTEGER NOT NULL,
        last_error_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(world_id,process_id),
        UNIQUE(world_id,idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS world_processes_status
        ON world_processes(world_id,status,updated_at);
      CREATE TABLE IF NOT EXISTS world_process_milestones(
        world_id TEXT NOT NULL,
        process_id TEXT NOT NULL,
        milestone_id TEXT NOT NULL,
        trigger_id TEXT NOT NULL,
        due_coordinate INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','completed','cancelled','blocked','needs_review')),
        prerequisites_json TEXT NOT NULL,
        definition_json TEXT NOT NULL,
        completed_event_ids_json TEXT NOT NULL DEFAULT '[]',
        checkpoint_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(world_id,process_id,milestone_id),
        UNIQUE(world_id,trigger_id),
        FOREIGN KEY(world_id,process_id) REFERENCES world_processes(world_id,process_id) ON DELETE CASCADE,
        FOREIGN KEY(world_id,trigger_id) REFERENCES world_time_triggers(world_id,trigger_id)
      );
      CREATE INDEX IF NOT EXISTS world_process_milestones_trigger
        ON world_process_milestones(world_id,trigger_id);
      CREATE TABLE IF NOT EXISTS world_process_operations(
        world_id TEXT NOT NULL REFERENCES worlds(world_id),
        idempotency_key TEXT NOT NULL,
        process_id TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(world_id,idempotency_key)
      );
    `);
  }

  get(worldId, processId) {
    const row = this.db.prepare('SELECT * FROM world_processes WHERE world_id=? AND process_id=?').get(worldId, processId);
    if (!row) throw new EngineError('PROCESS_NOT_FOUND', 'Process not found in this world.', 404);
    const milestones = this.db.prepare('SELECT * FROM world_process_milestones WHERE world_id=? AND process_id=? ORDER BY due_coordinate,milestone_id')
      .all(worldId, processId);
    return publicProcess(row, milestones);
  }

  list(worldId) {
    if (!this.store.world(worldId)) throw new EngineError('WORLD_NOT_FOUND', 'World not found.', 404);
    return this.db.prepare('SELECT process_id FROM world_processes WHERE world_id=? ORDER BY created_at,process_id')
      .all(worldId).map((row) => this.get(worldId, row.process_id));
  }

  findByKey(worldId, idempotencyKey) {
    const row = this.db.prepare('SELECT * FROM world_processes WHERE world_id=? AND idempotency_key=?')
      .get(worldId, idempotencyKey);
    return row ? this.get(worldId, row.process_id) : null;
  }

  createRecord({ worldId, process, idempotencyKey, requestHash, expectedRevision }) {
    return this.store.tx(() => {
      const world = this.store.world(worldId);
      if (!world) throw new EngineError('WORLD_NOT_FOUND', 'World not found.', 404);
      const old = this.db.prepare('SELECT * FROM world_processes WHERE world_id=? AND idempotency_key=?')
        .get(worldId, idempotencyKey);
      if (old) {
        if (old.request_hash !== requestHash) throw new EngineError('IDEMPOTENCY_CONFLICT', 'The process idempotency key was reused with different content.', 409);
        return { process: this.get(worldId, old.process_id), idempotent_replay: true };
      }
      if (world.world_revision !== expectedRevision) {
        throw new EngineError('REVISION_CONFLICT', 'World changed before process creation.', 409, {
          expected_revision: expectedRevision, current_revision: world.world_revision,
        });
      }
      if (this.db.prepare('SELECT 1 FROM world_processes WHERE world_id=? AND process_id=?').get(worldId, process.process_id)) {
        throw new EngineError('PROCESS_ALREADY_EXISTS', 'Process identity already exists in this world.', 409, { process_id: process.process_id });
      }
      const stamp = now();
      this.db.prepare(`INSERT INTO world_processes(
        world_id,process_id,definition_version,definition_json,status,version,idempotency_key,request_hash,
        created_revision,last_error_json,created_at,updated_at
      ) VALUES(?,?,?,?, 'scheduled',1,?,?,?,NULL,?,?)`).run(
        worldId, process.process_id, process.definition_version, enc(process), idempotencyKey, requestHash,
        world.world_revision + 1, stamp, stamp,
      );
      this.db.prepare('INSERT INTO audit_entries(world_id,world_revision,action,target_id,payload_json,occurred_at) VALUES(?,?,?,?,?,?)')
        .run(worldId, world.world_revision + 1, 'process.created', process.process_id, enc({
          definition_version: process.definition_version, milestone_count: process.milestones.length, request_hash: requestHash,
        }), stamp);
      return { process_id: process.process_id, idempotent_replay: false };
    });
  }

  addMilestones(worldId, process) {
    return this.store.tx(() => {
      const stamp = now();
      for (const milestone of process.milestones) {
        this.db.prepare(`INSERT INTO world_process_milestones(
          world_id,process_id,milestone_id,trigger_id,due_coordinate,status,prerequisites_json,
          definition_json,completed_event_ids_json,checkpoint_version,created_at,updated_at
        ) VALUES(?,?,?,?,?,'pending',?,?, '[]',1,?,?)`).run(
          worldId, process.process_id, milestone.milestone_id, milestone.trigger_id, milestone.due_coordinate,
          enc(milestone.prerequisites), enc(milestone), stamp, stamp,
        );
      }
      return this.get(worldId, process.process_id);
    });
  }

  finalizeCreate(worldId, processId) {
    this.store.tx(() => {
      const world = this.store.world(worldId);
      this.db.prepare('UPDATE world_processes SET created_revision=?,updated_at=? WHERE world_id=? AND process_id=?')
        .run(world.world_revision, now(), worldId, processId);
    });
    return this.get(worldId, processId);
  }

  completeTrigger(worldId, triggerId, eventIds, operationId) {
    return this.store.tx(() => {
      const milestone = this.db.prepare('SELECT * FROM world_process_milestones WHERE world_id=? AND trigger_id=?')
        .get(worldId, triggerId);
      if (!milestone) return null;
      if (milestone.status === 'completed') return this.get(worldId, milestone.process_id);
      if (milestone.status !== 'pending') {
        throw new EngineError('PROCESS_MILESTONE_CHECKPOINT_CONFLICT', 'Only a pending process milestone can be completed.', 409, {
          process_id: milestone.process_id, milestone_id: milestone.milestone_id, status: milestone.status,
        });
      }
      const processRow = this.db.prepare('SELECT * FROM world_processes WHERE world_id=? AND process_id=?')
        .get(worldId, milestone.process_id);
      if (!processRow || !['scheduled','running'].includes(processRow.status)) {
        throw new EngineError('PROCESS_NOT_RUNNABLE', 'Process status does not permit milestone completion.', 409, {
          process_id: milestone.process_id, status: processRow?.status ?? null,
        });
      }
      const stamp = now();
      const ids = [...new Set(eventIds)];
      this.db.prepare(`UPDATE world_process_milestones SET status='completed',completed_event_ids_json=?,
        checkpoint_version=checkpoint_version+1,updated_at=? WHERE world_id=? AND process_id=? AND milestone_id=? AND status='pending'`)
        .run(enc(ids), stamp, worldId, milestone.process_id, milestone.milestone_id);
      const rows = this.db.prepare('SELECT * FROM world_process_milestones WHERE world_id=? AND process_id=? ORDER BY due_coordinate,milestone_id')
        .all(worldId, milestone.process_id);
      const definition = dec(processRow.definition_json);
      const progress = deriveProcessProgress(definition, Object.fromEntries(rows.map((row) => [row.milestone_id, row.status])));
      const nextStatus = progress.all_completed ? 'completed' : 'running';
      this.db.prepare('UPDATE world_processes SET status=?,version=version+1,last_error_json=NULL,updated_at=? WHERE world_id=? AND process_id=?')
        .run(nextStatus, stamp, worldId, milestone.process_id);
      const world = this.store.world(worldId);
      this.db.prepare('INSERT INTO audit_entries(world_id,world_revision,action,target_id,payload_json,occurred_at) VALUES(?,?,?,?,?,?)')
        .run(worldId, world.world_revision, 'process.milestone.completed', milestone.process_id, enc({
          milestone_id: milestone.milestone_id, trigger_id: triggerId, operation_id: operationId,
          event_ids: ids, process_status: nextStatus,
        }), stamp);
      return this.get(worldId, milestone.process_id);
    });
  }

  replayOperation(worldId, idempotencyKey, requestHash) {
    const oldOperation = this.db.prepare('SELECT * FROM world_process_operations WHERE world_id=? AND idempotency_key=?')
      .get(worldId, idempotencyKey);
    if (!oldOperation) return null;
    if (oldOperation.request_hash !== requestHash) throw new EngineError('IDEMPOTENCY_CONFLICT', 'The process-operation key was reused with different content.', 409);
    return { process: this.get(worldId, oldOperation.process_id), idempotent_replay: true };
  }

  transition(worldId, processId, targetState, { expectedVersion, idempotencyKey, requestHash }) {
    return this.store.tx(() => {
      const replay = this.replayOperation(worldId, idempotencyKey, requestHash);
      if (replay) return replay;
      const current = this.db.prepare('SELECT * FROM world_processes WHERE world_id=? AND process_id=?')
        .get(worldId, processId);
      if (!current) throw new EngineError('PROCESS_NOT_FOUND', 'Process not found in this world.', 404);
      if (current.version !== expectedVersion) throw new EngineError('PROCESS_VERSION_CONFLICT', 'Process checkpoint changed before transition.', 409, {
        expected_version: expectedVersion, current_version: current.version,
      });
      const transition = validateProcessTransition(current.status, targetState);
      if (transition.idempotent) {
        const process = this.get(worldId, processId);
        this.db.prepare('INSERT INTO world_process_operations(world_id,idempotency_key,process_id,request_hash,result_json,created_at) VALUES(?,?,?,?,?,?)')
          .run(worldId, idempotencyKey, processId, requestHash, enc(process), now());
        return { process, idempotent_replay: true };
      }
      const stamp = now();
      this.db.prepare('UPDATE world_processes SET status=?,version=version+1,last_error_json=NULL,updated_at=? WHERE world_id=? AND process_id=?')
        .run(targetState, stamp, worldId, processId);
      const process = this.get(worldId, processId);
      this.db.prepare('INSERT INTO audit_entries(world_id,world_revision,action,target_id,payload_json,occurred_at) VALUES(?,?,?,?,?,?)')
        .run(worldId, this.store.world(worldId).world_revision, 'process.lifecycle.transitioned', processId, enc({
          from: current.status, to: targetState, version: process.version, idempotency_key: idempotencyKey,
        }), stamp);
      this.db.prepare('INSERT INTO world_process_operations(world_id,idempotency_key,process_id,request_hash,result_json,created_at) VALUES(?,?,?,?,?,?)')
        .run(worldId, idempotencyKey, processId, requestHash, enc(process), stamp);
      return { process, idempotent_replay: false };
    });
  }

  replacePendingTriggers(worldId, processId, updates) {
    return this.store.tx(() => {
      const row = this.db.prepare('SELECT * FROM world_processes WHERE world_id=? AND process_id=?').get(worldId, processId);
      if (!row) throw new EngineError('PROCESS_NOT_FOUND', 'Process not found in this world.', 404);
      const definition = dec(row.definition_json);
      const byId = new Map(updates.map((item) => [item.milestone_id, item]));
      definition.milestones = definition.milestones.map((milestone) => {
        const update = byId.get(milestone.milestone_id);
        return update ? { ...milestone, trigger_id: update.trigger_id } : milestone;
      });
      const stamp = now();
      for (const update of updates) {
        this.db.prepare('UPDATE world_process_milestones SET trigger_id=?,definition_json=?,checkpoint_version=checkpoint_version+1,updated_at=? WHERE world_id=? AND process_id=? AND milestone_id=? AND status='pending'')
          .run(update.trigger_id, enc({ ...definition.milestones.find((item) => item.milestone_id === update.milestone_id) }), stamp, worldId, processId, update.milestone_id);
      }
      this.db.prepare('UPDATE world_processes SET definition_json=?,updated_at=? WHERE world_id=? AND process_id=?')
        .run(enc(definition), stamp, worldId, processId);
      return this.get(worldId, processId);
    });
  }

  markNeedsReview(worldId, processId, code, message) {
    return this.store.tx(() => {
      const stamp = now();
      this.db.prepare(`UPDATE world_processes SET status='needs_review',version=version+1,last_error_json=?,updated_at=?
        WHERE world_id=? AND process_id=? AND status IN ('scheduled','running','paused','needs_review')`)
        .run(enc({ code, message }), stamp, worldId, processId);
      const world = this.store.world(worldId);
      this.db.prepare('INSERT INTO audit_entries(world_id,world_revision,action,target_id,payload_json,occurred_at) VALUES(?,?,?,?,?,?)')
        .run(worldId, world.world_revision, 'process.needs_review', processId, enc({ code, message }), stamp);
      return this.get(worldId, processId);
    });
  }
}
