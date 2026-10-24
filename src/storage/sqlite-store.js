import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import { EngineError } from '../core/errors.js';
import { hashRequest } from '../core/request-hash.js';
import { evaluateRelationshipCandidate } from '../relationship/evaluate-candidate.js';

const now = () => new Date().toISOString();
const enc = (x) => JSON.stringify(x);
const dec = (x) => x == null ? null : JSON.parse(x);
const timeAdvanceOperation = (row) => row && ({
  operation_id: row.operation_id,
  world_id: row.world_id,
  idempotency_key: row.idempotency_key,
  request_hash: row.request_hash,
  from_coordinate: row.from_coordinate,
  target_coordinate: row.target_coordinate,
  confirmed_coordinate: row.confirmed_coordinate,
  starting_world_revision: row.starting_world_revision,
  current_world_revision: row.current_world_revision,
  status: row.status,
  next_segment_index: row.next_segment_index,
  segment_count: JSON.parse(row.segments_json).length,
  plan: dec(row.plan_json),
  result: dec(row.result_json),
  error: dec(row.error_json),
  created_at: row.created_at,
  updated_at: row.updated_at,
});
const relationshipRef = (subjectId, targetId) => 'relationship:' + encodeURIComponent(subjectId) + '/' + encodeURIComponent(targetId);
const parseRelationshipRef = (value) => {
  if (typeof value !== 'string' || !value.startsWith('relationship:')) return null;
  const pair = value.slice('relationship:'.length).split('/');
  if (pair.length !== 2) return null;
  try {
    const subjectId = decodeURIComponent(pair[0]);
    const targetId = decodeURIComponent(pair[1]);
    return subjectId && targetId ? { subjectId, targetId } : null;
  } catch { return null; }
};
const refs = (effects) => effects.map((e) => e.kind === 'relationship.transition'
  ? relationshipRef(e.subject_id, e.target_id)
  : e.kind.startsWith('entity.') ? 'entity:' + e.entity_id
    : e.kind.startsWith('mechanic.instance.') ? 'mechanic:' + e.instance_id : 'fact:' + e.fact_id);
const applyEntityEffects = (entities, effects) => {
  for (const effect of effects) {
    if (effect.kind === 'entity.create' || effect.kind === 'entity.upsert') {
      entities.set(effect.entity_id, {
        entity_id: effect.entity_id,
        entity_type: effect.entity_type,
        status: effect.status || 'active',
        attributes: effect.attributes || {},
      });
    } else if (effect.kind === 'entity.update') {
      const current = entities.get(effect.entity_id);
      if (current) {
        const attributes = { ...current.attributes, ...(effect.attributes || {}) };
        for (const key of effect.remove_attributes || []) delete attributes[key];
        entities.set(effect.entity_id, { ...current, status: effect.status ?? current.status, attributes });
      }
    } else if (effect.kind === 'entity.delete') {
      entities.set(effect.entity_id, {
        entity_id: effect.entity_id,
        entity_type: 'unknown',
        status: 'destroyed',
        attributes: {},
      });
    }
  }
};

const predicateResult = (entities, predicate, facts = new Map()) => {
  if (predicate.kind === 'fact_absent') return facts.has(predicate.fact_id) ? 'false' : 'true';
  if (predicate.kind === 'fact_value') {
    const fact = facts.get(predicate.fact_id);
    if (!fact) return 'false';
    if (fact.status === 'conflicted' || fact.values?.length > 1) return 'unknown';
    const actual = fact.status === 'active' ? fact.value : fact.values?.[0];
    return isDeepStrictEqual(actual, predicate.value) ? 'true' : 'false';
  }
  const entity = entities.get(predicate.entity_id);
  if (predicate.kind === 'entity_exists') return entity ? 'true' : 'false';
  if (predicate.kind === 'entity_absent') return !entity || entity.status === 'destroyed' ? 'true' : 'false';
  if (predicate.kind === 'entity_attribute') {
    if (!entity) return 'false';
    const actual = predicate.attribute === 'status' ? entity.status : entity.attributes[predicate.attribute];
    return isDeepStrictEqual(actual, predicate.value) ? 'true' : 'false';
  }
  return 'unknown';
};

const applyFactEffects = (facts, effects) => {
  for (const effect of effects) {
    if (effect.kind !== 'fact.set') continue;
    const claims = facts.get(effect.fact_id) || [];
    claims.push(effect.value);
    facts.set(effect.fact_id, claims);
  }
};

const factProjection = (claimsById) => {
  const facts = new Map();
  for (const [factId, claims] of claimsById) {
    const unique = [];
    for (const value of claims) {
      if (!unique.some((candidate) => isDeepStrictEqual(candidate, value))) unique.push(value);
    }
    facts.set(factId, unique.length > 1
      ? { status: 'conflicted', values: unique }
      : { status: 'active', value: unique[0], values: unique });
  }
  return facts;
};

const sameFactProjection = (left, right) => {
  if (!left || !right) return left === right;
  if (left.status !== right.status) return false;
  const leftValues = left.values ?? (left.value === undefined ? [] : [left.value]);
  const rightValues = right.values ?? (right.value === undefined ? [] : [right.value]);
  return leftValues.length === rightValues.length
    && leftValues.every((value) => rightValues.some((candidate) => isDeepStrictEqual(candidate, value)))
    && rightValues.every((value) => leftValues.some((candidate) => isDeepStrictEqual(candidate, value)));
};

