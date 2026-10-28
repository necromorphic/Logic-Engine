import { EngineError, assert } from '../core/errors.js';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = (value) => typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= 200;
const PURPOSES = new Set(['npc_decision', 'character_card', 'narrative']);
const RECIPIENTS = new Set(['model', 'player', 'adapter']);

const unavailable = () => new EngineError(
  'READ_NOT_AVAILABLE',
  'The requested read is not available.',
  404,
);

const stale = () => new EngineError(
  'STALE_INITIAL_KNOWLEDGE_SNAPSHOT',
  'Initial knowledge snapshot is stale.',
  409,
);

const cursor = (snapshot) => ({
  world_revision: snapshot.world_revision,
  commit_sequence: snapshot.commit_sequence,
});

const sameCursor = (left, right) => left.world_revision === right.world_revision
  && left.commit_sequence === right.commit_sequence;

const acquisitionsFor = (events, subjectId) => events.flatMap((event) => {
  if (event.validity !== 'valid' || !Array.isArray(event.effects)) return [];
  return event.effects.filter((effect) => effect?.kind === 'knowledge.acquire'
    && effect.subject_id === subjectId).map((effect) => ({
    event_id: event.event_id,
    event_validity: event.validity,
    committed_revision: event.committed_revision,
    commit_sequence: event.commit_sequence,
    subject_id: effect.subject_id,
    fact_id: effect.fact_id,
    acquisition_kind: effect.acquisition_kind,
    source_ref: effect.source_ref,
    source_sha256: effect.source_sha256,
    authority: effect.authority,
  }));
});

const sameAcquisitions = (left, right) => JSON.stringify(left) === JSON.stringify(right);

/**
 * Internal, read-only projection of a subject's explicitly assigned initial
 * knowledge. This is deliberately not an HTTP route or a Memory/NPC consumer.
 *
 * The trusted policy must explicitly approve the complete fact for the actor,
 * recipient and purpose. Missing, throwing, or non-true decisions withhold it.
 * No default visibility is inferred from acquisition kind or provenance.
 */
export class InitialKnowledgeReadService {
  constructor(engine, actorBindingService, knowledgePolicy) {
    if (typeof engine?.getSnapshot !== 'function' || typeof engine?.getEvents !== 'function') {
      throw new TypeError('InitialKnowledgeReadService requires a LogicEngine');
    }
    if (typeof actorBindingService?.resolve !== 'function') {
      throw new TypeError('InitialKnowledgeReadService requires an ActorBindingService');
    }
    if (typeof knowledgePolicy !== 'function') {
      throw new TypeError('InitialKnowledgeReadService requires an explicit trusted knowledge policy');
    }
    this.engine = engine;
    this.actorBindingService = actorBindingService;
    this.knowledgePolicy = knowledgePolicy;
  }

