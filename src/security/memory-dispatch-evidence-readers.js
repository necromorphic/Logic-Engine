import { canonicalEntitySourceVersion } from '../application/canonical-entity-source-version.js';

/**
 * Creates the only supported in-process evidence readers for MemoryDispatchGateway.
 *
 * trustedContext must be constructed by the server-side Host adapter from its
 * authenticated session and active-chat state. Never pass browser request fields
 * directly as this object. The readers do not expose record content.
 */
export function createTrustedMemoryDispatchEvidenceReaders({
  engine,
  actorBindingService,
  hostConversationWorldBindingService,
  hostVersionDigestLedger,
  memoryProvider,
  trustedContext,
}) {
  if (!engine?.store?.db || typeof engine.getSnapshot !== 'function'
    || typeof actorBindingService?.resolve !== 'function'
    || typeof hostConversationWorldBindingService?.resolve !== 'function'
    || typeof hostVersionDigestLedger?.getInventoryState !== 'function'
    || typeof memoryProvider?.readDispatchEvidence !== 'function'
    || !trustedContext || typeof trustedContext !== 'object' || Array.isArray(trustedContext)
    || Object.keys(trustedContext).some((key) => !['adapterId', 'conversationId', 'actorEntityId'].includes(key))
    || ![trustedContext.adapterId, trustedContext.conversationId, trustedContext.actorEntityId]
      .every((value) => typeof value === 'string' && value === value.trim()
        && value.length > 0 && value.length <= 200
        && ![...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))) {
    throw new TypeError('Trusted Memory dispatch readers require Core services and server-derived Host context.');
  }

  const allowedPurposes = new Set(['npc_decision', 'character_card', 'narrative']);

  const context = Object.freeze({
    adapterId: trustedContext.adapterId,
    conversationId: trustedContext.conversationId,
    actorEntityId: trustedContext.actorEntityId,
  });

  function resolveScope(request) {
    if (!request || typeof request !== 'object'
      || request.actorId !== context.actorEntityId
      || typeof request.worldId !== 'string' || request.worldId !== request.worldId.trim()
      || !request.worldId || typeof request.purpose !== 'string' || !allowedPurposes.has(request.purpose)) {
      throw new Error('MEMORY_DISPATCH_NOT_READY');
    }
    let conversation;
    try {
      conversation = hostConversationWorldBindingService.resolve({
        adapterId: context.adapterId,
        conversationId: context.conversationId,
      });
    } catch {
      throw new Error('MEMORY_DISPATCH_NOT_READY');
    }
    if (!conversation || conversation.active !== true || conversation.world_id !== request.worldId) {
      throw new Error('MEMORY_DISPATCH_NOT_READY');
    }
    let actor;
    try {
      actor = actorBindingService.resolve(conversation.world_id, context.adapterId, context.actorEntityId);
    } catch {
      throw new Error('MEMORY_DISPATCH_NOT_READY');
    }
    if (!actor || actor.world_id !== conversation.world_id
      || actor.adapter_id !== context.adapterId
      || actor.actor?.entity_id !== context.actorEntityId
      || actor.actor?.status === 'destroyed') {
      throw new Error('MEMORY_DISPATCH_NOT_READY');
    }
    return conversation.world_id;
  }

  function readCoreEvidence(request) {
    const worldId = resolveScope(request);
    if (!Array.isArray(request.sources) || request.sources.length < 1 || request.sources.length > 50) {
      throw new Error('MEMORY_DISPATCH_NOT_READY');
    }
    const expected = request.sources.map((source) => {
      if (!source || typeof source !== 'object' || Array.isArray(source)
        || Object.keys(source).some((key) => !['source_kind', 'source_entity_id', 'source_version'].includes(key))
        || source.source_kind !== 'canonical_entity'
        || typeof source.source_entity_id !== 'string' || !source.source_entity_id.trim()
        || typeof source.source_version !== 'string' || !source.source_version.trim()) {
        throw new Error('MEMORY_DISPATCH_NOT_READY');
      }
      return Object.freeze({
        source_kind: 'canonical_entity',
        source_entity_id: source.source_entity_id,
        source_version: source.source_version,
      });
    });
    const ids = [...new Set(expected.map((source) => source.source_entity_id))];
    if (ids.length !== expected.length) throw new Error('MEMORY_DISPATCH_NOT_READY');

    let snapshot;
    try {
      snapshot = engine.getSnapshot(worldId, { entityIds: ids, includeSourceVersions: true });
    } catch {
      throw new Error('MEMORY_DISPATCH_NOT_READY');
    }
    if (!snapshot || typeof snapshot !== 'object' || typeof snapshot.then === 'function'
      || snapshot.world_id !== worldId || !Array.isArray(snapshot.entities)
      || !Number.isSafeInteger(snapshot.world_revision) || snapshot.world_revision < 0
      || !Number.isSafeInteger(snapshot.commit_sequence) || snapshot.commit_sequence < 0) {
      throw new Error('MEMORY_DISPATCH_NOT_READY');
    }
    const byId = new Map(snapshot.entities.map((entity) => [entity.entity_id, entity]));
    if (byId.size !== ids.length || ids.some((id) => !byId.has(id))) {
      throw new Error('MEMORY_DISPATCH_NOT_READY');
    }
    for (const source of expected) {
      const entity = byId.get(source.source_entity_id);
      if (!entity || entity.status !== 'active'
        || canonicalEntitySourceVersion(entity) !== source.source_version) {
        throw new Error('MEMORY_DISPATCH_NOT_READY');
      }
    }

    const inventory = hostVersionDigestLedger.getInventoryState(worldId, context.conversationId);
    if (!inventory || inventory.status !== 'READY' || inventory.failure_code != null) {
      throw new Error('MEMORY_DISPATCH_NOT_READY');
    }

    const localHead = engine.store.db.prepare(
      'SELECT head,enrolled FROM accepted_head_state WHERE singleton=1',
    ).get();
    if (!localHead || localHead.enrolled !== 1
      || !Number.isSafeInteger(localHead.head) || localHead.head < 1) {
      throw new Error('MEMORY_DISPATCH_NOT_READY');
    }

    // Re-read binding, actor and source projection after all evidence reads.
    const confirmedWorld = resolveScope(request);
    if (confirmedWorld !== worldId) throw new Error('MEMORY_DISPATCH_NOT_READY');
    let current;
    try {
      current = engine.getSnapshot(worldId, { entityIds: ids, includeSourceVersions: true });
    } catch {
      throw new Error('MEMORY_DISPATCH_NOT_READY');
    }
    if (!current || typeof current.then === 'function'
      || current.world_revision !== snapshot.world_revision
      || current.commit_sequence !== snapshot.commit_sequence) {
      throw new Error('MEMORY_DISPATCH_NOT_READY');
    }
    const currentById = new Map(current.entities.map((entity) => [entity.entity_id, entity]));
    if (currentById.size !== byId.size || expected.some((source) => {
      const entity = currentById.get(source.source_entity_id);
      return !entity || entity.status !== 'active'
        || canonicalEntitySourceVersion(entity) !== source.source_version;
    })) {
      throw new Error('MEMORY_DISPATCH_NOT_READY');
    }
    const latestInventory = hostVersionDigestLedger.getInventoryState(worldId, context.conversationId);
    const latestHead = engine.store.db.prepare(
      'SELECT head,enrolled FROM accepted_head_state WHERE singleton=1',
    ).get();
    if (!latestInventory || latestInventory.status !== 'READY' || latestInventory.failure_code != null
      || !latestHead || latestHead.enrolled !== 1 || latestHead.head !== localHead.head) {
      throw new Error('MEMORY_DISPATCH_NOT_READY');
    }

    return Object.freeze({
      head: localHead.head,
      world_id: worldId,
      actor_id: context.actorEntityId,
      readiness: 'READY',
      inventory_status: 'READY',
      sources: Object.freeze(expected),
    });
  }

  function readProviderEvidence(request) {
    const worldId = resolveScope(request);
    let evidence;
    try {
      evidence = memoryProvider.readDispatchEvidence({
        world_id: worldId,
        subject_id: context.actorEntityId,
        purpose: request.purpose,
        candidates: request.candidates,
      });
    } catch {
      throw new Error('MEMORY_DISPATCH_NOT_READY');
    }
    if (!evidence || typeof evidence.then === 'function'
      || evidence.world_id !== worldId || evidence.actor_id !== context.actorEntityId
      || evidence.purpose !== request.purpose || evidence.readiness !== 'READY'
      || evidence.granted !== true || !Number.isSafeInteger(evidence.head)
      || !Array.isArray(evidence.sources)) {
      throw new Error('MEMORY_DISPATCH_NOT_READY');
    }
    return evidence;
  }

  return Object.freeze({ readCoreEvidence, readProviderEvidence });
}
