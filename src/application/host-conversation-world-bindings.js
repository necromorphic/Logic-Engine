import { EngineError } from '../core/errors.js';

const validId = (value) => typeof value === 'string' && value === value.trim()
  && value.length > 0 && value.length <= 200
  && ![...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
const validReason = (value) => typeof value === 'string' && value.trim().length >= 8
  && value.trim().length <= 500 && ![...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 && character !== '\n' && character !== '\t';
  });
const now = () => new Date().toISOString();

/**
 * Core-owned mapping from an authenticated adapter-scoped Host conversation
 * identity to a canonical world. The caller must derive adapterId from the
 * authenticated transport; resolution accepts no caller-supplied worldId.
 *
 * Assignment alone does not prove Host inventory completeness, source
 * freshness, Provider authorization, anti-rollback, or dispatch authorization.
 */
export class HostConversationWorldBindingService {
  constructor(engine) {
    if (!engine?.store?.db || typeof engine.store.tx !== 'function') {
      throw new TypeError('HostConversationWorldBindingService requires a persistent Core store');
    }
    this.engine = engine;
    this.db = engine.store.db;
  }

  bind({ adapterId, conversationId, worldId, rebind = false, reason = null }) {
    if (!validId(adapterId) || !validId(conversationId) || !validId(worldId)
      || typeof rebind !== 'boolean' || (rebind && !validReason(reason))) {
      throw new EngineError('INVALID_HOST_CONVERSATION_BINDING',
        'Valid adapter, conversation and world identifiers are required; rebind requires an audit reason.', 400);
    }
    return this.engine.store.tx(() => {
      if (!this.engine.store.world(worldId)) {
        throw new EngineError('WORLD_NOT_FOUND', 'World not found.', 404);
      }
      const key = [adapterId, conversationId];
      const existing = this.db.prepare('SELECT adapter_id,conversation_id,world_id,active,created_at,updated_at FROM host_conversation_world_bindings WHERE adapter_id=? AND conversation_id=?').get(...key);
      if (existing?.active === 1) {
        if (existing.world_id !== worldId) {
          throw new EngineError('HOST_CONVERSATION_WORLD_CONFLICT',
            'This Host conversation identity is already assigned to another world; implicit reassignment is forbidden.', 409);
        }
        return Object.freeze({ ...existing, active: true, already_bound: true });
      }
      if (existing && !rebind) {
        throw new EngineError('HOST_CONVERSATION_REBIND_REQUIRED',
          'A revoked Host conversation identity requires explicit audited rebind.', 409);
      }

      const timestamp = now();
      if (existing) {
        this.db.prepare('UPDATE host_conversation_world_bindings SET world_id=?,active=1,updated_at=? WHERE adapter_id=? AND conversation_id=? AND active=0')
          .run(worldId, timestamp, ...key);
      } else {
        this.db.prepare('INSERT INTO host_conversation_world_bindings (adapter_id,conversation_id,world_id,active,created_at,updated_at) VALUES(?,?,?,1,?,?)')
          .run(adapterId, conversationId, worldId, timestamp, timestamp);
      }
      this.db.prepare('INSERT INTO audit_entries (world_id,world_revision,action,target_id,payload_json,occurred_at) VALUES(?,?,?,?,?,?)')
        .run(worldId, this.engine.store.world(worldId).world_revision,
          existing ? 'host.conversation_world.rebound' : 'host.conversation_world.bound',
          conversationId, JSON.stringify({
            adapter_id: adapterId, conversation_id: conversationId, world_id: worldId,
            previous_world_id: existing?.world_id ?? null, reason: existing ? reason.trim() : null,
          }), timestamp);
      return Object.freeze({
        adapter_id: adapterId, conversation_id: conversationId, world_id: worldId,
        active: true, created_at: existing?.created_at ?? timestamp, updated_at: timestamp,
        already_bound: false,
      });
    });
  }

  revoke({ adapterId, conversationId, reason }) {
    if (!validId(adapterId) || !validId(conversationId) || !validReason(reason)) {
      throw new EngineError('INVALID_HOST_CONVERSATION_BINDING',
        'Valid adapter and conversation identifiers plus an audit reason of at least 8 characters are required.', 400);
    }
    return this.engine.store.tx(() => {
      const existing = this.db.prepare('SELECT adapter_id,conversation_id,world_id,active,created_at,updated_at FROM host_conversation_world_bindings WHERE adapter_id=? AND conversation_id=?')
        .get(adapterId, conversationId);
      if (!existing) throw new EngineError('HOST_CONVERSATION_BINDING_NOT_FOUND', 'Host conversation binding not found.', 404);
      if (existing.active !== 1) return Object.freeze({ ...existing, active: false, changed: false });
      const timestamp = now();
      this.db.prepare('UPDATE host_conversation_world_bindings SET active=0,updated_at=? WHERE adapter_id=? AND conversation_id=? AND active=1')
        .run(timestamp, adapterId, conversationId);
      this.db.prepare('INSERT INTO audit_entries (world_id,world_revision,action,target_id,payload_json,occurred_at) VALUES(?,?,?,?,?,?)')
        .run(existing.world_id, this.engine.store.world(existing.world_id).world_revision,
          'host.conversation_world.revoked', conversationId,
          JSON.stringify({ adapter_id: adapterId, conversation_id: conversationId, reason: reason.trim() }), timestamp);
      return Object.freeze({ ...existing, active: false, updated_at: timestamp, changed: true });
    });
  }

  resolve({ adapterId, conversationId }) {
    if (!validId(adapterId) || !validId(conversationId)) {
      throw new EngineError('INVALID_HOST_CONVERSATION_RESOLUTION',
        'Authenticated adapter identity and stable Host conversation identity are required.', 400);
    }
    const binding = this.db.prepare('SELECT adapter_id,conversation_id,world_id,active,created_at,updated_at FROM host_conversation_world_bindings WHERE adapter_id=? AND conversation_id=?')
      .get(adapterId, conversationId);
    if (!binding || binding.active !== 1) {
      throw new EngineError('HOST_CONVERSATION_NOT_AUTHORIZED',
        'Host conversation has no active Core-authorized world assignment.', 403);
    }
    if (!this.engine.store.world(binding.world_id)) {
      throw new EngineError('HOST_CONVERSATION_WORLD_UNAVAILABLE',
        'The bound canonical world is unavailable.', 409);
    }
    return Object.freeze({ ...binding, active: true });
  }
}