  read(request) {
    assert(object(request), 'INVALID_INITIAL_KNOWLEDGE_READ', 'Read request must be an object.');
    const allowed = new Set([
      'worldId', 'adapterId', 'actorEntityId', 'recipient', 'purpose',
      'expectedWorldRevision', 'expectedCommitSequence',
    ]);
    assert(Object.keys(request).every((key) => allowed.has(key)),
      'INVALID_INITIAL_KNOWLEDGE_READ', 'Read request contains unsupported fields.');
    assert(validId(request.worldId) && validId(request.adapterId) && validId(request.actorEntityId),
      'INVALID_INITIAL_KNOWLEDGE_READ', 'World, adapter, and actor IDs are required.');
    assert(RECIPIENTS.has(request.recipient), 'INVALID_READ_RECIPIENT', 'Unsupported read recipient.');
    assert(PURPOSES.has(request.purpose), 'INVALID_READ_PURPOSE', 'Unsupported read purpose.');
    assert(Number.isSafeInteger(request.expectedWorldRevision) && request.expectedWorldRevision >= 0
      && Number.isSafeInteger(request.expectedCommitSequence) && request.expectedCommitSequence >= 0,
    'INVALID_AUTHORIZED_READ_SNAPSHOT', 'Expected world revision and commit sequence are required.');

    let binding;
    try {
      binding = this.actorBindingService.resolve(request.worldId, request.adapterId, request.actorEntityId);
    } catch {
      throw unavailable();
    }
    if (binding.world_id !== request.worldId || binding.adapter_id !== request.adapterId
      || binding.actor?.entity_id !== request.actorEntityId) throw unavailable();

    // Read the journal, snapshot the actor plus every referenced fact, then
    // re-read both. The composite cursor catches ordinary commits and rollbacks
    // (which may advance world_revision without advancing commit_sequence).
    const firstEvents = this.engine.getEvents(request.worldId, true);
    const firstAcquisitions = acquisitionsFor(firstEvents, request.actorEntityId);
    const factIds = [...new Set(firstAcquisitions.map((item) => item.fact_id))];
    if (factIds.length > 200) throw unavailable();

    let snapshot;
    try {
      snapshot = this.engine.getSnapshot(request.worldId, {
        entityIds: [request.actorEntityId],
        factIds,
      });
    } catch {
      throw unavailable();
    }
    if (snapshot.world_revision !== request.expectedWorldRevision
      || snapshot.commit_sequence !== request.expectedCommitSequence) throw stale();
    if (snapshot.entities.length !== 1
      || snapshot.entities[0].entity_id !== request.actorEntityId
      || snapshot.entities[0].status === 'destroyed') throw unavailable();

    const secondEvents = this.engine.getEvents(request.worldId, true);
    const secondAcquisitions = acquisitionsFor(secondEvents, request.actorEntityId);
    if (!sameAcquisitions(firstAcquisitions, secondAcquisitions)) throw stale();

    let currentSnapshot;
    try {
      currentSnapshot = this.engine.getSnapshot(request.worldId, {
        entityIds: [request.actorEntityId],
        factIds,
      });
    } catch {
      throw unavailable();
    }
    if (!sameCursor(cursor(snapshot), cursor(currentSnapshot))) throw stale();
    if (currentSnapshot.entities.length !== 1
      || currentSnapshot.entities[0].entity_id !== request.actorEntityId
      || currentSnapshot.entities[0].status === 'destroyed') throw unavailable();

    const factsById = new Map(snapshot.facts.map((fact) => [fact.fact_id, fact]));
    const context = Object.freeze({
      worldId: request.worldId,
      authenticatedAdapterId: binding.adapter_id,
      actor: Object.freeze({ ...binding.actor }),
      recipient: request.recipient,
      purpose: request.purpose,
      worldRevision: snapshot.world_revision,
      commitSequence: snapshot.commit_sequence,
    });

    const disclosed = [];
    for (const acquisition of firstAcquisitions) {
      const fact = factsById.get(acquisition.fact_id);
      // Missing, conflicted, or otherwise non-active canonical facts are not
      // serialized. Acquisition records never override canonical truth status.
      if (!fact || fact.status !== 'active') continue;
      let permitted = false;
      try {
        permitted = this.knowledgePolicy(
          context,
          Object.freeze(structuredClone(acquisition)),
          Object.freeze(structuredClone(fact)),
        ) === true;
      } catch {
        permitted = false;
      }
      if (!permitted) continue;
      disclosed.push({
        fact_id: fact.fact_id,
        subject_ref: fact.subject_ref,
        predicate: fact.predicate,
        value: fact.value,
      });
    }

    // Revalidate identity and cursor after policy evaluation, since a trusted
    // callback can still trigger synchronous in-process mutations.
    try {
      const currentBinding = this.actorBindingService.resolve(
        request.worldId, request.adapterId, request.actorEntityId,
      );
      if (currentBinding.world_id !== request.worldId
        || currentBinding.adapter_id !== request.adapterId
        || currentBinding.actor?.entity_id !== request.actorEntityId) throw unavailable();
    } catch {
      throw unavailable();
    }
    let finalSnapshot;
    try {
      finalSnapshot = this.engine.getSnapshot(request.worldId, {
        entityIds: [request.actorEntityId],
        factIds,
      });
    } catch {
      throw unavailable();
    }
    if (!sameCursor(cursor(snapshot), cursor(finalSnapshot))) throw stale();
    if (finalSnapshot.entities.length !== 1
      || finalSnapshot.entities[0].entity_id !== request.actorEntityId
      || finalSnapshot.entities[0].status === 'destroyed') throw unavailable();

    return Object.freeze({
      world_id: request.worldId,
      world_revision: snapshot.world_revision,
      commit_sequence: snapshot.commit_sequence,
      facts: disclosed,
    });
  }
}
