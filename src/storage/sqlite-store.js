import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { EngineError } from '../core/errors.js';

const now = () => new Date().toISOString();
const enc = (x) => JSON.stringify(x);
const dec = (x) => x == null ? null : JSON.parse(x);
const refs = (effects) => effects.map((e) => e.kind.startsWith('entity.') ? 'entity:' + e.entity_id : 'fact:' + e.fact_id);
const world = (r) => r && ({
  world_id: r.world_id,
  world_pack_id: r.world_pack_id,
  world_pack_version: r.world_pack_version,
  initial_game_time: r.initial_game_time,
  game_time: r.game_time,
  world_revision: r.world_revision,
  status: r.status,
  created_at: r.created_at,
});

export class SQLiteStore {
  constructor(path = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA foreign_keys=ON;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS worlds(
        world_id TEXT PRIMARY KEY, world_pack_id TEXT NOT NULL, world_pack_version TEXT NOT NULL,
        initial_game_time TEXT NOT NULL, game_time TEXT NOT NULL, world_revision INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS world_events(
        event_id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(world_id), turn_id TEXT NOT NULL,
        generation_id TEXT, event_type TEXT NOT NULL, game_time TEXT NOT NULL, committed_revision INTEGER NOT NULL,
        validity TEXT NOT NULL CHECK(validity IN ('valid','retracted','invalidated')),
        caused_by_json TEXT NOT NULL, depends_on_json TEXT NOT NULL, read_set_json TEXT NOT NULL,
        effects_json TEXT NOT NULL, time_advance_seconds INTEGER NOT NULL DEFAULT 0, source_message_id TEXT,
        created_at TEXT NOT NULL, rollback_id TEXT
      );
      CREATE INDEX IF NOT EXISTS events_revision ON world_events(world_id,committed_revision);
      CREATE TABLE IF NOT EXISTS entities(
        world_id TEXT NOT NULL REFERENCES worlds(world_id), entity_id TEXT NOT NULL, entity_type TEXT NOT NULL,
        status TEXT NOT NULL, attributes_json TEXT NOT NULL, created_by_event_id TEXT NOT NULL,
        updated_revision INTEGER NOT NULL, PRIMARY KEY(world_id,entity_id)
      );
      CREATE TABLE IF NOT EXISTS fact_claims(
        world_id TEXT NOT NULL REFERENCES worlds(world_id), fact_id TEXT NOT NULL, event_id TEXT NOT NULL,
        subject_ref TEXT, predicate TEXT NOT NULL, value_json TEXT NOT NULL, committed_revision INTEGER NOT NULL,
        PRIMARY KEY(world_id,fact_id,event_id)
      );
      CREATE TABLE IF NOT EXISTS facts(
        world_id TEXT NOT NULL REFERENCES worlds(world_id), fact_id TEXT NOT NULL, subject_ref TEXT,
        predicate TEXT NOT NULL, status TEXT NOT NULL, value_json TEXT, candidates_json TEXT NOT NULL,
        source_event_ids_json TEXT NOT NULL, updated_revision INTEGER NOT NULL, PRIMARY KEY(world_id,fact_id)
      );
      CREATE TABLE IF NOT EXISTS audit_entries(
        audit_id INTEGER PRIMARY KEY AUTOINCREMENT, world_id TEXT NOT NULL REFERENCES worlds(world_id),
        world_revision INTEGER NOT NULL, action TEXT NOT NULL, target_id TEXT, payload_json TEXT NOT NULL,
        occurred_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS idempotency_keys(
        world_id TEXT NOT NULL REFERENCES worlds(world_id), idempotency_key TEXT NOT NULL,
        request_hash TEXT, response_json TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY(world_id,idempotency_key)
      );
      CREATE TABLE IF NOT EXISTS rollbacks(
        rollback_id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(world_id),
        root_event_id TEXT NOT NULL, invalidated_event_ids_json TEXT NOT NULL, world_revision INTEGER NOT NULL,
        created_at TEXT NOT NULL, idempotency_key TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS schema_migrations(
        version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL
      );
    `);
    this.migrate();
  }

  migrate() {
    const migrations = [
      {
        version: 1,
        apply: () => {
          const columns = this.db.prepare('PRAGMA table_info(idempotency_keys)').all();
          if (!columns.some((column) => column.name === 'request_hash')) {
            this.db.exec('ALTER TABLE idempotency_keys ADD COLUMN request_hash TEXT');
          }
        },
      },
    ];
    for (const migration of migrations) {
      const applied = this.db.prepare('SELECT version FROM schema_migrations WHERE version=?').get(migration.version);
      if (applied) continue;
      this.tx(() => {
        migration.apply();
        this.db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(migration.version, now());
      });
    }
  }

  close() { this.db.close(); }

  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }

  world(id) {
    return world(this.db.prepare('SELECT * FROM worlds WHERE world_id=?').get(id));
  }

  createWorld(w) {
    return this.tx(() => {
      const t = now();
      try {
        this.db.prepare('INSERT INTO worlds(world_id,world_pack_id,world_pack_version,initial_game_time,game_time,created_at) VALUES(?,?,?,?,?,?)')
          .run(w.world_id, w.world_pack_id, w.world_pack_version, w.game_time, w.game_time, t);
      } catch (error) {
        if (String(error.message).includes('UNIQUE')) throw new EngineError('WORLD_ALREADY_EXISTS', 'World already exists.', 409);
        throw error;
      }
      this.db.prepare('INSERT INTO audit_entries(world_id,world_revision,action,target_id,payload_json,occurred_at) VALUES(?,0,?,?,?,?)')
        .run(w.world_id, 'world.created', w.world_id, enc({ world_pack_id: w.world_pack_id, world_pack_version: w.world_pack_version }), t);
      return this.world(w.world_id);
    });
  }

  state(id) {
    const w = this.world(id);
    if (!w) throw new EngineError('WORLD_NOT_FOUND', 'World not found.', 404);
    const entities = this.db.prepare('SELECT * FROM entities WHERE world_id=? ORDER BY entity_id').all(id).map((r) => ({
      entity_id: r.entity_id, entity_type: r.entity_type, status: r.status, attributes: dec(r.attributes_json),
      created_by_event_id: r.created_by_event_id, updated_revision: r.updated_revision,
    }));
    const facts = this.db.prepare('SELECT * FROM facts WHERE world_id=? ORDER BY fact_id').all(id).map((r) => ({
      fact_id: r.fact_id, subject_ref: r.subject_ref, predicate: r.predicate, status: r.status,
      value: dec(r.value_json), candidates: dec(r.candidates_json), source_event_ids: dec(r.source_event_ids_json),
      updated_revision: r.updated_revision,
    }));
    return { ...w, entities, facts };
  }

  events(id, includeInvalid = false) {
    if (!this.world(id)) throw new EngineError('WORLD_NOT_FOUND', 'World not found.', 404);
    const rows = this.db.prepare('SELECT * FROM world_events WHERE world_id=? ' + (includeInvalid ? '' : "AND validity='valid' ") + 'ORDER BY committed_revision,event_id').all(id);
    return rows.map((r) => ({
      event_id: r.event_id, turn_id: r.turn_id, generation_id: r.generation_id, event_type: r.event_type,
      game_time: r.game_time, committed_revision: r.committed_revision, validity: r.validity,
      caused_by: dec(r.caused_by_json), depends_on: dec(r.depends_on_json), read_set: dec(r.read_set_json),
      effects: dec(r.effects_json), time_advance_seconds: r.time_advance_seconds,
      source_message_id: r.source_message_id, created_at: r.created_at, rollback_id: r.rollback_id,
    }));
  }

  audit(id) {
    if (!this.world(id)) throw new EngineError('WORLD_NOT_FOUND', 'World not found.', 404);
    return this.db.prepare('SELECT * FROM audit_entries WHERE world_id=? ORDER BY audit_id').all(id).map((r) => ({
      audit_id: r.audit_id, world_revision: r.world_revision, action: r.action, target_id: r.target_id,
      payload: dec(r.payload_json), occurred_at: r.occurred_at,
    }));
  }

  replay(id, key, requestHash) {
    const row = this.db.prepare('SELECT request_hash,response_json FROM idempotency_keys WHERE world_id=? AND idempotency_key=?').get(id, key);
    if (!row) return null;
    if (!row.request_hash) {
      throw new EngineError('IDEMPOTENCY_KEY_UNVERIFIABLE', 'This key predates request fingerprints; use a new idempotency key.', 409);
    }
    if (row.request_hash !== requestHash) {
      throw new EngineError('IDEMPOTENCY_KEY_CONFLICT', 'Idempotency key was already used with a different request.', 409);
    }
    return dec(row.response_json);
  }

  saveReplay(id, key, requestHash, result) {
    this.db.prepare('INSERT INTO idempotency_keys(world_id,idempotency_key,request_hash,response_json,created_at) VALUES(?,?,?,?,?)')
      .run(id, key, requestHash, enc(result), now());
  }

  validateEventReference(worldId, eventId, nextRevision, fieldName) {
    const row = this.db.prepare('SELECT world_id,committed_revision,validity FROM world_events WHERE event_id=?').get(eventId);
    if (!row) throw new EngineError('INVALID_CAUSAL_REFERENCE', fieldName + ' references an event that does not exist: ' + eventId, 400, { field: fieldName, reference: eventId });
    if (row.world_id !== worldId) throw new EngineError('CROSS_WORLD_REFERENCE', fieldName + ' cannot reference an event from another world.', 400, { field: fieldName, reference: eventId });
    if (row.validity !== 'valid') throw new EngineError('INVALID_CAUSAL_REFERENCE', fieldName + ' references an invalid event: ' + eventId, 400, { field: fieldName, reference: eventId });
    if (row.committed_revision >= nextRevision) throw new EngineError('INVALID_CAUSAL_REFERENCE', fieldName + ' must reference a prior event.', 400, { field: fieldName, reference: eventId });
  }

  validateCausalMetadata(worldId, event, nextRevision) {
    for (const eventId of event.caused_by) this.validateEventReference(worldId, eventId, nextRevision, 'caused_by');
    for (const ref of event.depends_on) {
      if (ref.startsWith('entity:')) {
        const entityId = ref.slice('entity:'.length);
        if (!entityId || !this.db.prepare('SELECT 1 FROM entities WHERE world_id=? AND entity_id=?').get(worldId, entityId)) {
          throw new EngineError('INVALID_DEPENDENCY_REFERENCE', 'depends_on references an entity that does not exist in this world: ' + ref, 400, { reference: ref });
        }
      } else if (ref.startsWith('fact:')) {
        const factId = ref.slice('fact:'.length);
        if (!factId || !this.db.prepare('SELECT 1 FROM facts WHERE world_id=? AND fact_id=?').get(worldId, factId)) {
          throw new EngineError('INVALID_DEPENDENCY_REFERENCE', 'depends_on references a fact that does not exist in this world: ' + ref, 400, { reference: ref });
        }
      } else {
        this.validateEventReference(worldId, ref, nextRevision, 'depends_on');
      }
    }
    for (const ref of event.read_set) {
      const isEntity = ref.startsWith('entity:') && ref.length > 'entity:'.length;
      const isFact = ref.startsWith('fact:') && ref.length > 'fact:'.length;
      if (!isEntity && !isFact) {
        throw new EngineError('INVALID_READ_SET_REFERENCE', 'This runtime supports read_set references of the form entity:id or fact:id.', 400, { reference: ref });
      }
    }
  }

  commit(id, x) {
    return this.tx(() => {
      const old = this.replay(id, x.idempotency_key, x.request_hash);
      if (old) return { ...old, idempotent_replay: true };
      const w = this.world(id);
      if (!w) throw new EngineError('WORLD_NOT_FOUND', 'World not found.', 404);
      if (x.expected_revision !== undefined && x.expected_revision !== w.world_revision) {
        throw new EngineError('REVISION_CONFLICT', 'World changed after proposal preparation.', 409, {
          expected_revision: x.expected_revision, current_revision: w.world_revision,
        });
      }
      const eventId = x.event_id || randomUUID();
      if (this.db.prepare('SELECT event_id FROM world_events WHERE event_id=?').get(eventId)) {
        throw new EngineError('EVENT_ALREADY_EXISTS', 'Event ID already exists.', 409);
      }
      const revision = w.world_revision + 1;
      this.validateCausalMetadata(id, x, revision);
      const time = new Date(Date.parse(w.game_time) + x.time_advance_seconds * 1000).toISOString();
      const createdAt = now();
      this.db.prepare(`INSERT INTO world_events(
        event_id,world_id,turn_id,generation_id,event_type,game_time,committed_revision,validity,
        caused_by_json,depends_on_json,read_set_json,effects_json,time_advance_seconds,source_message_id,created_at
      ) VALUES(?,?,?,?,?,?,?,'valid',?,?,?,?,?,?,?)`).run(
        eventId, id, x.turn_id, x.generation_id || null, x.event_type, time, revision,
        enc(x.caused_by), enc(x.depends_on), enc(x.read_set), enc(x.effects), x.time_advance_seconds,
        x.source_message_id || null, createdAt,
      );
      this.db.prepare('UPDATE worlds SET world_revision=?,game_time=? WHERE world_id=?').run(revision, time, id);
      this.rebuild(id, revision);
      const result = {
        accepted: true, event_id: eventId, world_id: id, world_revision: revision,
        game_time: this.world(id).game_time, effect_count: x.effects.length, idempotent_replay: false,
      };
      this.db.prepare('INSERT INTO audit_entries(world_id,world_revision,action,target_id,payload_json,occurred_at) VALUES(?,?,\'event.committed\',?,?,?)')
        .run(id, revision, eventId, enc({
          turn_id: x.turn_id, caused_by: x.caused_by, depends_on: x.depends_on,
          read_set: x.read_set, effects: x.effects, time_advance_seconds: x.time_advance_seconds,
        }), createdAt);
      this.saveReplay(id, x.idempotency_key, x.request_hash, result);
      return result;
    });
  }

  rollback(id, rootId, key, requestHash) {
    return this.tx(() => {
      const old = this.replay(id, key, requestHash);
      if (old) return { ...old, idempotent_replay: true };
      const w = this.world(id);
      if (!w) throw new EngineError('WORLD_NOT_FOUND', 'World not found.', 404);
      const root = this.db.prepare('SELECT * FROM world_events WHERE world_id=? AND event_id=?').get(id, rootId);
      if (!root) throw new EngineError('EVENT_NOT_FOUND', 'Event not found.', 404);
      if (root.validity !== 'valid') {
        const result = {
          accepted: true, rollback_id: null, root_event_id: rootId, invalidated_event_ids: [],
          world_revision: w.world_revision, no_op: true, idempotent_replay: false,
        };
        this.saveReplay(id, key, requestHash, result);
        return result;
      }
      const all = this.events(id, true);
      const invalid = new Set([rootId]);
      const affected = new Set(refs(dec(root.effects_json)));
      let changed = true;
      while (changed) {
        changed = false;
        for (const event of all) {
          if (event.validity !== 'valid' || invalid.has(event.event_id)) continue;
          if (event.caused_by.some((value) => invalid.has(value))
            || event.depends_on.some((value) => invalid.has(value) || affected.has(value))
            || event.read_set.some((value) => affected.has(value))) {
            invalid.add(event.event_id);
            refs(event.effects).forEach((value) => affected.add(value));
            changed = true;
          }
        }
      }
      const rollbackId = randomUUID();
      const revision = w.world_revision + 1;
      const createdAt = now();
      const ids = [...invalid];
      const update = this.db.prepare('UPDATE world_events SET validity=?,rollback_id=? WHERE world_id=? AND event_id=?');
      for (const eventId of ids) update.run(eventId === rootId ? 'retracted' : 'invalidated', rollbackId, id, eventId);
      this.db.prepare('UPDATE worlds SET world_revision=? WHERE world_id=?').run(revision, id);
      this.db.prepare('INSERT INTO rollbacks(rollback_id,world_id,root_event_id,invalidated_event_ids_json,world_revision,created_at,idempotency_key) VALUES(?,?,?,?,?,?,?)')
        .run(rollbackId, id, rootId, enc(ids), revision, createdAt, key);
      this.rebuild(id, revision);
      const result = {
        accepted: true, rollback_id: rollbackId, root_event_id: rootId, invalidated_event_ids: ids,
        world_revision: revision, no_op: false, idempotent_replay: false,
      };
      this.db.prepare("INSERT INTO audit_entries(world_id,world_revision,action,target_id,payload_json,occurred_at) VALUES(?,?,\'rollback.applied\',?,?,?)")
        .run(id, revision, rollbackId, enc({ root_event_id: rootId, invalidated_event_ids: ids }), createdAt);
      this.saveReplay(id, key, requestHash, result);
      return result;
    });
  }

  rebuild(id, revision) {
    this.db.prepare('DELETE FROM entities WHERE world_id=?').run(id);
    this.db.prepare('DELETE FROM facts WHERE world_id=?').run(id);
    this.db.prepare('DELETE FROM fact_claims WHERE world_id=?').run(id);
    const events = this.db.prepare("SELECT * FROM world_events WHERE world_id=? AND validity='valid' ORDER BY committed_revision,event_id").all(id);
    const upsertEntity = this.db.prepare(`INSERT INTO entities(
      world_id,entity_id,entity_type,status,attributes_json,created_by_event_id,updated_revision
    ) VALUES(?,?,?,?,?,?,?) ON CONFLICT(world_id,entity_id) DO UPDATE SET
      entity_type=excluded.entity_type,status=excluded.status,attributes_json=excluded.attributes_json,
      created_by_event_id=excluded.created_by_event_id,updated_revision=excluded.updated_revision`);
    const insertClaim = this.db.prepare('INSERT INTO fact_claims(world_id,fact_id,event_id,subject_ref,predicate,value_json,committed_revision) VALUES(?,?,?,?,?,?,?)');
    for (const event of events) {
      for (const effect of dec(event.effects_json)) {
        if (effect.kind === 'entity.upsert') {
          upsertEntity.run(id, effect.entity_id, effect.entity_type, effect.status || 'active', enc(effect.attributes || {}), event.event_id, event.committed_revision);
        } else if (effect.kind === 'entity.delete') {
          upsertEntity.run(id, effect.entity_id, 'unknown', 'destroyed', '{}', event.event_id, event.committed_revision);
        } else if (effect.kind === 'fact.set') {
          insertClaim.run(id, effect.fact_id, event.event_id, effect.subject_ref || null, effect.predicate, enc(effect.value), event.committed_revision);
        }
      }
    }
    const claims = this.db.prepare('SELECT * FROM fact_claims WHERE world_id=? ORDER BY committed_revision,event_id').all(id);
    const groups = new Map();
    for (const claim of claims) {
      const group = groups.get(claim.fact_id) || [];
      group.push(claim);
      groups.set(claim.fact_id, group);
    }
    const insertFact = this.db.prepare('INSERT INTO facts(world_id,fact_id,subject_ref,predicate,status,value_json,candidates_json,source_event_ids_json,updated_revision) VALUES(?,?,?,?,?,?,?,?,?)');
    for (const [factId, group] of groups) {
      const values = new Map(group.map((claim) => [claim.value_json, dec(claim.value_json)]));
      const last = group.at(-1);
      const conflict = values.size > 1;
      insertFact.run(id, factId, last.subject_ref, last.predicate, conflict ? 'conflicted' : 'active',
        conflict ? null : last.value_json, enc([...values.values()]), enc(group.map((claim) => claim.event_id)), revision);
    }
  }
}
