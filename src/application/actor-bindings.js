import { EngineError } from '../core/errors.js';

const validId = (value) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 200;
const now = () => new Date().toISOString();

/**
 * Core-owned allowlist binding between an authenticated adapter and a canonical
 * in-world actor. This authorizes identity resolution only, never knowledge reads,
 * action semantics, approval, or commit.
 */
export class ActorBindingService {
  constructor(engine) {
    if (!engine?.store?.db) throw new TypeError('ActorBindingService requires an engine with a persistent store');
    this.engine = engine;
    this.db = engine.store.db;
    this.engine.store.tx(() => this.db.exec(`
      CREATE TABLE IF NOT EXISTS actor_bindings (
        world_id TEXT NOT NULL REFERENCES worlds(world_id),
        adapter_id TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(world_id, adapter_id, entity_id)
      );
    `));
  }

  bind(worldId, adapterId, entityId) {
    if (!validId(worldId) || !validId(adapterId) || !validId(entityId)) {
      throw new EngineError('INVALID_ACTOR_BINDING', 'world_id, adapter_id and entity_id must be non-empty identifiers.', 400);
    }
    return this.engine.store.tx(() => {
      if (!this.engine.store.world(worldId)) throw new EngineError('WORLD_NOT_FOUND', 'World not found.', 404);
      const entity = this.db.prepare('SELECT status FROM entities WHERE world_id=? AND entity_id=?').get(worldId, entityId.trim());
      if (!entity || entity.status === 'destroyed') {
        throw new EngineError('ACTOR_ENTITY_NOT_ELIGIBLE', 'Actor must be an existing, non-destroyed canonical entity in this world.', 409);
      }
      const t = now();
      const existing = this.db.prepare('SELECT active FROM actor_bindings WHERE world_id=? AND adapter_id=? AND entity_id=?')
        .get(worldId, adapterId.trim(), entityId.trim());
      if (existing?.active === 1) return { world_id: worldId, adapter_id: adapterId.trim(), entity_id: entityId.trim(), active: true, already_bound: true };
      this.db.prepare(`INSERT INTO actor_bindings(world_id,adapter_id,entity_id,active,created_at,updated_at)
        VALUES(?,?,?,1,?,?) ON CONFLICT(world_id,adapter_id,entity_id)
        DO UPDATE SET active=1,updated_at=excluded.updated_at`)
        .run(worldId, adapterId.trim(), entityId.trim(), t, t);
      this.db.prepare('INSERT INTO audit_entries(world_id,world_revision,action,target_id,payload_json,occurred_at) VALUES(?,?,?,?,?,?)')
        .run(worldId, this.engine.store.world(worldId).world_revision, 'actor.binding.created', entityId.trim(),
          JSON.stringify({ adapter_id: adapterId.trim(), entity_id: entityId.trim() }), t);
      return { world_id: worldId, adapter_id: adapterId.trim(), entity_id: entityId.trim(), active: true, already_bound: false };
    });
  }

  revoke(worldId, adapterId, entityId) {
    if (!validId(worldId) || !validId(adapterId) || !validId(entityId)) {
      throw new EngineError('INVALID_ACTOR_BINDING', 'world_id, adapter_id and entity_id must be non-empty identifiers.', 400);
    }
    return this.engine.store.tx(() => {
      if (!this.engine.store.world(worldId)) throw new EngineError('WORLD_NOT_FOUND', 'World not found.', 404);
      const t = now();
      const changed = this.db.prepare('UPDATE actor_bindings SET active=0,updated_at=? WHERE world_id=? AND adapter_id=? AND entity_id=? AND active=1')
        .run(t, worldId, adapterId.trim(), entityId.trim()).changes;
      if (changed) {
        this.db.prepare('INSERT INTO audit_entries(world_id,world_revision,action,target_id,payload_json,occurred_at) VALUES(?,?,?,?,?,?)')
          .run(worldId, this.engine.store.world(worldId).world_revision, 'actor.binding.revoked', entityId.trim(),
            JSON.stringify({ adapter_id: adapterId.trim(), entity_id: entityId.trim() }), t);
      }
      return { world_id: worldId, adapter_id: adapterId.trim(), entity_id: entityId.trim(), active: false, changed: Boolean(changed) };
    });
  }

  resolve(worldId, adapterId, entityId) {
    if (!validId(worldId) || !validId(adapterId) || !validId(entityId)) {
      throw new EngineError('INVALID_ACTOR_RESOLUTION', 'world_id, adapter_id and entity_id must be non-empty identifiers.', 400);
    }
    if (!this.engine.store.world(worldId)) throw new EngineError('WORLD_NOT_FOUND', 'World not found.', 404);
    const binding = this.db.prepare('SELECT active FROM actor_bindings WHERE world_id=? AND adapter_id=? AND entity_id=?')
      .get(worldId, adapterId.trim(), entityId.trim());
    if (!binding || binding.active !== 1) {
      throw new EngineError('ACTOR_NOT_AUTHORIZED', 'The authenticated adapter is not bound to this actor in this world.', 403);
    }
    const entity = this.db.prepare('SELECT entity_id,entity_type,status FROM entities WHERE world_id=? AND entity_id=?')
      .get(worldId, entityId.trim());
    if (!entity || entity.status === 'destroyed') {
      throw new EngineError('ACTOR_ENTITY_NOT_ELIGIBLE', 'Bound actor is no longer an eligible canonical entity.', 409);
    }
    return { world_id: worldId, adapter_id: adapterId.trim(), actor: entity };
  }
}
