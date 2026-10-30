const validId = value => typeof value === 'string' && value === value.trim()
  && value.length > 0 && value.length <= 200
  && ![...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);

const DENY_VISIBILITY_REF = 'core:npc-visibility-default-deny-v1';
const READ_AUTHORIZATION_REF = 'core:host-conversation-actor-binding-v1';

/**
 * Production Core authorizers for the internal NPC knowledge reader.
 *
 * A read requires all three deployment-owned facts:
 * 1. adapter identity is configured by the runtime;
 * 2. this exact Host conversation is actively bound to this exact world;
 * 3. this exact adapter is actively bound to this exact actor in that world.
 *
 * Per-acquisition visibility additionally requires provenance_ref + digest to
 * match the trusted source registry for the world's exact World Pack version.
 * No request field or model proposal can create any of these bindings.
 */
export function createHostBoundNpcKnowledgeAuthorizers({
  store,
  adapterIds,
  trustedInitialKnowledgeSources,
}) {
  if (!store?.db || typeof store.world !== 'function') {
    throw new TypeError('A persistent Core store is required for NPC knowledge authorization.');
  }
  if (!Array.isArray(adapterIds) || adapterIds.some(id => !validId(id))
    || new Set(adapterIds).size !== adapterIds.length) {
    throw new TypeError('adapterIds must be a unique array of configured adapter identifiers.');
  }
  if (!Array.isArray(trustedInitialKnowledgeSources)) {
    throw new TypeError('trustedInitialKnowledgeSources must be a deployment-owned array.');
  }

  const configuredAdapters = new Set(adapterIds);
  const trustedSources = trustedInitialKnowledgeSources.map(source => Object.freeze({ ...source }));
  const hostIdentityScopes = new WeakMap();

  /**
   * Resolve the only authoritative scope from a server-authenticated adapter
   * identity and its stable Host conversation key. Neither world nor actor is
   * selected by request data. Ambiguous actor bindings deny rather than picking
   * the first candidate.
   */
  function resolveHostScope(identity) {
    if (!identity || typeof identity !== 'object' || Array.isArray(identity)
      || Object.keys(identity).some(key => key !== 'adapter_id' && key !== 'conversation_id')
      || !validId(identity.adapter_id) || !validId(identity.conversation_id)
      || !configuredAdapters.has(identity.adapter_id)) return null;
    try {
      const host = store.db.prepare(
        'SELECT world_id,active FROM host_conversation_world_bindings WHERE adapter_id=? AND conversation_id=?'
      ).get(identity.adapter_id, identity.conversation_id);
      if (!host || host.active !== 1 || !validId(host.world_id)) return null;
      const actors = store.db.prepare(`
        SELECT b.entity_id,e.status
        FROM actor_bindings AS b
        JOIN entities AS e ON e.world_id=b.world_id AND e.entity_id=b.entity_id
        WHERE b.world_id=? AND b.adapter_id=? AND b.active=1
        ORDER BY b.entity_id
      `).all(host.world_id, identity.adapter_id);
      if (actors.length !== 1 || actors[0].status === 'destroyed' || !validId(actors[0].entity_id)) return null;
      return Object.freeze({
        world_id: host.world_id,
        conversation_id: identity.conversation_id,
        adapter_id: identity.adapter_id,
        actor_id: actors[0].entity_id,
      });
    } catch {
      // Missing tables, missing rows and storage errors all deny.
      return null;
    }
  }

  /**
   * Create an opaque Host identity only after the API boundary has authenticated
   * adapter credentials. The identity is bound to the current Core world/actor
   * mapping and cannot be reconstructed from caller-provided IDs.
   */
  function createHostIdentity(identity) {
    const scope = resolveHostScope(identity);
    if (!scope) return null;
    const token = Object.freeze(Object.create(null));
    hostIdentityScopes.set(token, scope);
    return token;
  }

  /** Re-resolve the binding on every use; revoked or rebound identities expire. */
  function resolveHostIdentity(identity) {
    if (!identity || typeof identity !== 'object') return null;
    const original = hostIdentityScopes.get(identity);
    if (!original) return null;
    const current = resolveHostScope({
      adapter_id: original.adapter_id,
      conversation_id: original.conversation_id,
    });
    if (!current || current.world_id !== original.world_id || current.actor_id !== original.actor_id) return null;
    return current;
  }

  function activeHostAndActorBinding(scope) {
    if (!scope || !validId(scope.world_id) || !validId(scope.conversation_id)
      || !validId(scope.adapter_id) || !validId(scope.actor_id)) return false;
    const binding = resolveHostScope({
      adapter_id: scope.adapter_id,
      conversation_id: scope.conversation_id,
    });
    return Boolean(binding
      && binding.world_id === scope.world_id
      && binding.actor_id === scope.actor_id);
  }

  function readAuthorizer(scope) {
    if (!activeHostAndActorBinding(scope)) return null;
    const binding = resolveHostScope({
      adapter_id: scope.adapter_id,
      conversation_id: scope.conversation_id,
    });
    if (!binding) return null;
    return Object.freeze({
      status: 'authorized',
      world_id: binding.world_id,
      conversation_id: binding.conversation_id,
      adapter_id: binding.adapter_id,
      actor_id: binding.actor_id,
      recipient: scope.recipient,
      purpose: scope.purpose,
      world_revision: scope.world_revision,
      commit_sequence: scope.commit_sequence,
      authorization_ref: READ_AUTHORIZATION_REF,
    });
  }

  function visibilityAuthorizer(scope) {
    const binding = resolveHostScope({
      adapter_id: scope?.adapter_id,
      conversation_id: scope?.conversation_id,
    });
    let source = null;
    if (binding && binding.world_id === scope.world_id && binding.actor_id === scope.actor_id
      && validId(scope.acquisition_kind)
      && validId(scope.acquisition_authorization_ref)
      && validId(scope.provenance_ref)
      && typeof scope.provenance_digest === 'string'
      && /^[a-f0-9]{64}$/.test(scope.provenance_digest)) {
      const world = store.world(binding.world_id);
      source = trustedSources.find(candidate =>
        candidate.world_pack_id === world?.world_pack_id
        && candidate.world_pack_version === world?.world_pack_version
        && candidate.source_kind === scope.acquisition_kind
        && candidate.source_ref === scope.provenance_ref
        && candidate.sha256 === scope.provenance_digest
        && candidate.authorization_ref === scope.acquisition_authorization_ref
        && validId(candidate.authorization_ref)) ?? null;
    }
    return Object.freeze({
      status: source ? 'allowed' : 'denied',
      world_id: scope.world_id,
      conversation_id: scope.conversation_id,
      adapter_id: scope.adapter_id,
      actor_id: scope.actor_id,
      recipient: scope.recipient,
      purpose: scope.purpose,
      world_revision: scope.world_revision,
      commit_sequence: scope.commit_sequence,
      acquisition_id: scope.acquisition_id,
      authorization_ref: source?.authorization_ref ?? DENY_VISIBILITY_REF,
    });
  }

  return Object.freeze({
    readAuthorizer,
    visibilityAuthorizer,
    resolveHostScope,
    createHostIdentity,
    resolveHostIdentity,
  });
}
