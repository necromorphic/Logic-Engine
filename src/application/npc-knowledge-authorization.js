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

  /**
   * Resolve canonical scope from Core-owned bindings. Request world/actor values
   * are never used to select rows: Host binding selects the world, then the
   * adapter's active actor binding must resolve to exactly one eligible actor.
   * Ambiguity is a denial, not a caller-controlled selection opportunity.
   */
  function resolveContext(identity) {
    if (!identity || !validId(identity.conversation_id)
      || !validId(identity.adapter_id) || !configuredAdapters.has(identity.adapter_id)) return null;
    try {
      const host = store.db.prepare(
        'SELECT world_id,active FROM host_conversation_world_bindings WHERE adapter_id=? AND conversation_id=?'
      ).get(identity.adapter_id, identity.conversation_id);
      if (!host || host.active !== 1) return null;
      const world = store.world(host.world_id);
      if (!world || world.status !== 'active') return null;

      const actors = store.db.prepare(
        'SELECT entity_id FROM actor_bindings WHERE world_id=? AND adapter_id=? AND active=1 ORDER BY entity_id'
      ).all(host.world_id, identity.adapter_id);
      if (actors.length !== 1) return null;
      const actor = store.db.prepare(
        "SELECT entity_id,status FROM entities WHERE world_id=? AND entity_id=?"
      ).get(host.world_id, actors[0].entity_id);
      if (!actor || actor.status === 'destroyed') return null;

      return Object.freeze({
        world_id: host.world_id,
        conversation_id: identity.conversation_id,
        adapter_id: identity.adapter_id,
        actor_id: actor.entity_id,
      });
    } catch {
      // Missing migrations, missing rows, and storage errors all deny.
      return null;
    }
  }

  function activeHostAndActorBinding(scope) {
    if (!scope) return false;
    const binding = resolveContext({
      adapter_id: scope.adapter_id,
      conversation_id: scope.conversation_id,
    });
    return Boolean(binding
      && binding.world_id === scope.world_id
      && binding.actor_id === scope.actor_id);
  }

  function readAuthorizer(scope) {
    if (!activeHostAndActorBinding(scope)) return null;
    return Object.freeze({
      status: 'authorized',
      world_id: scope.world_id,
      conversation_id: scope.conversation_id,
      adapter_id: scope.adapter_id,
      actor_id: scope.actor_id,
      recipient: scope.recipient,
      purpose: scope.purpose,
      world_revision: scope.world_revision,
      commit_sequence: scope.commit_sequence,
      authorization_ref: READ_AUTHORIZATION_REF,
    });
  }

  function visibilityAuthorizer(scope) {
    let source = null;
    if (activeHostAndActorBinding(scope)
      && validId(scope.acquisition_kind)
      && validId(scope.acquisition_authorization_ref)
      && validId(scope.provenance_ref)
      && typeof scope.provenance_digest === 'string'
      && /^[a-f0-9]{64}$/.test(scope.provenance_digest)) {
      const world = store.world(scope.world_id);
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

  return Object.freeze({ resolveContext, readAuthorizer, visibilityAuthorizer });
}