const world = (r) => r && ({
  world_id: r.world_id,
  world_pack_id: r.world_pack_id,
  world_pack_version: r.world_pack_version,
  initial_game_time: r.initial_game_time,
  game_time: r.game_time,
  initial_game_time_coordinate: r.initial_game_time_coordinate,
  game_time_coordinate: r.game_time_coordinate,
  time_config_version: r.time_config_version ?? null,
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
        generation_id TEXT, context_manifest_id TEXT, event_type TEXT NOT NULL, game_time TEXT NOT NULL, committed_revision INTEGER NOT NULL,
        commit_sequence INTEGER NOT NULL, validity TEXT NOT NULL CHECK(validity IN ('valid','retracted','invalidated')),
        caused_by_json TEXT NOT NULL, depends_on_json TEXT NOT NULL, read_set_json TEXT NOT NULL,
        causal_links_json TEXT NOT NULL DEFAULT '[]', effects_json TEXT NOT NULL, time_advance_seconds INTEGER NOT NULL DEFAULT 0, source_message_id TEXT,
        created_at TEXT NOT NULL, rollback_id TEXT
      );
      CREATE INDEX IF NOT EXISTS events_revision ON world_events(world_id,committed_revision);
      CREATE TABLE IF NOT EXISTS entities(
        world_id TEXT NOT NULL REFERENCES worlds(world_id), entity_id TEXT NOT NULL, entity_type TEXT NOT NULL,
        status TEXT NOT NULL, attributes_json TEXT NOT NULL, created_by_event_id TEXT NOT NULL,
        updated_revision INTEGER NOT NULL, PRIMARY KEY(world_id,entity_id)
      );
      CREATE TABLE IF NOT EXISTS relationships(
        world_id TEXT NOT NULL REFERENCES worlds(world_id),
        subject_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        dimension TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('value','cleared')),
        value_json TEXT,
        rule_module_id TEXT NOT NULL,
        rule_module_version TEXT NOT NULL,
        last_event_id TEXT NOT NULL,
        updated_revision INTEGER NOT NULL,
        PRIMARY KEY(world_id,subject_id,target_id,dimension)
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
      CREATE TABLE IF NOT EXISTS context_manifests(
        manifest_id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(world_id),
        generation_id TEXT NOT NULL, base_commit_sequence INTEGER NOT NULL, base_world_revision INTEGER NOT NULL DEFAULT 0,
        items_json TEXT NOT NULL, manifest_hash TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(world_id,generation_id)
      );
      CREATE TABLE IF NOT EXISTS mechanic_templates(
        template_id TEXT NOT NULL, version TEXT NOT NULL, template_hash TEXT NOT NULL,
        template_json TEXT NOT NULL, registered_by TEXT NOT NULL, registered_at TEXT NOT NULL,
        PRIMARY KEY(template_id,version)
      );
      CREATE TABLE IF NOT EXISTS rule_module_manifests(
        module_id TEXT NOT NULL, version TEXT NOT NULL, manifest_hash TEXT NOT NULL,
        manifest_json TEXT NOT NULL, registered_by TEXT NOT NULL, registered_at TEXT NOT NULL,
        PRIMARY KEY(module_id,version)
      );
      CREATE TABLE IF NOT EXISTS mechanic_registry_audit(
        audit_id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, target_id TEXT NOT NULL,
        version TEXT NOT NULL, payload_json TEXT NOT NULL, registered_by TEXT NOT NULL, occurred_at TEXT NOT NULL
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
      {
        version: 2,
        apply: () => {
          const columns = this.db.prepare('PRAGMA table_info(world_events)').all();
          if (!columns.some((column) => column.name === 'causal_links_json')) {
            this.db.exec("ALTER TABLE world_events ADD COLUMN causal_links_json TEXT NOT NULL DEFAULT '[]'");
          }
        },
      },
      {
        version: 3,
        apply: () => {
          const columns = this.db.prepare('PRAGMA table_info(world_events)').all();
          if (!columns.some((column) => column.name === 'commit_sequence')) {
            this.db.exec('ALTER TABLE world_events ADD COLUMN commit_sequence INTEGER');
          }
          const worldRows = this.db.prepare('SELECT world_id FROM worlds ORDER BY world_id').all();
          const events = this.db.prepare('SELECT event_id FROM world_events WHERE world_id=? AND commit_sequence IS NULL ORDER BY committed_revision,event_id');
          const setSequence = this.db.prepare('UPDATE world_events SET commit_sequence=? WHERE world_id=? AND event_id=?');
          const nextSequence = this.db.prepare('SELECT COALESCE(MAX(commit_sequence),0)+1 AS next FROM world_events WHERE world_id=?');
          for (const { world_id: worldId } of worldRows) {
            let sequence = nextSequence.get(worldId).next;
            for (const { event_id: eventId } of events.all(worldId)) setSequence.run(sequence++, worldId, eventId);
          }
          this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS events_world_commit_sequence ON world_events(world_id,commit_sequence)');
        },
      },
      {
        version: 4,
        apply: () => {
          const columns = this.db.prepare('PRAGMA table_info(world_events)').all();
          if (!columns.some((column) => column.name === 'context_manifest_id')) {
            this.db.exec('ALTER TABLE world_events ADD COLUMN context_manifest_id TEXT');
          }
          this.db.exec(`CREATE TABLE IF NOT EXISTS context_manifests(
            manifest_id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(world_id),
            generation_id TEXT NOT NULL, base_commit_sequence INTEGER NOT NULL, base_world_revision INTEGER NOT NULL DEFAULT 0,
            items_json TEXT NOT NULL, manifest_hash TEXT NOT NULL, created_at TEXT NOT NULL,
            UNIQUE(world_id,generation_id)
          )`);
          const manifestColumns = this.db.prepare('PRAGMA table_info(context_manifests)').all();
          if (!manifestColumns.some((column) => column.name === 'base_world_revision')) {
            this.db.exec('ALTER TABLE context_manifests ADD COLUMN base_world_revision INTEGER NOT NULL DEFAULT 0');
          }
        },
      },
      {
        version: 5,
        apply: () => {
          this.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS events_world_event_id ON world_events(world_id,event_id);
            CREATE TABLE IF NOT EXISTS mechanic_instances(
              world_id TEXT NOT NULL REFERENCES worlds(world_id), instance_id TEXT NOT NULL,
              template_id TEXT NOT NULL, template_version TEXT NOT NULL,
              status TEXT NOT NULL CHECK(status IN ('disabled','enabled')),
              parameters_json TEXT NOT NULL, state_json TEXT NOT NULL,
              created_by_event_id TEXT NOT NULL, created_revision INTEGER NOT NULL,
              updated_revision INTEGER NOT NULL, disabled_at_revision INTEGER,
              needs_review_reason TEXT, last_event_id TEXT NOT NULL,
              PRIMARY KEY(world_id,instance_id),
              FOREIGN KEY(template_id,template_version) REFERENCES mechanic_templates(template_id,version),
              FOREIGN KEY(world_id,created_by_event_id) REFERENCES world_events(world_id,event_id),
              FOREIGN KEY(world_id,last_event_id) REFERENCES world_events(world_id,event_id)
            );`);
        },
      },
      {
        version: 6,
        apply: () => {
          const worldColumns = this.db.prepare('PRAGMA table_info(worlds)').all();
          if (!worldColumns.some((column) => column.name === 'initial_game_time_coordinate')) {
            this.db.exec('ALTER TABLE worlds ADD COLUMN initial_game_time_coordinate INTEGER NOT NULL DEFAULT 0');
          }
          if (!worldColumns.some((column) => column.name === 'game_time_coordinate')) {
            this.db.exec('ALTER TABLE worlds ADD COLUMN game_time_coordinate INTEGER NOT NULL DEFAULT 0');
          }
          const eventColumns = this.db.prepare('PRAGMA table_info(world_events)').all();
          if (!eventColumns.some((column) => column.name === 'game_time_coordinate')) {
            this.db.exec('ALTER TABLE world_events ADD COLUMN game_time_coordinate INTEGER NOT NULL DEFAULT 0');
          }
          if (!eventColumns.some((column) => column.name === 'time_advance_ms')) {
            this.db.exec('ALTER TABLE world_events ADD COLUMN time_advance_ms INTEGER NOT NULL DEFAULT 0');
          }

          const worldRows = this.db.prepare('SELECT world_id,initial_game_time,game_time FROM worlds ORDER BY world_id').all();
          const initialTimeByWorld = new Map();
          const updateWorldTime = this.db.prepare('UPDATE worlds SET initial_game_time_coordinate=0,game_time_coordinate=? WHERE world_id=?');
          for (const row of worldRows) {
            const initialMs = Date.parse(row.initial_game_time);
            const currentMs = Date.parse(row.game_time);
            const coordinate = currentMs - initialMs;
            if (!Number.isFinite(initialMs) || !Number.isFinite(currentMs) || !Number.isSafeInteger(coordinate)) {
              throw new Error('TIME_COORDINATE_MIGRATION_INVALID_WORLD_TIME: ' + row.world_id);
            }
            initialTimeByWorld.set(row.world_id, initialMs);
            updateWorldTime.run(coordinate, row.world_id);
          }

          const eventRows = this.db.prepare('SELECT event_id,world_id,game_time,time_advance_seconds FROM world_events ORDER BY world_id,commit_sequence').all();
          const updateEventTime = this.db.prepare('UPDATE world_events SET game_time_coordinate=?,time_advance_ms=? WHERE world_id=? AND event_id=?');
          for (const row of eventRows) {
            const initialMs = initialTimeByWorld.get(row.world_id);
            const eventMs = Date.parse(row.game_time);
            const coordinate = eventMs - initialMs;
            const seconds = row.time_advance_seconds ?? 0;
            const durationMs = seconds * 1000;
            if (initialMs === undefined || !Number.isFinite(eventMs) || !Number.isSafeInteger(coordinate)
              || !Number.isSafeInteger(seconds) || seconds < 0 || !Number.isSafeInteger(durationMs)) {
              throw new Error('TIME_COORDINATE_MIGRATION_INVALID_EVENT_TIME: ' + row.world_id + '/' + row.event_id);
            }
            updateEventTime.run(coordinate, durationMs, row.world_id, row.event_id);
          }
        },
      },
      {
        version: 7,
        apply: () => {
          this.db.exec(`CREATE TABLE IF NOT EXISTS time_advance_operations(
            world_id TEXT NOT NULL REFERENCES worlds(world_id),
            operation_id TEXT NOT NULL,
            idempotency_key TEXT NOT NULL,
            request_hash TEXT NOT NULL,
            from_coordinate INTEGER NOT NULL,
            target_coordinate INTEGER NOT NULL,
            confirmed_coordinate INTEGER NOT NULL,
            starting_world_revision INTEGER NOT NULL,
            current_world_revision INTEGER NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('running','completed','interrupted','blocked','needs_review')),
            next_segment_index INTEGER NOT NULL DEFAULT 0,
            segments_json TEXT NOT NULL,
            plan_json TEXT NOT NULL,
            result_json TEXT,
            error_json TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY(world_id,operation_id),
            UNIQUE(world_id,idempotency_key)
          );
          CREATE INDEX IF NOT EXISTS time_advance_operations_world_status
            ON time_advance_operations(world_id,status,updated_at);`);
        },
      },
      {
        version: 8,
        apply: () => {
          const worldColumns = this.db.prepare('PRAGMA table_info(worlds)').all();
          if (!worldColumns.some((column) => column.name === 'time_config_version')) {
            this.db.exec('ALTER TABLE worlds ADD COLUMN time_config_version TEXT');
          }
          this.db.exec(`CREATE TABLE IF NOT EXISTS world_time_configurations(
            world_id TEXT NOT NULL REFERENCES worlds(world_id),
            version TEXT NOT NULL,
            world_pack_id TEXT NOT NULL,
            world_pack_version TEXT NOT NULL,
            calendar_definition_json TEXT NOT NULL,
            time_policy_json TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            created_by TEXT NOT NULL,
            created_revision INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY(world_id,version)
          );
          CREATE INDEX IF NOT EXISTS world_time_configurations_pack
            ON world_time_configurations(world_pack_id,world_pack_version,version);`);
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
    if (this.txDepth > 0) {
      const savepoint = 'logic_engine_nested_' + this.txDepth;
      this.db.exec('SAVEPOINT ' + savepoint);
      this.txDepth += 1;
      try {
        const result = fn();
        this.db.exec('RELEASE SAVEPOINT ' + savepoint);
        return result;
      } catch (error) {
        try {
          this.db.exec('ROLLBACK TO SAVEPOINT ' + savepoint);
          this.db.exec('RELEASE SAVEPOINT ' + savepoint);
        } catch {}
        throw error;
      } finally {
        this.txDepth -= 1;
      }
    }
    this.db.exec('BEGIN IMMEDIATE');
    this.txDepth = 1;
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch {}
      throw error;
    } finally {
      this.txDepth = 0;
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

  registerMechanicTemplate(template, templateHash) {
    return this.tx(() => {
      const registeredBy = 'authenticated_api_client';
      const existing = this.db.prepare('SELECT * FROM mechanic_templates WHERE template_id=? AND version=?')
        .get(template.template_id, template.version);
      if (existing) {
        if (existing.template_hash !== templateHash) {
          throw new EngineError('MECHANIC_TEMPLATE_VERSION_IMMUTABLE', 'This mechanic template version is already registered with different content.', 409);
        }
        return {
          template: dec(existing.template_json),
          template_hash: existing.template_hash,
          registered_by: existing.registered_by,
          registered_at: existing.registered_at,
          already_registered: true,
        };
      }
      const registeredAt = now();
      this.db.prepare('INSERT INTO mechanic_templates(template_id,version,template_hash,template_json,registered_by,registered_at) VALUES(?,?,?,?,?,?)')
        .run(template.template_id, template.version, templateHash, enc(template), registeredBy, registeredAt);
      this.db.prepare('INSERT INTO mechanic_registry_audit(action,target_id,version,payload_json,registered_by,occurred_at) VALUES(?,?,?,?,?,?)')
        .run('mechanic_template.registered', template.template_id, template.version, enc({ template_hash: templateHash }), registeredBy, registeredAt);
      return { template, template_hash: templateHash, registered_by: registeredBy, registered_at: registeredAt, already_registered: false };
    });
  }

  getMechanicTemplate(templateId, version) {
    const row = this.db.prepare('SELECT * FROM mechanic_templates WHERE template_id=? AND version=?').get(templateId, version);
    if (!row) throw new EngineError('MECHANIC_TEMPLATE_NOT_FOUND', 'Mechanic template version not found.', 404);
    return {
      template: dec(row.template_json), template_hash: row.template_hash,
      registered_by: row.registered_by, registered_at: row.registered_at,
    };
  }

  listMechanicTemplates(templateId = null) {
    const rows = templateId === null
      ? this.db.prepare('SELECT * FROM mechanic_templates ORDER BY template_id,version').all()
      : this.db.prepare('SELECT * FROM mechanic_templates WHERE template_id=? ORDER BY version').all(templateId);
    return rows.map((row) => ({
      template: dec(row.template_json), template_hash: row.template_hash,
      registered_by: row.registered_by, registered_at: row.registered_at,
    }));
  }

  registerRuleModuleManifest(manifest, manifestHash) {
    return this.tx(() => {
      const registeredBy = 'authenticated_api_client';
      const existing = this.db.prepare('SELECT * FROM rule_module_manifests WHERE module_id=? AND version=?')
        .get(manifest.module_id, manifest.version);
      if (existing) {
        if (existing.manifest_hash !== manifestHash) {
          throw new EngineError('RULE_MODULE_VERSION_IMMUTABLE', 'This rule module version is already registered with different content.', 409);
        }
        return {
          manifest: dec(existing.manifest_json),
          manifest_hash: existing.manifest_hash,
          registered_by: existing.registered_by,
          registered_at: existing.registered_at,
          already_registered: true,
        };
      }
      const registeredAt = now();
      this.db.prepare('INSERT INTO rule_module_manifests(module_id,version,manifest_hash,manifest_json,registered_by,registered_at) VALUES(?,?,?,?,?,?)')
        .run(manifest.module_id, manifest.version, manifestHash, enc(manifest), registeredBy, registeredAt);
      this.db.prepare('INSERT INTO mechanic_registry_audit(action,target_id,version,payload_json,registered_by,occurred_at) VALUES(?,?,?,?,?,?)')
        .run('rule_module.registered', manifest.module_id, manifest.version, enc({ manifest_hash: manifestHash }), registeredBy, registeredAt);
      return { manifest, manifest_hash: manifestHash, registered_by: registeredBy, registered_at: registeredAt, already_registered: false };
    });
  }

  getRuleModuleManifest(moduleId, version) {
    const row = this.db.prepare('SELECT * FROM rule_module_manifests WHERE module_id=? AND version=?').get(moduleId, version);
    if (!row) throw new EngineError('RULE_MODULE_NOT_FOUND', 'Rule module version not found.', 404);
    return {
      manifest: dec(row.manifest_json), manifest_hash: row.manifest_hash,
      registered_by: row.registered_by, registered_at: row.registered_at,
    };
  }

  listRuleModuleManifests(moduleId = null) {
    const rows = moduleId === null
      ? this.db.prepare('SELECT * FROM rule_module_manifests ORDER BY module_id,version').all()
      : this.db.prepare('SELECT * FROM rule_module_manifests WHERE module_id=? ORDER BY version').all(moduleId);
    return rows.map((row) => ({
      manifest: dec(row.manifest_json), manifest_hash: row.manifest_hash,
      registered_by: row.registered_by, registered_at: row.registered_at,
    }));
  }

  mechanicRegistryAudit() {
    return this.db.prepare('SELECT * FROM mechanic_registry_audit ORDER BY audit_id').all().map((row) => ({
      audit_id: row.audit_id,
      action: row.action,
      target_id: row.target_id,
      version: row.version,
      payload: dec(row.payload_json),
      registered_by: row.registered_by,
      occurred_at: row.occurred_at,
    }));
  }

  /**
   * Read a bounded canonical snapshot from one SQLite read view.
   * Returned attributes/facts and context manifests are raw internal source data,
   * not actor-authorized or model-safe context. A manifest records declared inputs;
   * it is not proof that a particular actor may know them. When mechanic evaluation
   * state is requested, instance parameters/state and template/module manifests are
   * also raw internal data. Callers must apply an approved access/knowledge filter
   * before exposing any result to a model, player, or host adapter.
   */
  readSnapshot(id, request = {}) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      throw new EngineError('INVALID_SNAPSHOT_REQUEST', 'Snapshot request must be an object.', 400);
    }
    const allowedKeys = new Set(['entityIds', 'factIds', 'eventIds', 'contextManifestIds', 'includeMechanicEvaluationState']);
    if (Object.keys(request).some((key) => !allowedKeys.has(key))) {
      throw new EngineError('INVALID_SNAPSHOT_REQUEST', 'Snapshot request contains an unsupported field.', 400);
    }
    if (request.includeMechanicEvaluationState !== undefined && typeof request.includeMechanicEvaluationState !== 'boolean') {
      throw new EngineError('INVALID_SNAPSHOT_REQUEST', 'includeMechanicEvaluationState must be a boolean.', 400);
    }
    const normalizeIds = (value, fieldName) => {
      if (value === undefined) return [];
      if (!Array.isArray(value) || value.length > 200
        || !value.every((item) => typeof item === 'string' && item.trim() && item.length <= 200)) {
        throw new EngineError('INVALID_SNAPSHOT_REQUEST', fieldName + ' must be an array of at most 200 non-empty IDs.', 400, { field: fieldName });
      }
      if (new Set(value).size !== value.length) {
        throw new EngineError('INVALID_SNAPSHOT_REQUEST', fieldName + ' must not contain duplicate IDs.', 400, { field: fieldName });
      }
      return value;
    };
    const entityIds = normalizeIds(request.entityIds, 'entityIds');
    const factIds = normalizeIds(request.factIds, 'factIds');
    const eventIds = normalizeIds(request.eventIds, 'eventIds');
    const contextManifestIds = normalizeIds(request.contextManifestIds, 'contextManifestIds');

    const read = () => {
      const w = this.world(id);
      if (!w) throw new EngineError('WORLD_NOT_FOUND', 'World not found.', 404);

      const commitSequence = this.currentCommitSequence(id);
      const contextManifests = contextManifestIds.length
        ? this.db.prepare('SELECT manifest_id,world_id,generation_id,base_commit_sequence,base_world_revision,items_json,manifest_hash,created_at FROM context_manifests WHERE world_id=? AND manifest_id IN (' + contextManifestIds.map(() => '?').join(',') + ') ORDER BY manifest_id')
          .all(id, ...contextManifestIds).map((row) => ({
            manifest_id: row.manifest_id,
            world_id: row.world_id,
            generation_id: row.generation_id,
            base_commit_sequence: row.base_commit_sequence,
            base_world_revision: row.base_world_revision,
            items: dec(row.items_json),
            manifest_hash: row.manifest_hash,
            created_at: row.created_at,
          }))
        : [];
      const missingContextManifestIds = contextManifestIds.filter((manifestId) => !contextManifests.some((manifest) => manifest.manifest_id === manifestId));
      // Expand only manifests anchored to this exact snapshot marker; stale manifests remain visible for the caller to reject.
      const currentContextManifests = contextManifests.filter((manifest) =>
        manifest.base_world_revision === w.world_revision && manifest.base_commit_sequence === commitSequence);
      const derivedEntityIds = [];
      const derivedFactIds = [];
      const derivedEventIds = [];
      const currentManifestFactIds = new Set();
      const currentManifestEventIds = new Set();
      for (const manifest of currentContextManifests) {
        if (!Array.isArray(manifest.items)) {
          throw new EngineError('INVALID_CONTEXT_MANIFEST', 'A requested context manifest has malformed items.', 409, { manifest_id: manifest.manifest_id });
        }
        for (const item of manifest.items) {
          if (!item || typeof item.target_id !== 'string' || !item.target_id.trim()) {
            throw new EngineError('INVALID_CONTEXT_MANIFEST', 'A requested context manifest contains a malformed item.', 409, { manifest_id: manifest.manifest_id });
          }
          if (item.kind === 'entity') derivedEntityIds.push(item.target_id);
          else if (item.kind === 'fact') {
            derivedFactIds.push(item.target_id);
            currentManifestFactIds.add(item.target_id);
          } else if (item.kind === 'event') {
            derivedEventIds.push(item.target_id);
            currentManifestEventIds.add(item.target_id);
          } else if (!['entity_absence', 'fact_absence'].includes(item.kind)) {
            throw new EngineError('INVALID_CONTEXT_MANIFEST', 'A requested context manifest contains an unsupported item kind.', 409, { manifest_id: manifest.manifest_id, kind: item.kind });
          }
        }
      }
      const combineIds = (requested, derived, label) => {
        const combined = [...new Set([...requested, ...derived])];
        if (combined.length > 200) {
          throw new EngineError('SNAPSHOT_TOO_LARGE', 'The requested ' + label + ' plus context-manifest references exceed the 200-ID snapshot bound.', 409, { field: label });
        }
        return combined;
      };
      // The combined set remains bounded even when a manifest references more rows than the caller explicitly requested.
      const snapshotEntityIds = combineIds(entityIds, derivedEntityIds, 'entityIds');
      const snapshotFactIds = combineIds(factIds, derivedFactIds, 'factIds');
      const snapshotEventIds = combineIds(eventIds, derivedEventIds, 'eventIds');

      const entities = snapshotEntityIds.length
        ? this.db.prepare('SELECT * FROM entities WHERE world_id=? AND entity_id IN (' + snapshotEntityIds.map(() => '?').join(',') + ') ORDER BY entity_id').all(id, ...snapshotEntityIds).map((r) => ({
          entity_id: r.entity_id, entity_type: r.entity_type, status: r.status, attributes: dec(r.attributes_json),
          created_by_event_id: r.created_by_event_id, updated_revision: r.updated_revision,
        }))
        : [];
      const missingEntityIds = snapshotEntityIds.filter((entityId) => !entities.some((entity) => entity.entity_id === entityId));
      if (missingEntityIds.length) {
        throw new EngineError('ENTITY_NOT_FOUND', 'One or more requested entities were not found in this world snapshot.', 404, { entity_ids: missingEntityIds });
      }

      const facts = snapshotFactIds.length
        ? this.db.prepare('SELECT * FROM facts WHERE world_id=? AND fact_id IN (' + snapshotFactIds.map(() => '?').join(',') + ') ORDER BY fact_id').all(id, ...snapshotFactIds).map((r) => ({
          fact_id: r.fact_id, subject_ref: r.subject_ref, predicate: r.predicate, status: r.status,
          value: dec(r.value_json), candidates: dec(r.candidates_json), source_event_ids: dec(r.source_event_ids_json),
          updated_revision: r.updated_revision,
        }))
        : [];
      const missingFactIds = snapshotFactIds.filter((factId) => !facts.some((fact) => fact.fact_id === factId));
      const inconsistentManifestFacts = [...currentManifestFactIds].filter((factId) => missingFactIds.includes(factId));
      if (inconsistentManifestFacts.length) {
        throw new EngineError('CONTEXT_MANIFEST_SNAPSHOT_MISMATCH', 'A current context manifest references a fact missing from the same snapshot.', 409, { fact_ids: inconsistentManifestFacts });
      }

      const events = snapshotEventIds.length
        ? this.db.prepare('SELECT event_id,turn_id,generation_id,context_manifest_id,event_type,game_time,committed_revision,commit_sequence,validity,caused_by_json,depends_on_json,read_set_json,causal_links_json,source_message_id,created_at,rollback_id FROM world_events WHERE world_id=? AND event_id IN (' + snapshotEventIds.map(() => '?').join(',') + ') ORDER BY commit_sequence').all(id, ...snapshotEventIds).map((r) => ({
          event_id: r.event_id, turn_id: r.turn_id, generation_id: r.generation_id, context_manifest_id: r.context_manifest_id ?? null,
          event_type: r.event_type, game_time: r.game_time, committed_revision: r.committed_revision,
          commit_sequence: r.commit_sequence, validity: r.validity, caused_by: dec(r.caused_by_json),
          depends_on: dec(r.depends_on_json), read_set: dec(r.read_set_json), causal_links: dec(r.causal_links_json ?? '[]'),
          source_message_id: r.source_message_id, created_at: r.created_at, rollback_id: r.rollback_id,
        }))
        : [];
      const missingEventIds = snapshotEventIds.filter((eventId) => !events.some((event) => event.event_id === eventId));
      const inconsistentManifestEvents = events.filter((event) => currentManifestEventIds.has(event.event_id)
        && (event.validity !== 'valid' || event.commit_sequence > commitSequence));
      const missingManifestEvents = [...currentManifestEventIds].filter((eventId) => missingEventIds.includes(eventId));
      if (inconsistentManifestEvents.length || missingManifestEvents.length) {
        throw new EngineError('CONTEXT_MANIFEST_SNAPSHOT_MISMATCH', 'A current context manifest references an event that is missing or not valid in the same snapshot.', 409, {
          missing_event_ids: missingManifestEvents,
          invalid_event_ids: inconsistentManifestEvents.map((event) => event.event_id),
        });
      }

      let mechanicEvaluationSnapshot;
      if (request.includeMechanicEvaluationState === true) {
        // Keep the active mechanic set and its exact immutable definitions in
        // the same SQLite read view as the world revision and event cursor.
        // Fail closed rather than silently evaluating a truncated active set.
        const instanceRows = this.db.prepare(
          'SELECT * FROM mechanic_instances WHERE world_id=? ORDER BY instance_id LIMIT 201',
        ).all(id);
        if (instanceRows.length > 200) {
          throw new EngineError('MECHANIC_SNAPSHOT_TOO_LARGE', 'The world has more than 200 mechanic instances; bounded evaluation snapshot refused.', 409);
        }
        const instances = instanceRows.map((row) => {
          if (row.needs_review_reason) {
            throw new EngineError('MECHANIC_INSTANCE_REVIEW_STATE_UNSUPPORTED', 'A mechanic instance has a review reason that is not represented by an event-backed lifecycle status; evaluation snapshot refused.', 409, {
              instance_id: row.instance_id,
            });
          }
          return this.publicMechanicInstance(row);
        });

        const relevantInstances = instances.filter((instance) => instance.status === 'enabled');
        const templateKeys = new Set(relevantInstances.map((instance) => instance.template_id + '@' + instance.template_version));
        if (templateKeys.size > 200) {
          throw new EngineError('MECHANIC_SNAPSHOT_TOO_LARGE', 'The world references more than 200 mechanic template versions; bounded evaluation snapshot refused.', 409);
        }
        const templates = [...templateKeys].sort().map((key) => {
          const split = key.indexOf('@');
          const templateId = key.slice(0, split);
          const templateVersion = key.slice(split + 1);
          const row = this.db.prepare('SELECT template_json,template_hash,registered_by,registered_at FROM mechanic_templates WHERE template_id=? AND version=?')
            .get(templateId, templateVersion);
          if (!row) {
            throw new EngineError('MECHANIC_TEMPLATE_NOT_FOUND', 'An instance references a missing exact mechanic template version.', 409, {
              template_id: templateId, template_version: templateVersion,
            });
          }
          return {
            template: dec(row.template_json), template_hash: row.template_hash,
            registered_by: row.registered_by, registered_at: row.registered_at,
          };
        });

        const moduleKeys = new Set();
        for (const { template } of templates) {
          for (const moduleRef of template.rule_modules || []) {
            moduleKeys.add(moduleRef.module_id + '@' + moduleRef.version);
          }
          if (template.conflict_policy?.mode === 'automatic') {
            moduleKeys.add(template.conflict_policy.resolver_module_id + '@' + template.conflict_policy.resolver_module_version);
          }
        }
        if (moduleKeys.size > 200) {
          throw new EngineError('MECHANIC_SNAPSHOT_TOO_LARGE', 'The active mechanic set references more than 200 exact rule-module versions; bounded evaluation snapshot refused.', 409);
        }
        const modules = [...moduleKeys].sort().map((key) => {
          const split = key.indexOf('@');
          const moduleId = key.slice(0, split);
          const moduleVersion = key.slice(split + 1);
          const row = this.db.prepare('SELECT manifest_json,manifest_hash,registered_by,registered_at FROM rule_module_manifests WHERE module_id=? AND version=?')
            .get(moduleId, moduleVersion);
          if (!row) {
            throw new EngineError('RULE_MODULE_NOT_FOUND', 'An active mechanic references a missing exact rule-module version.', 409, {
              module_id: moduleId, module_version: moduleVersion,
            });
          }
          return {
            manifest: dec(row.manifest_json), manifest_hash: row.manifest_hash,
            registered_by: row.registered_by, registered_at: row.registered_at,
          };
        });
        mechanicEvaluationSnapshot = { instances, templates, modules };
      }

      // The world revision, event cursor, selected rows, requested context
      // manifests, active mechanic set, and exact immutable definitions all
      // share this read transaction.
      return {
        ...w,
        commit_sequence: commitSequence,
        entities,
        facts,
        events,
        context_manifests: contextManifests,
        missing_fact_ids: missingFactIds,
        missing_event_ids: missingEventIds,
        missing_context_manifest_ids: missingContextManifestIds,
        ...(mechanicEvaluationSnapshot ? { mechanic_evaluation_snapshot: mechanicEvaluationSnapshot } : {}),
      };
    };

    // Store transactions are write transactions (BEGIN IMMEDIATE). Refuse to
    // expose their uncommitted projection as a canonical read snapshot.
    if (this.txDepth > 0) {
      throw new EngineError('SNAPSHOT_READ_DURING_WRITE_TRANSACTION', 'A canonical snapshot cannot be read from inside a store write transaction.', 409);
    }
    // Create one read transaction; never fall back to assembling the snapshot
    // from independent autocommit SELECT statements.
    let began = false;
    try {
      this.db.exec('BEGIN');
      began = true;
      const snapshot = read();
      this.db.exec('COMMIT');
      began = false;
      return snapshot;
    } catch (error) {
      if (began) {
        try { this.db.exec('ROLLBACK'); } catch {}
      }
      throw error;
    }
  }

  state(id) {
    const read = () => {
      const w = this.world(id);
      if (!w) throw new EngineError('WORLD_NOT_FOUND', 'World not found.', 404);
      const commitSequence = this.currentCommitSequence(id);
      const entities = this.db.prepare('SELECT * FROM entities WHERE world_id=? ORDER BY entity_id').all(id).map((r) => ({
        entity_id: r.entity_id, entity_type: r.entity_type, status: r.status, attributes: dec(r.attributes_json),
        created_by_event_id: r.created_by_event_id, updated_revision: r.updated_revision,
      }));
      const facts = this.db.prepare('SELECT * FROM facts WHERE world_id=? ORDER BY fact_id').all(id).map((r) => ({
        fact_id: r.fact_id, subject_ref: r.subject_ref, predicate: r.predicate, status: r.status,
        value: dec(r.value_json), candidates: dec(r.candidates_json), source_event_ids: dec(r.source_event_ids_json),
        updated_revision: r.updated_revision,
      }));
      return { ...w, commit_sequence: commitSequence, entities, facts };
    };
    if (this.txDepth > 0) return read();
    let began = false;
    try {
      this.db.exec('BEGIN');
      began = true;
      const snapshot = read();
      this.db.exec('COMMIT');
      began = false;
      return snapshot;
    } catch (error) {
      if (began) {
        try { this.db.exec('ROLLBACK'); } catch {}
      }
      throw error;
    }
  }

  events(id, includeInvalid = false) {
    if (!this.world(id)) throw new EngineError('WORLD_NOT_FOUND', 'World not found.', 404);
    const rows = this.db.prepare('SELECT * FROM world_events WHERE world_id=? ' + (includeInvalid ? '' : "AND validity='valid' ") + 'ORDER BY commit_sequence').all(id);
    return rows.map((r) => ({
      event_id: r.event_id, turn_id: r.turn_id, generation_id: r.generation_id, context_manifest_id: r.context_manifest_id ?? null, event_type: r.event_type,
      game_time: r.game_time, game_time_coordinate: r.game_time_coordinate, committed_revision: r.committed_revision, commit_sequence: r.commit_sequence, validity: r.validity,
      caused_by: dec(r.caused_by_json), depends_on: dec(r.depends_on_json), read_set: dec(r.read_set_json),
      causal_links: dec(r.causal_links_json ?? '[]'), effects: dec(r.effects_json), time_advance_seconds: r.time_advance_seconds, time_advance_ms: r.time_advance_ms,
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


  currentCommitSequence(worldId) {
    return this.db.prepare('SELECT COALESCE(MAX(commit_sequence),0) AS value FROM world_events WHERE world_id=?').get(worldId).value;
  }

  registerContextManifest(worldId, manifest) {
    return this.tx(() => {
      if (!this.world(worldId)) throw new EngineError('WORLD_NOT_FOUND', 'World not found.', 404);
      const existing = this.db.prepare('SELECT * FROM context_manifests WHERE world_id=? AND generation_id=?').get(worldId, manifest.generation_id);
      if (existing) {
        if (existing.manifest_hash === manifest.manifest_hash) {
          return {
            manifest_id: existing.manifest_id, world_id: existing.world_id, generation_id: existing.generation_id,
            base_commit_sequence: existing.base_commit_sequence, base_world_revision: existing.base_world_revision, items: dec(existing.items_json),
            manifest_hash: existing.manifest_hash, idempotent_replay: true,
          };
        }
        throw new EngineError('GENERATION_MANIFEST_EXISTS', 'A different immutable context manifest is already registered for this generation.', 409, { generation_id: manifest.generation_id });
      }
      const currentWorld = this.world(worldId);
      const currentCursor = this.currentCommitSequence(worldId);
      if (manifest.base_world_revision !== currentWorld.world_revision) {
        throw new EngineError('CONTEXT_REVISION_CONFLICT', 'Context manifest revision must equal the current world revision when the manifest is registered.', 409, { expected: currentWorld.world_revision, received: manifest.base_world_revision });
      }
      if (manifest.base_commit_sequence !== currentCursor) {
        throw new EngineError('CONTEXT_CURSOR_CONFLICT', 'Context manifest cursor must equal the current committed event cursor when the manifest is registered.', 409, { expected: currentCursor, received: manifest.base_commit_sequence });
      }
      for (const item of manifest.items) {
        if (item.kind === 'entity' && !this.db.prepare('SELECT 1 FROM entities WHERE world_id=? AND entity_id=?').get(worldId, item.target_id)) {
          throw new EngineError('INVALID_CONTEXT_MANIFEST_ITEM', 'Manifest references an entity absent from the current projection: ' + item.target_id, 400, { item });
        }
        if (item.kind === 'fact' && !this.db.prepare('SELECT 1 FROM facts WHERE world_id=? AND fact_id=?').get(worldId, item.target_id)) {
          throw new EngineError('INVALID_CONTEXT_MANIFEST_ITEM', 'Manifest references a fact absent from the current projection: ' + item.target_id, 400, { item });
        }
        if (item.kind === 'entity_absence') {
          const entity = this.db.prepare('SELECT status FROM entities WHERE world_id=? AND entity_id=?').get(worldId, item.target_id);
          if (entity && entity.status !== 'destroyed') throw new EngineError('INVALID_CONTEXT_MANIFEST_ITEM', 'Manifest entity_absence must be true at the snapshot: ' + item.target_id, 400, { item });
        }
        if (item.kind === 'fact_absence' && this.db.prepare('SELECT 1 FROM facts WHERE world_id=? AND fact_id=?').get(worldId, item.target_id)) {
          throw new EngineError('INVALID_CONTEXT_MANIFEST_ITEM', 'Manifest fact_absence must be true at the snapshot: ' + item.target_id, 400, { item });
        }
        if (item.kind === 'event') {
          const event = this.db.prepare("SELECT 1 FROM world_events WHERE world_id=? AND event_id=? AND validity='valid' AND commit_sequence<=?").get(worldId, item.target_id, manifest.base_commit_sequence);
          if (!event) throw new EngineError('INVALID_CONTEXT_MANIFEST_ITEM', 'Manifest event must be valid and present at the manifest cursor: ' + item.target_id, 400, { item });
        }
      }
      const manifestId = randomUUID();
      const createdAt = now();
      this.db.prepare('INSERT INTO context_manifests(manifest_id,world_id,generation_id,base_commit_sequence,base_world_revision,items_json,manifest_hash,created_at) VALUES(?,?,?,?,?,?,?,?)')
        .run(manifestId, worldId, manifest.generation_id, manifest.base_commit_sequence, manifest.base_world_revision, enc(manifest.items), manifest.manifest_hash, createdAt);
      const revision = this.world(worldId).world_revision;
      this.db.prepare("INSERT INTO audit_entries(world_id,world_revision,action,target_id,payload_json,occurred_at) VALUES(?,?, 'context_manifest.registered',?,?,?)")
        .run(worldId, revision, manifestId, enc({ generation_id: manifest.generation_id, base_commit_sequence: manifest.base_commit_sequence, base_world_revision: manifest.base_world_revision, item_count: manifest.items.length, manifest_hash: manifest.manifest_hash }), createdAt);
      return {
        manifest_id: manifestId, world_id: worldId, generation_id: manifest.generation_id,
        base_commit_sequence: manifest.base_commit_sequence, base_world_revision: manifest.base_world_revision, items: manifest.items,
        manifest_hash: manifest.manifest_hash, idempotent_replay: false,
      };
    });
  }

  validateContextManifest(worldId, event, baseRevision = null) {
    if (!event.context_manifest_id) return;
    const manifest = this.db.prepare('SELECT * FROM context_manifests WHERE world_id=? AND manifest_id=?').get(worldId, event.context_manifest_id);
    if (!manifest) throw new EngineError('CONTEXT_MANIFEST_NOT_FOUND', 'context_manifest_id must reference a registered manifest in this world.', 400, { context_manifest_id: event.context_manifest_id });
    if (!event.generation_id || event.generation_id !== manifest.generation_id) {
      throw new EngineError('CONTEXT_GENERATION_MISMATCH', 'Event generation_id must match the context manifest generation_id.', 400, { event_generation_id: event.generation_id ?? null, manifest_generation_id: manifest.generation_id });
    }
    const currentWorld = this.world(worldId);
    if (manifest.base_commit_sequence > this.currentCommitSequence(worldId)) {
      throw new EngineError('INVALID_CONTEXT_CURSOR', 'Context manifest cursor cannot be ahead of the current world history.', 409);
    }
    const expectedBaseRevision = baseRevision ?? currentWorld.world_revision;
    if (manifest.base_world_revision !== expectedBaseRevision) {
      throw new EngineError('CONTEXT_SNAPSHOT_STALE', 'The context manifest is not anchored to the segment or commit base revision.', 409, { manifest_world_revision: manifest.base_world_revision, expected_base_revision: expectedBaseRevision, current_world_revision: currentWorld.world_revision });
    }
    const available = new Set(dec(manifest.items_json).map((item) => item.kind + ':' + item.target_id));
    const declared = new Set();
    for (const ref of event.read_set) declared.add(ref);
    for (const link of event.causal_links ?? []) {
      if (link.relation === 'READS_SOURCE') declared.add('event:' + link.target_id);
      if (link.relation === 'READS_ENTITY') declared.add('entity:' + link.target_id);
      if (link.relation === 'READS_CLAIM') declared.add('fact:' + link.target_id);
      if (link.relation === 'REQUIRES') {
        if (link.predicate.kind === 'fact_value') declared.add('fact:' + link.predicate.fact_id);
        else if (link.predicate.kind === 'fact_absent') declared.add('fact_absence:' + link.predicate.fact_id);
        else if (link.predicate.kind === 'entity_absent') declared.add('entity_absence:' + link.predicate.entity_id);
        else declared.add('entity:' + link.predicate.entity_id);
      }
    }
    const missing = [...declared].filter((key) => !available.has(key));
    if (missing.length) throw new EngineError('INVALID_DECLARED_READ', 'Every declared read must be present in the generation-bound context manifest.', 400, { missing, context_manifest_id: event.context_manifest_id });
  }

  currentEntityProjection(worldId) {
    const rows = this.db.prepare('SELECT entity_id,entity_type,status,attributes_json FROM entities WHERE world_id=?').all(worldId);
    return new Map(rows.map((row) => [row.entity_id, {
      entity_id: row.entity_id,
      entity_type: row.entity_type,
      status: row.status,
      attributes: dec(row.attributes_json),
    }]));
  }

  entityProjectionAtCursor(worldId, beforeSequence, invalidEventIds = new Set()) {
    const rows = this.db.prepare("SELECT event_id,effects_json FROM world_events WHERE world_id=? AND validity='valid' AND commit_sequence<? ORDER BY commit_sequence").all(worldId, beforeSequence);
    const entities = new Map();
    for (const row of rows) {
      if (invalidEventIds.has(row.event_id)) continue;
      applyEntityEffects(entities, dec(row.effects_json));
    }
    return entities;
  }

  factProjectionAtCursor(worldId, beforeSequence, invalidEventIds = new Set()) {
    const rows = this.db.prepare("SELECT event_id,effects_json FROM world_events WHERE world_id=? AND validity='valid' AND commit_sequence<? ORDER BY commit_sequence").all(worldId, beforeSequence);
    const claims = new Map();
    for (const row of rows) {
      if (invalidEventIds.has(row.event_id)) continue;
      applyFactEffects(claims, dec(row.effects_json));
    }
    return factProjection(claims);
  }

  currentFactProjection(worldId) {
    const rows = this.db.prepare('SELECT fact_id,status,value_json,candidates_json FROM facts WHERE world_id=?').all(worldId);
    return new Map(rows.map((row) => [row.fact_id, row.status === 'conflicted'
      ? { status: 'conflicted', values: dec(row.candidates_json) }
      : { status: row.status, value: dec(row.value_json), values: [dec(row.value_json)] }]));
  }

  validateCausalMetadata(worldId, event, nextRevision, contextBaseRevision = null) {
    this.validateContextManifest(worldId, event, contextBaseRevision);
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
      } else if (ref.startsWith('relationship:')) {
        const pair = parseRelationshipRef(ref);
        if (!pair || !this.db.prepare('SELECT 1 FROM entities WHERE world_id=? AND entity_id=?').get(worldId, pair.subjectId)
          || !this.db.prepare('SELECT 1 FROM entities WHERE world_id=? AND entity_id=?').get(worldId, pair.targetId)) {
          throw new EngineError('INVALID_DEPENDENCY_REFERENCE', 'depends_on Relationship reference must identify two entities in this world.', 400, { reference: ref });
        }
      } else {
        this.validateEventReference(worldId, ref, nextRevision, 'depends_on');
      }
    }
    for (const ref of event.read_set) {
      const isEntity = ref.startsWith('entity:') && ref.length > 'entity:'.length;
      const isFact = ref.startsWith('fact:') && ref.length > 'fact:'.length;
      const relationshipPair = parseRelationshipRef(ref);
      if (!isEntity && !isFact && !relationshipPair) {
        throw new EngineError('INVALID_READ_SET_REFERENCE', 'read_set references must identify an entity, fact, or directed Relationship pair.', 400, { reference: ref });
      }
      if (isEntity && !this.db.prepare('SELECT 1 FROM entities WHERE world_id=? AND entity_id=?').get(worldId, ref.slice('entity:'.length))) {
        throw new EngineError('INVALID_READ_SET_REFERENCE', 'read_set entity must exist in the current world at commit time: ' + ref, 400, { reference: ref });
      }
      if (isFact && !this.db.prepare('SELECT 1 FROM facts WHERE world_id=? AND fact_id=?').get(worldId, ref.slice('fact:'.length))) {
        throw new EngineError('INVALID_READ_SET_REFERENCE', 'read_set fact must exist in the current world at commit time: ' + ref, 400, { reference: ref });
      }
      if (relationshipPair && (!this.db.prepare('SELECT 1 FROM entities WHERE world_id=? AND entity_id=?').get(worldId, relationshipPair.subjectId)
        || !this.db.prepare('SELECT 1 FROM entities WHERE world_id=? AND entity_id=?').get(worldId, relationshipPair.targetId))) {
        throw new EngineError('INVALID_READ_SET_REFERENCE', 'read_set Relationship pair must identify two entities in this world.', 400, { reference: ref });
      }
    }
    for (const link of event.causal_links ?? []) {
      if (link.relation === 'READS_SOURCE') {
        this.validateEventReference(worldId, link.target_id, nextRevision, 'causal_links');
      } else if (link.relation === 'READS_ENTITY') {
        if (!this.db.prepare('SELECT 1 FROM entities WHERE world_id=? AND entity_id=?').get(worldId, link.target_id)) {
          throw new EngineError('INVALID_CAUSAL_LINK', 'READS_ENTITY must reference an entity in this world: ' + link.target_id, 400, { relation: link.relation, target_id: link.target_id });
        }
      } else if (link.relation === 'READS_CLAIM') {
        const claim = this.db.prepare('SELECT source_event_ids_json FROM facts WHERE world_id=? AND fact_id=?').get(worldId, link.target_id);
        if (!claim || dec(claim.source_event_ids_json).length === 0) {
          throw new EngineError('INVALID_CAUSAL_LINK', 'READS_CLAIM must reference a claim with at least one valid source in this world: ' + link.target_id, 400, { relation: link.relation, target_id: link.target_id });
        }
      } else if (link.relation === 'REQUIRES') {
        const result = predicateResult(this.currentEntityProjection(worldId), link.predicate, this.currentFactProjection(worldId));
        if (result !== 'true') {
          const code = result === 'unknown' ? 'REQUIRED_PREDICATE_UNKNOWN' : 'REQUIRED_PREDICATE_NOT_SATISFIED';
          throw new EngineError(code, result === 'unknown'
            ? 'REQUIRES predicate is unknown because its fact has conflicting valid claims.'
            : 'REQUIRES predicate is not satisfied at commit time.', 409, { predicate: link.predicate, evaluation: result });
        }
      } else {
        throw new EngineError('UNSUPPORTED_CAUSAL_RELATION', 'Unsupported causal relationship: ' + String(link.relation), 400, { relation: link.relation });
      }
    }
  }

  validateCommit(id, x) {
    let result;
    try {
      this.tx(() => {
        result = this.commit(id, x);
        const rollbackOnly = new Error('validation preview rollback');
        rollbackOnly.validationPreviewRollback = true;
        throw rollbackOnly;
      });
    } catch (error) {
      if (error?.validationPreviewRollback) return result;
      throw error;
    }
  }

  commit(id, x, options = {}) {
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
      if (x.expected_commit_sequence !== undefined && x.expected_commit_sequence !== null
        && x.expected_commit_sequence !== this.currentCommitSequence(id)) {
        throw new EngineError('COMMIT_SEQUENCE_CONFLICT', 'World event cursor changed after Relationship evaluation.', 409, {
          expected_commit_sequence: x.expected_commit_sequence,
          current_commit_sequence: this.currentCommitSequence(id),
          current_world_revision: w.world_revision,
        });
      }
      const eventId = x.event_id || randomUUID();
      if (this.db.prepare('SELECT event_id FROM world_events WHERE event_id=?').get(eventId)) {
        throw new EngineError('EVENT_ALREADY_EXISTS', 'Event ID already exists.', 409);
      }
      const revision = w.world_revision + 1;
      const relationshipEffects = x.effects.filter((effect) => effect.kind === 'relationship.transition');
      if (relationshipEffects.length) {
        x.read_set = [...new Set([...(x.read_set || []), ...relationshipEffects.map((effect) => relationshipRef(effect.subject_id, effect.target_id))])];
      }
      this.validateCausalMetadata(id, x, revision, options.contextBaseRevision ?? null);
      const currentEntities = this.currentEntityProjection(id);
      const relationshipPairs = new Set();
      const entityEffectIds = new Set();
      const mechanicEffectIds = new Set();
      for (const effect of x.effects) {
        if (effect.kind === 'relationship.transition') {
          if (x.effects.length !== 1) throw new EngineError('MIXED_RELATIONSHIP_EFFECTS_UNSUPPORTED', 'A Relationship transition must be the only effect in its canonical event.', 400);
          const pairKey = JSON.stringify([effect.subject_id, effect.target_id]);
          if (relationshipPairs.has(pairKey)) throw new EngineError('DUPLICATE_RELATIONSHIP_EFFECT', 'An event may contain at most one transition for a directed pair.', 400);
          relationshipPairs.add(pairKey);
          for (const participantId of [effect.subject_id, effect.target_id]) {
            const participant = currentEntities.get(participantId);
            if (!participant || participant.status === 'destroyed') {
              throw new EngineError('RELATIONSHIP_PARTICIPANT_NOT_ELIGIBLE', 'Both Relationship participants must be existing non-destroyed entities in this world.', 409, { participant_id: participantId });
            }
          }
          const moduleRow = this.db.prepare('SELECT manifest_json FROM rule_module_manifests WHERE module_id=? AND version=?')
            .get(effect.rule_module_id, effect.rule_module_version);
          if (!moduleRow) throw new EngineError('RELATIONSHIP_RULE_VERSION_NOT_FOUND', 'The exact Relationship rule-module version is not registered.', 409, { module_id: effect.rule_module_id, module_version: effect.rule_module_version });
          const manifest = dec(moduleRow.manifest_json);
          const domain = manifest.metadata?.relationship_domain;
          if (!manifest.operations?.includes('validate_transition') || !domain
            || domain.world_pack_id !== w.world_pack_id || domain.world_pack_version !== w.world_pack_version
            || Object.keys(domain).some((key) => !['world_pack_id', 'world_pack_version', 'dimensions'].includes(key))
            || !domain.dimensions || typeof domain.dimensions !== 'object' || Array.isArray(domain.dimensions)) {
            throw new EngineError('RELATIONSHIP_RULE_VERSION_INCOMPATIBLE', 'The pinned rule module must contain relationship_domain rules matching this exact World Pack and version.', 409, {
              module_id: effect.rule_module_id, module_version: effect.rule_module_version,
              world_pack_id: w.world_pack_id, world_pack_version: w.world_pack_version,
            });
          }
          for (const ref of effect.evidence_refs) {
            if (!ref.startsWith('event:') || ref.length <= 'event:'.length) {
              throw new EngineError('INVALID_RELATIONSHIP_EVIDENCE_REFERENCE', 'Relationship evidence references must use event:<event_id> references.', 400, { reference: ref });
            }
            const source = this.db.prepare('SELECT validity,commit_sequence FROM world_events WHERE world_id=? AND event_id=?')
              .get(id, ref.slice('event:'.length));
            if (!source || source.validity !== 'valid' || source.commit_sequence >= this.currentCommitSequence(id) + 1) {
              throw new EngineError('RELATIONSHIP_EVIDENCE_NOT_ELIGIBLE', 'Each evidence event must exist, be valid, and precede this transition in the same world.', 409, { reference: ref });
            }
          }
          const currentValues = {};
          const currentRows = this.db.prepare('SELECT dimension,status,value_json FROM relationships WHERE world_id=? AND subject_id=? AND target_id=?')
            .all(id, effect.subject_id, effect.target_id);
          for (const row of currentRows) {
            Object.defineProperty(currentValues, row.dimension, {
              value: row.status === 'cleared' ? { status: 'cleared' } : dec(row.value_json),
              enumerable: true, configurable: true, writable: true,
            });
          }
          const candidate = evaluateRelationshipCandidate({
            subjectId: effect.subject_id,
            targetId: effect.target_id,
            currentValues,
            patch: effect.patch,
            dimensionRules: domain.dimensions,
            evidence: { status: 'supported', refs: effect.evidence_refs },
            ruleVersion: effect.rule_module_id + '@' + effect.rule_module_version,
          });
          if (candidate.status !== 'candidate') {
            throw new EngineError('RELATIONSHIP_TRANSITION_REJECTED', 'Relationship candidate did not produce a committable transition.', 409, {
              candidate_status: candidate.status, reason: candidate.reason ?? null,
            });
          }
          effect.patch = candidate.patch;
          continue;
        }
        if (effect.kind.startsWith('mechanic.instance.')) {
          if (mechanicEffectIds.has(effect.instance_id)) throw new EngineError('DUPLICATE_MECHANIC_INSTANCE_EFFECT', 'An event may contain at most one lifecycle effect for a given mechanic instance.', 400, { instance_id: effect.instance_id });
          mechanicEffectIds.add(effect.instance_id);
          if (effect.kind === 'mechanic.instance.create') {
            const templateRow = this.db.prepare('SELECT template_json FROM mechanic_templates WHERE template_id=? AND version=?').get(effect.template_id, effect.template_version);
            if (!templateRow) throw new EngineError('MECHANIC_TEMPLATE_NOT_FOUND', 'The exact mechanic template version is not registered.', 404, { template_id: effect.template_id, template_version: effect.template_version });
            const template = dec(templateRow.template_json);
            const moduleRefs = [...(template.rule_modules || [])];
            if (template.conflict_policy?.mode === 'automatic') {
              const resolver = { module_id: template.conflict_policy.resolver_module_id, version: template.conflict_policy.resolver_module_version, required_capabilities: template.conflict_policy.requires_capabilities || [], required_operation: 'resolve_conflict' };
              const existingRef = moduleRefs.find((item) => item.module_id === resolver.module_id && item.version === resolver.version);
              if (existingRef) {
                existingRef.required_capabilities = [...new Set([...resolver.required_capabilities, ...(existingRef.required_capabilities || [])])];
                existingRef.required_operation = 'resolve_conflict';
              } else moduleRefs.push(resolver);
            }
            for (const moduleRef of moduleRefs) {
              const moduleRow = this.db.prepare('SELECT manifest_json FROM rule_module_manifests WHERE module_id=? AND version=?').get(moduleRef.module_id, moduleRef.version);
              if (!moduleRow) throw new EngineError('MECHANIC_INSTANCE_UNSUPPORTED_MODULE', 'The pinned template references a rule-module version that is not registered.', 409, { template_id: effect.template_id, template_version: effect.template_version, module_id: moduleRef.module_id, module_version: moduleRef.version });
              const manifest = dec(moduleRow.manifest_json);
              if (!manifest.compatibility.core_contract_versions.includes(template.schema_version)) throw new EngineError('MECHANIC_INSTANCE_MODULE_COMPATIBILITY_MISMATCH', 'A referenced rule module does not declare compatibility with the pinned template contract version.', 409, { module_id: moduleRef.module_id, module_version: moduleRef.version, template_schema_version: template.schema_version });
              const missingCapabilities = (moduleRef.required_capabilities || []).filter((capability) => !manifest.capabilities.includes(capability));
              if (missingCapabilities.length) throw new EngineError('MECHANIC_INSTANCE_MODULE_CAPABILITY_MISMATCH', 'A referenced rule module does not declare all required capabilities.', 409, { module_id: moduleRef.module_id, module_version: moduleRef.version, missing_capabilities: missingCapabilities });
              if (moduleRef.required_operation && !manifest.operations.includes(moduleRef.required_operation)) throw new EngineError('MECHANIC_INSTANCE_MODULE_OPERATION_MISMATCH', 'The automatic conflict resolver does not declare resolve_conflict.', 409, { module_id: moduleRef.module_id, module_version: moduleRef.version });
            }
            if (this.db.prepare('SELECT 1 FROM mechanic_instances WHERE world_id=? AND instance_id=?').get(id, effect.instance_id)) throw new EngineError('MECHANIC_INSTANCE_ALREADY_EXISTS', 'Mechanic instance identity already exists in this world.', 409, { instance_id: effect.instance_id });
          } else {
            const instance = this.db.prepare('SELECT status,last_event_id FROM mechanic_instances WHERE world_id=? AND instance_id=?').get(id, effect.instance_id);
            if (!instance) throw new EngineError('MECHANIC_INSTANCE_NOT_FOUND', 'Mechanic instance does not exist in this world.', 404, { instance_id: effect.instance_id });
            const expectedStatus = effect.kind === 'mechanic.instance.enable' ? 'disabled' : 'enabled';
            if (instance.status !== expectedStatus) throw new EngineError('INVALID_MECHANIC_INSTANCE_TRANSITION', 'Lifecycle transition is not valid from the current status.', 409, { instance_id: effect.instance_id, current_status: instance.status, requested_effect: effect.kind });
            if (!x.caused_by.includes(instance.last_event_id)) throw new EngineError('MECHANIC_INSTANCE_CAUSAL_PREDECESSOR_REQUIRED', 'Lifecycle changes must be caused by the instance latest lifecycle event.', 400, { instance_id: effect.instance_id, required_event_id: instance.last_event_id });
          }
          continue;
        }
        if (!effect.kind.startsWith('entity.')) continue;
        if (entityEffectIds.has(effect.entity_id)) {
          throw new EngineError('DUPLICATE_ENTITY_EFFECT', 'An event may contain at most one effect for a given entity_id.', 400, { entity_id: effect.entity_id });
        }
        entityEffectIds.add(effect.entity_id);
        const current = currentEntities.get(effect.entity_id);
        if (effect.kind === 'entity.create' && current) {
          throw new EngineError('ENTITY_ALREADY_EXISTS', 'entity.create cannot reuse an existing entity identity, including a destroyed tombstone.', 409, { entity_id: effect.entity_id });
        }
        if (effect.kind === 'entity.update') {
          if (!current || current.status === 'destroyed') {
            throw new EngineError('ENTITY_NOT_UPDATABLE', 'entity.update requires an existing non-destroyed entity.', 409, { entity_id: effect.entity_id });
          }
          const hasExistencePrecondition = (x.causal_links ?? []).some((link) => link.relation === 'REQUIRES'
            && link.predicate.kind === 'entity_exists' && link.predicate.entity_id === effect.entity_id);
          if (!hasExistencePrecondition) {
            throw new EngineError('ENTITY_UPDATE_PRECONDITION_REQUIRED', 'entity.update requires an explicit REQUIRES(entity_exists) precondition.', 400, { entity_id: effect.entity_id });
          }
        }
      }
      const commitSequence = this.db.prepare('SELECT COALESCE(MAX(commit_sequence),0)+1 AS next FROM world_events WHERE world_id=?').get(id).next;
      const durationMs = x.time_advance_seconds * 1000;
      if (!Number.isSafeInteger(durationMs)) {
        throw new EngineError('INVALID_TIME_ADVANCE', 'Time advance cannot be represented as integer milliseconds.', 400);
      }
      const gameTimeCoordinate = w.game_time_coordinate + durationMs;
      if (!Number.isSafeInteger(gameTimeCoordinate)) {
        throw new EngineError('TIME_COORDINATE_OVERFLOW', 'Game time coordinate exceeds the safe integer range.', 409);
      }
      const initialTimeMs = Date.parse(w.initial_game_time);
      const projectedTimeMs = initialTimeMs + gameTimeCoordinate;
      const projectedDate = new Date(projectedTimeMs);
      if (!Number.isFinite(initialTimeMs) || !Number.isSafeInteger(projectedTimeMs) || !Number.isFinite(projectedDate.getTime())) {
        throw new EngineError('GAME_TIME_OUT_OF_RANGE', 'Advanced time cannot be represented by the legacy ISO compatibility field.', 409);
      }
      const time = projectedDate.toISOString();
      const createdAt = now();
      this.db.prepare(`INSERT INTO world_events(
        event_id,world_id,turn_id,generation_id,context_manifest_id,event_type,game_time,game_time_coordinate,committed_revision,commit_sequence,validity,
        caused_by_json,depends_on_json,read_set_json,causal_links_json,effects_json,time_advance_seconds,time_advance_ms,source_message_id,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,'valid',?,?,?,?,?,?,?,?,?)`).run(
        eventId, id, x.turn_id, x.generation_id || null, x.context_manifest_id || null, x.event_type, time, gameTimeCoordinate, revision, commitSequence,
        enc(x.caused_by), enc(x.depends_on), enc(x.read_set), enc(x.causal_links ?? []), enc(x.effects), x.time_advance_seconds, durationMs,
        x.source_message_id || null, createdAt,
      );
      this.db.prepare('UPDATE worlds SET world_revision=?,game_time=?,game_time_coordinate=? WHERE world_id=?')
        .run(revision, time, gameTimeCoordinate, id);
      if (!options.deferRebuild) this.rebuild(id, revision);
      const result = {
        accepted: true, event_id: eventId, world_id: id, world_revision: revision, commit_sequence: commitSequence,
        game_time: this.world(id).game_time, game_time_coordinate: this.world(id).game_time_coordinate, effect_count: x.effects.length, idempotent_replay: false,
      };
      this.db.prepare('INSERT INTO audit_entries(world_id,world_revision,action,target_id,payload_json,occurred_at) VALUES(?,?,\'event.committed\',?,?,?)')
        .run(id, revision, eventId, enc({
          turn_id: x.turn_id, context_manifest_id: x.context_manifest_id || null, caused_by: x.caused_by, depends_on: x.depends_on,
          read_set: x.read_set, effects: x.effects, time_advance_seconds: x.time_advance_seconds,
          time_advance_ms: durationMs, game_time_coordinate: gameTimeCoordinate,
        }), createdAt);
      this.saveReplay(id, x.idempotency_key, x.request_hash, result);
      return result;
    });
  }

  commitSegment(id, events, key, requestHash, expectedRevision, expectedCommitSequence = null) {
    return this.tx(() => {
      const old = this.replay(id, key, requestHash);
      if (old) return { ...old, idempotent_replay: true };
      const worldAtStart = this.world(id);
      if (!worldAtStart) throw new EngineError('WORLD_NOT_FOUND', 'World not found.', 404);
      if (expectedRevision !== worldAtStart.world_revision) {
        throw new EngineError('REVISION_CONFLICT', 'World changed after segment planning.', 409, {
          expected_revision: expectedRevision, current_revision: worldAtStart.world_revision,
        });
      }
      const startCommitSequence = this.currentCommitSequence(id);
      if (expectedCommitSequence !== null && expectedCommitSequence !== startCommitSequence) {
        throw new EngineError('COMMIT_SEQUENCE_CONFLICT', 'World event cursor changed after segment planning.', 409, {
          expected_commit_sequence: expectedCommitSequence, current_commit_sequence: startCommitSequence,
          current_world_revision: worldAtStart.world_revision,
        });
      }
      if (!Array.isArray(events) || events.length < 1 || events.length > 32) {
        throw new EngineError('INVALID_SEGMENT_SIZE', 'A segment must contain between 1 and 32 events.', 400);
      }

      const eventIds = new Set();
      const eventKeys = new Set();
      for (const event of events) {
        if (!event || typeof event.event_id !== 'string' || !event.event_id.trim()
          || typeof event.idempotency_key !== 'string' || !event.idempotency_key.trim()) {
          throw new EngineError('INVALID_SEGMENT_EVENT', 'Every segment event must have an explicit event_id and idempotency_key.', 400);
        }
        if (eventIds.has(event.event_id)) throw new EngineError('DUPLICATE_SEGMENT_EVENT_ID', 'Segment event IDs must be unique.', 400);
        if (eventKeys.has(event.idempotency_key)) throw new EngineError('DUPLICATE_SEGMENT_EVENT_KEY', 'Segment event idempotency keys must be unique.', 400);
        if (event.idempotency_key === key) throw new EngineError('SEGMENT_KEY_COLLISION', 'The segment idempotency key must differ from every event key.', 400);
        eventIds.add(event.event_id);
        eventKeys.add(event.idempotency_key);
      }
      for (const eventKey of eventKeys) {
        if (this.db.prepare('SELECT 1 FROM idempotency_keys WHERE world_id=? AND idempotency_key=?').get(id, eventKey)) {
          throw new EngineError('SEGMENT_EVENT_KEY_ALREADY_USED', 'An event idempotency key in this segment has already been used outside this segment.', 409, { idempotency_key: eventKey });
        }
      }

      const eventResults = [];
      for (const event of events) {
        const currentWorld = this.world(id);
        const currentSequence = this.currentCommitSequence(id);
        const adjusted = {
          ...event,
          expected_revision: currentWorld.world_revision,
          expected_commit_sequence: currentSequence,
        };
        const { request_hash: _oldHash, idempotency_key: eventKey, ...requestPayload } = adjusted;
        adjusted.request_hash = hashRequest(requestPayload);
        const result = this.commit(id, adjusted, {
          deferRebuild: true,
          contextBaseRevision: worldAtStart.world_revision,
        });
        if (result.idempotent_replay) {
          throw new EngineError('SEGMENT_EVENT_KEY_ALREADY_USED', 'A segment event unexpectedly replayed an earlier commit.', 409, { idempotency_key: eventKey });
        }
        eventResults.push(result);
      }

      const finalWorld = this.world(id);
      this.rebuild(id, finalWorld.world_revision);
      const result = {
        accepted: true,
        segment_id: randomUUID(),
        world_id: id,
        event_ids: eventResults.map((event) => event.event_id),
        event_results: eventResults,
        start_game_time_coordinate: worldAtStart.game_time_coordinate,
        end_game_time_coordinate: finalWorld.game_time_coordinate,
        start_world_revision: worldAtStart.world_revision,
        world_revision: finalWorld.world_revision,
        start_commit_sequence: startCommitSequence,
        commit_sequence: this.currentCommitSequence(id),
        idempotent_replay: false,
      };
      this.saveReplay(id, key, requestHash, result);
      return result;
    });
  }

  createTimeAdvanceOperation(input) {
    return this.tx(() => {
      const old = this.db.prepare('SELECT * FROM time_advance_operations WHERE world_id=? AND idempotency_key=?')
        .get(input.world_id, input.idempotency_key);
      if (old) {
        if (old.request_hash !== input.request_hash) {
          throw new EngineError('IDEMPOTENCY_CONFLICT', 'The time-advance idempotency key was already used with a different request.', 409);
        }
        return timeAdvanceOperation(old);
      }
      const worldAtStart = this.world(input.world_id);
      if (!worldAtStart) throw new EngineError('WORLD_NOT_FOUND', 'World not found.', 404);
      if (worldAtStart.game_time_coordinate !== input.from_coordinate
        || worldAtStart.world_revision !== input.starting_world_revision) {
        throw new EngineError('TIME_ADVANCE_START_STALE', 'World time or revision changed before the time-advance operation was recorded.', 409);
      }
      const stamp = now();
      this.db.prepare(`INSERT INTO time_advance_operations(
        world_id,operation_id,idempotency_key,request_hash,from_coordinate,target_coordinate,confirmed_coordinate,
        starting_world_revision,current_world_revision,status,next_segment_index,segments_json,plan_json,result_json,error_json,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        input.world_id, input.operation_id, input.idempotency_key, input.request_hash,
        input.from_coordinate, input.target_coordinate, input.from_coordinate,
        input.starting_world_revision, input.starting_world_revision, input.status,
        0, enc(input.segments), enc(input.plan), input.result ? enc(input.result) : null,
        input.error ? enc(input.error) : null, stamp, stamp,
      );
      return timeAdvanceOperation(this.db.prepare('SELECT * FROM time_advance_operations WHERE world_id=? AND operation_id=?')
        .get(input.world_id, input.operation_id));
    });
  }

  getTimeAdvanceOperation(worldId, operationId) {
    const row = this.db.prepare('SELECT * FROM time_advance_operations WHERE world_id=? AND operation_id=?')
      .get(worldId, operationId);
    if (!row) throw new EngineError('TIME_ADVANCE_OPERATION_NOT_FOUND', 'Time-advance operation not found.', 404);
    return timeAdvanceOperation(row);
  }

  getTimeAdvanceOperationByKey(worldId, idempotencyKey) {
    const row = this.db.prepare('SELECT * FROM time_advance_operations WHERE world_id=? AND idempotency_key=?')
      .get(worldId, idempotencyKey);
    return row ? timeAdvanceOperation(row) : null;
  }

  resumeTimeAdvanceOperation(worldId, operationId) {
    while (true) {
      const current = this.db.prepare('SELECT * FROM time_advance_operations WHERE world_id=? AND operation_id=?')
        .get(worldId, operationId);
      if (!current) throw new EngineError('TIME_ADVANCE_OPERATION_NOT_FOUND', 'Time-advance operation not found.', 404);
      if (current.status !== 'running') return timeAdvanceOperation(current);
      const segments = dec(current.segments_json);
      if (current.next_segment_index >= segments.length) {
        this.tx(() => {
          const fresh = this.db.prepare('SELECT * FROM time_advance_operations WHERE world_id=? AND operation_id=?')
            .get(worldId, operationId);
          if (!fresh || fresh.status !== 'running') return;
          const plan = dec(fresh.plan_json);
          const finalStatus = plan.status === 'interrupted' ? 'interrupted' : 'completed';
          const result = {
            operation_id: operationId, world_id: worldId, status: finalStatus,
            from_coordinate: fresh.from_coordinate, target_coordinate: fresh.target_coordinate,
            confirmed_coordinate: fresh.confirmed_coordinate, world_revision: fresh.current_world_revision,
            completed_trigger_ids: plan.completed_trigger_ids || [],
          };
          this.db.prepare('UPDATE time_advance_operations SET status=?,result_json=?,updated_at=? WHERE world_id=? AND operation_id=?')
            .run(finalStatus, enc(result), now(), worldId, operationId);
        });
        continue;
      }
      try {
        this.tx(() => {
          const fresh = this.db.prepare('SELECT * FROM time_advance_operations WHERE world_id=? AND operation_id=?')
            .get(worldId, operationId);
          if (!fresh || fresh.status !== 'running') return;
          const worldAtStart = this.world(worldId);
          if (!worldAtStart) throw new EngineError('WORLD_NOT_FOUND', 'World not found.', 404);
          if (worldAtStart.game_time_coordinate !== fresh.confirmed_coordinate
            || worldAtStart.world_revision !== fresh.current_world_revision) {
            const errorBody = {
              code: 'TIME_ADVANCE_CHECKPOINT_STALE',
              message: 'World time or revision changed after the last confirmed operation segment.',
              expected_coordinate: fresh.confirmed_coordinate,
              current_coordinate: worldAtStart.game_time_coordinate,
              expected_revision: fresh.current_world_revision,
              current_revision: worldAtStart.world_revision,
            };
            this.db.prepare("UPDATE time_advance_operations SET status='needs_review',error_json=?,updated_at=? WHERE world_id=? AND operation_id=?")
              .run(enc(errorBody), now(), worldId, operationId);
            return;
          }
          const segment = segments[fresh.next_segment_index];
          if (!segment || !Array.isArray(segment.events) || segment.events.length < 1 || segment.events.length > 32) {
            throw new EngineError('INVALID_TIME_ADVANCE_SEGMENT', 'Persisted time-advance segment is malformed.', 500);
          }
          const commitResult = this.commitSegment(
            worldId, segment.events, segment.idempotency_key, segment.request_hash,
            worldAtStart.world_revision, this.currentCommitSequence(worldId),
          );
          const worldAfter = this.world(worldId);
          const nextIndex = fresh.next_segment_index + 1;
          const terminal = nextIndex >= segments.length;
          const plan = dec(fresh.plan_json);
          const status = terminal ? (plan.status === 'interrupted' ? 'interrupted' : 'completed') : 'running';
          const result = {
            operation_id: operationId, world_id: worldId, status,
            from_coordinate: fresh.from_coordinate, target_coordinate: fresh.target_coordinate,
            confirmed_coordinate: segment.coordinate, world_revision: worldAfter.world_revision,
            last_segment: commitResult, completed_trigger_ids: plan.completed_trigger_ids || [],
          };
          this.db.prepare(`UPDATE time_advance_operations SET
            confirmed_coordinate=?,current_world_revision=?,next_segment_index=?,status=?,result_json=?,error_json=NULL,updated_at=?
            WHERE world_id=? AND operation_id=?`).run(
            segment.coordinate, worldAfter.world_revision, nextIndex, status, enc(result), now(), worldId, operationId,
          );
        });
      } catch (error) {
        this.tx(() => {
          const fresh = this.db.prepare('SELECT status FROM time_advance_operations WHERE world_id=? AND operation_id=?')
            .get(worldId, operationId);
          if (!fresh || fresh.status !== 'running') return;
          const errorBody = { code: error?.code || 'TIME_ADVANCE_SEGMENT_FAILED', message: error?.message || 'Time-advance segment failed and requires review.' };
          this.db.prepare("UPDATE time_advance_operations SET status='needs_review',error_json=?,updated_at=? WHERE world_id=? AND operation_id=?")
            .run(enc(errorBody), now(), worldId, operationId);
        });
      }
    }
  }

  registerTimeConfiguration(worldId, config) {
    return this.tx(() => {
      const worldAtStart = this.world(worldId);
      if (!worldAtStart) throw new EngineError('WORLD_NOT_FOUND', 'World not found.', 404);
      if (config.world_pack_id !== worldAtStart.world_pack_id
        || config.world_pack_version !== worldAtStart.world_pack_version) {
        throw new EngineError('TIME_CONFIG_WORLD_PACK_MISMATCH', 'Time configuration must match the world\'s pinned World Pack ID and version.', 409);
      }
      const existing = this.db.prepare('SELECT * FROM world_time_configurations WHERE world_id=? AND version=?')
        .get(worldId, config.version);
      if (existing && existing.content_hash !== config.content_hash) {
        throw new EngineError('TIME_CONFIG_VERSION_IMMUTABLE', 'A time configuration version cannot be overwritten with different content.', 409);
      }
      if (existing && worldAtStart.time_config_version === config.version) {
        return this.publicTimeConfiguration(existing, true);
      }
      const nextRevision = worldAtStart.world_revision + 1;
      const stamp = now();
      if (!existing) {
        this.db.prepare(`INSERT INTO world_time_configurations(
          world_id,version,world_pack_id,world_pack_version,calendar_definition_json,time_policy_json,
          content_hash,created_by,created_revision,created_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
          worldId, config.version, config.world_pack_id, config.world_pack_version,
          enc(config.calendar_definition), enc(config.time_policy), config.content_hash,
          config.created_by, nextRevision, stamp,
        );
      }
      this.db.prepare('UPDATE worlds SET time_config_version=?,world_revision=? WHERE world_id=?')
        .run(config.version, nextRevision, worldId);
      this.db.prepare('INSERT INTO audit_entries(world_id,world_revision,action,target_id,payload_json,occurred_at) VALUES(?,?,?,?,?,?)')
        .run(worldId, nextRevision, 'time.configuration.activated', config.version, enc({
          world_pack_id: config.world_pack_id,
          world_pack_version: config.world_pack_version,
          calendar_id: config.calendar_definition.calendar_id,
          calendar_version: config.calendar_definition.version,
          policy_id: config.time_policy.policy_id,
          policy_version: config.time_policy.version,
          content_hash: config.content_hash,
          created_by: config.created_by,
        }), stamp);
      return this.getTimeConfiguration(worldId, config.version);
    });
  }

  getTimeConfiguration(worldId, version = null) {
    const worldAtStart = this.world(worldId);
    if (!worldAtStart) throw new EngineError('WORLD_NOT_FOUND', 'World not found.', 404);
    const selectedVersion = version ?? worldAtStart.time_config_version;
    if (selectedVersion === null || selectedVersion === undefined) return null;
    const row = this.db.prepare('SELECT * FROM world_time_configurations WHERE world_id=? AND version=?')
      .get(worldId, selectedVersion);
    if (!row) throw new EngineError('TIME_CONFIG_NOT_FOUND', 'Time configuration version not found for this world.', 404);
    return this.publicTimeConfiguration(row, worldAtStart.time_config_version === row.version);
  }

  publicTimeConfiguration(row, active = false) {
    return {
      world_id: row.world_id,
      version: row.version,
      world_pack_id: row.world_pack_id,
      world_pack_version: row.world_pack_version,
      calendar_definition: dec(row.calendar_definition_json),
      time_policy: dec(row.time_policy_json),
      content_hash: row.content_hash,
      created_by: row.created_by,
      created_revision: row.created_revision,
      created_at: row.created_at,
      active,
    };
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
          requires_review_event_ids: [], requires_review_items: [], rollback_outcome: 'resolved',
          world_revision: w.world_revision, no_op: true, idempotent_replay: false,
        };
        this.saveReplay(id, key, requestHash, result);
        return result;
      }
      const all = this.events(id, true);
      const invalid = new Set([rootId]);
      // A changed projection can only affect events committed after the
      // invalidated event that changed it. Keep the earliest invalidated
      // writer sequence per reference so rollback never invalidates a reader
      // because of a later change to the same identity.
      const affectedAt = new Map(refs(dec(root.effects_json)).map((ref) => [ref, root.commit_sequence]));
      const markAffected = (event) => {
        for (const ref of refs(event.effects)) {
          const previous = affectedAt.get(ref);
          if (previous === undefined || event.commit_sequence < previous) affectedAt.set(ref, event.commit_sequence);
        }
      };
      const projectionChanged = (ref, event) => {
        if (!affectedAt.has(ref) || affectedAt.get(ref) >= event.commit_sequence) return false;
        if (ref.startsWith('entity:')) {
          const entityId = ref.slice('entity:'.length);
          const before = this.entityProjectionAtCursor(id, event.commit_sequence).get(entityId);
          const after = this.entityProjectionAtCursor(id, event.commit_sequence, invalid).get(entityId);
          return !isDeepStrictEqual(before, after);
        }
        if (ref.startsWith('fact:')) {
          const factId = ref.slice('fact:'.length);
          const before = this.factProjectionAtCursor(id, event.commit_sequence).get(factId);
          const after = this.factProjectionAtCursor(id, event.commit_sequence, invalid).get(factId);
          return !sameFactProjection(before, after);
        }
        if (ref.startsWith('relationship:')) {
          const pair = parseRelationshipRef(ref);
          if (!pair) return false;
          const before = this.relationshipProjectionAtCursor(id, pair.subjectId, pair.targetId, event.commit_sequence);
          const after = this.relationshipProjectionAtCursor(id, pair.subjectId, pair.targetId, event.commit_sequence, invalid);
          return !isDeepStrictEqual(before, after);
        }
        return false;
      };
      let changed = true;
      while (changed) {
        changed = false;
        for (const event of all) {
          if (event.validity !== 'valid' || invalid.has(event.event_id)) continue;
          if (event.caused_by.some((value) => invalid.has(value))
            || event.depends_on.some((value) => invalid.has(value) || projectionChanged(value, event))
            || event.read_set.some((value) => projectionChanged(value, event))
            || (event.causal_links ?? []).some((link) => {
              if (link.relation === 'READS_SOURCE') return invalid.has(link.target_id);
              if (link.relation === 'READS_ENTITY') {
                // Identity-level reads depend on the historical entity projection.
                return projectionChanged('entity:' + link.target_id, event);
              }
              if (link.relation === 'READS_CLAIM') {
                // Compare the fact projection, not merely the presence of a source.
                return projectionChanged('fact:' + link.target_id, event);
              }
              if (link.relation === 'REQUIRES') {
                const entities = this.entityProjectionAtCursor(id, event.commit_sequence, invalid);
                const facts = this.factProjectionAtCursor(id, event.commit_sequence, invalid);
                return predicateResult(entities, link.predicate, facts) === 'false';
              }
              return false;
            })) {
            invalid.add(event.event_id);
            markAffected(event);
            changed = true;
          }
        }
      }

      // Unknown predicates only block a rollback when the uncertain historical
      // projection is itself touched by this rollback. An unrelated legacy
      // ambiguity must not prevent an otherwise independent rollback.
      const requiresReviewItems = all
        .filter((event) => event.validity === 'valid' && !invalid.has(event.event_id))
        .flatMap((event) => (event.causal_links ?? [])
          .filter((link) => link.relation === 'REQUIRES')
          .flatMap((link) => {
            const entities = this.entityProjectionAtCursor(id, event.commit_sequence, invalid);
            const facts = this.factProjectionAtCursor(id, event.commit_sequence, invalid);
            if (predicateResult(entities, link.predicate, facts) !== 'unknown') return [];
            const targetRef = ['fact_value', 'fact_absent'].includes(link.predicate?.kind)
              ? 'fact:' + link.predicate.fact_id
              : ['entity_exists', 'entity_absent', 'entity_attribute'].includes(link.predicate?.kind)
                ? 'entity:' + link.predicate.entity_id
                : null;
            if (!targetRef || !projectionChanged(targetRef, event)) return [];
            return [{
              event_id: event.event_id,
              reason_code: 'historical_predicate_unknown',
              pre_rollback_status: event.validity,
              predicate: link.predicate,
              evaluated_as: 'unknown',
              affected_dependencies: [{ kind: 'projection', target_ref: targetRef }],
            }];
          }));

      if (requiresReviewItems.length > 0) {
        const reviewEventIds = [...new Set(requiresReviewItems.map((item) => item.event_id))];
        const result = {
          accepted: true,
          rollback_id: null,
          root_event_id: rootId,
          invalidated_event_ids: [],
          proposed_invalidated_event_ids: [...invalid],
          requires_review_event_ids: reviewEventIds,
          requires_review_items: requiresReviewItems,
          rollback_outcome: 'requires_review',
          world_revision: w.world_revision,
          no_op: true,
          idempotent_replay: false,
        };
        // Persist the diagnostic response for exact idempotent replay, but do
        // not write a canonical-state audit row or increment world_revision:
        // no semantic rollback was applied.
        this.saveReplay(id, key, requestHash, result);
        return result;
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
        requires_review_event_ids: [], requires_review_items: [], rollback_outcome: 'resolved',
        world_revision: revision, no_op: false, idempotent_replay: false,
      };
      this.db.prepare("INSERT INTO audit_entries(world_id,world_revision,action,target_id,payload_json,occurred_at) VALUES(?,?,\'rollback.applied\',?,?,?)")
        .run(id, revision, rollbackId, enc({
          root_event_id: rootId, invalidated_event_ids: ids, rollback_outcome: 'resolved',
          requires_review_event_ids: [], requires_review_items: [],
        }), createdAt);
      this.saveReplay(id, key, requestHash, result);
      return result;
    });
  }

  getMechanicInstance(worldId, instanceId) {
    if (!this.world(worldId)) throw new EngineError('WORLD_NOT_FOUND', 'World not found.', 404);
    const row = this.db.prepare('SELECT * FROM mechanic_instances WHERE world_id=? AND instance_id=?').get(worldId, instanceId);
    if (!row) throw new EngineError('MECHANIC_INSTANCE_NOT_FOUND', 'Mechanic instance not found in this world.', 404);
    return this.publicMechanicInstance(row);
  }
  listMechanicInstances(worldId) {
    if (!this.world(worldId)) throw new EngineError('WORLD_NOT_FOUND', 'World not found.', 404);
    return this.db.prepare('SELECT * FROM mechanic_instances WHERE world_id=? ORDER BY instance_id').all(worldId).map((row) => this.publicMechanicInstance(row));
  }
  publicMechanicInstance(row) {
    return { world_id: row.world_id, instance_id: row.instance_id, template_id: row.template_id, template_version: row.template_version,
      status: row.status, parameters: dec(row.parameters_json), state: dec(row.state_json), created_by_event_id: row.created_by_event_id,
      created_revision: row.created_revision, updated_revision: row.updated_revision, disabled_at_revision: row.disabled_at_revision,
      needs_review_reason: row.needs_review_reason, last_event_id: row.last_event_id };
  }


  relationshipProjectionAtCursor(worldId, subjectId, targetId, cursor, excluded = new Set()) {
    const values = new Map();
    const rows = this.db.prepare("SELECT event_id,commit_sequence,effects_json FROM world_events WHERE world_id=? AND validity='valid' AND commit_sequence<? ORDER BY commit_sequence")
      .all(worldId, cursor);
    for (const row of rows) {
      if (excluded.has(row.event_id)) continue;
      for (const effect of dec(row.effects_json)) {
        if (effect.kind !== 'relationship.transition' || effect.subject_id !== subjectId || effect.target_id !== targetId) continue;
        for (const [dimension, value] of Object.entries(effect.patch)) {
          const cleared = value && typeof value === 'object' && value.operation === 'clear';
          values.set(dimension, cleared ? { status: 'cleared' } : { status: 'value', value });
        }
      }
    }
    return Object.fromEntries([...values.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }

  getRelationshipPair(worldId, subjectId, targetId) {
    const read = () => {
      const w = this.world(worldId);
      if (!w) throw new EngineError('WORLD_NOT_FOUND', 'World not found.', 404);
      const rows = this.db.prepare('SELECT dimension,status,value_json,rule_module_id,rule_module_version,last_event_id,updated_revision FROM relationships WHERE world_id=? AND subject_id=? AND target_id=? ORDER BY dimension')
        .all(worldId, subjectId, targetId);
      const dimensions = {};
      for (const row of rows) {
        Object.defineProperty(dimensions, row.dimension, {
          value: row.status === 'cleared' ? { status: 'cleared' } : dec(row.value_json),
          enumerable: true, configurable: true, writable: true,
        });
      }
      return {
        world_id: worldId, subject_id: subjectId, target_id: targetId, dimensions,
        world_revision: w.world_revision, commit_sequence: this.currentCommitSequence(worldId),
      };
    };
    // Match state(): callers already inside the store's write transaction must
    // see that transaction's projection. Otherwise pin all reads to one SQLite
    // read snapshot so dimensions and the freshness cursor cannot disagree.
    if (this.txDepth > 0) return read();
    let began = false;
    try {
      this.db.exec('BEGIN');
      began = true;
      const pair = read();
      this.db.exec('COMMIT');
      began = false;
      return pair;
    } catch (error) {
      if (began) {
        try { this.db.exec('ROLLBACK'); } catch {}
      }
      throw error;
    }
  }

  rebuild(id, revision) {
    this.db.prepare('DELETE FROM mechanic_instances WHERE world_id=?').run(id);
    this.db.prepare('DELETE FROM entities WHERE world_id=?').run(id);
    this.db.prepare('DELETE FROM facts WHERE world_id=?').run(id);
    this.db.prepare('DELETE FROM fact_claims WHERE world_id=?').run(id);
    this.db.prepare('DELETE FROM relationships WHERE world_id=?').run(id);
    const events = this.db.prepare("SELECT * FROM world_events WHERE world_id=? AND validity='valid' ORDER BY commit_sequence").all(id);
    const upsertEntity = this.db.prepare(`INSERT INTO entities(
      world_id,entity_id,entity_type,status,attributes_json,created_by_event_id,updated_revision
    ) VALUES(?,?,?,?,?,?,?) ON CONFLICT(world_id,entity_id) DO UPDATE SET
      entity_type=excluded.entity_type,status=excluded.status,attributes_json=excluded.attributes_json,
      created_by_event_id=excluded.created_by_event_id,updated_revision=excluded.updated_revision`);
    const insertClaim = this.db.prepare('INSERT INTO fact_claims(world_id,fact_id,event_id,subject_ref,predicate,value_json,committed_revision) VALUES(?,?,?,?,?,?,?)');
    const insertMechanic = this.db.prepare(`INSERT INTO mechanic_instances(
      world_id,instance_id,template_id,template_version,status,parameters_json,state_json,created_by_event_id,created_revision,updated_revision,disabled_at_revision,needs_review_reason,last_event_id
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL,?)`);
    for (const event of events) {
      for (const effect of dec(event.effects_json)) {
        if (effect.kind === 'relationship.transition') {
          const upsertRelationship = this.db.prepare(`INSERT INTO relationships(
            world_id,subject_id,target_id,dimension,status,value_json,rule_module_id,rule_module_version,last_event_id,updated_revision
          ) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(world_id,subject_id,target_id,dimension) DO UPDATE SET
            status=excluded.status,value_json=excluded.value_json,rule_module_id=excluded.rule_module_id,
            rule_module_version=excluded.rule_module_version,last_event_id=excluded.last_event_id,updated_revision=excluded.updated_revision`);
          for (const [dimension, value] of Object.entries(effect.patch)) {
            const cleared = value && typeof value === 'object' && value.operation === 'clear';
            upsertRelationship.run(id, effect.subject_id, effect.target_id, dimension, cleared ? 'cleared' : 'value',
              cleared ? null : enc(value), effect.rule_module_id, effect.rule_module_version, event.event_id, event.committed_revision);
          }
        } else if (effect.kind === 'mechanic.instance.create') {
          insertMechanic.run(id, effect.instance_id, effect.template_id, effect.template_version, 'disabled', enc(effect.parameters || {}), enc(effect.state || {}), event.event_id, event.committed_revision, event.committed_revision, event.committed_revision, event.event_id);
        } else if (effect.kind === 'mechanic.instance.enable' || effect.kind === 'mechanic.instance.disable') {
          const current = this.db.prepare('SELECT status FROM mechanic_instances WHERE world_id=? AND instance_id=?').get(id, effect.instance_id);
          if (!current) throw new EngineError('MECHANIC_PROJECTION_REBUILD_FAILED', 'Lifecycle event has no valid create event in the rebuilt projection.', 500, { instance_id: effect.instance_id, event_id: event.event_id });
          const status = effect.kind === 'mechanic.instance.enable' ? 'enabled' : 'disabled';
          this.db.prepare('UPDATE mechanic_instances SET status=?,updated_revision=?,disabled_at_revision=?,last_event_id=? WHERE world_id=? AND instance_id=?')
            .run(status, event.committed_revision, status === 'disabled' ? event.committed_revision : null, event.event_id, id, effect.instance_id);
        } else if (effect.kind === 'entity.create' || effect.kind === 'entity.upsert') {
          upsertEntity.run(id, effect.entity_id, effect.entity_type, effect.status || 'active', enc(effect.attributes || {}), event.event_id, event.committed_revision);
        } else if (effect.kind === 'entity.update') {
          const current = this.db.prepare('SELECT entity_type,status,attributes_json,created_by_event_id FROM entities WHERE world_id=? AND entity_id=?').get(id, effect.entity_id);
          if (current) {
            const attributes = dec(current.attributes_json);
            Object.assign(attributes, effect.attributes || {});
            for (const key of effect.remove_attributes || []) delete attributes[key];
            this.db.prepare('UPDATE entities SET status=?,attributes_json=?,updated_revision=? WHERE world_id=? AND entity_id=?')
              .run(effect.status ?? current.status, enc(attributes), event.committed_revision, id, effect.entity_id);
          }
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
