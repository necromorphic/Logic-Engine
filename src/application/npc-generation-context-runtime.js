import { types as utilTypes } from 'node:util';
import { createNpcGenerationContextBuilder } from './npc-generation-context.js';

const PURPOSE = 'npc_turn_context';
const RECIPIENT = 'model';
const VISIBILITY_POLICY_REF = 'core:npc-per-acquisition-visibility-v1';

function exactDataRecord(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const ownKeys = Reflect.ownKeys(value);
    return ownKeys.length === keys.length
      && ownKeys.every(key => typeof key === 'string' && keys.includes(key))
      && keys.every(key => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
      });
  } catch { return false; }
}

function densePlainArray(value) {
  if (!Array.isArray(value) || utilTypes.isProxy(value)) return false;
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) return false;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 || !keys.includes('length')) return false;
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return false;
    }
    return true;
  } catch { return false; }
}

function toPlainData(value, depth = 0) {
  if (depth > 32) throw new TypeError('prepared Memory result exceeds the supported depth');
  if (value === null || typeof value !== 'object') return value;
  if (utilTypes.isProxy(value)) throw new TypeError('prepared Memory result contains a Proxy');
  if (Array.isArray(value)) {
    if (!densePlainArray(value)) throw new TypeError('prepared Memory result contains a malformed array');
    const copy = new Array(value.length);
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      copy[index] = toPlainData(descriptor.value, depth + 1);
    }
    return copy;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('prepared Memory result contains a non-plain object');
  }
  const keys = Reflect.ownKeys(value);
  const copy = {};
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (typeof key !== 'string') throw new TypeError('prepared Memory result contains a symbol key');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('prepared Memory result contains an accessor or hidden field');
    }
    Object.defineProperty(copy, key, {
      value: toPlainData(descriptor.value, depth + 1),
      enumerable: true, writable: true, configurable: true,
    });
  }
  return copy;
}

function validId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 200
    && value === value.trim()
    && ![...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}

function validateRequest(request) {
  return exactDataRecord(request, ['request_id', 'generation_id', 'generation_type'])
    && validId(request.request_id)
    && validId(request.generation_id)
    && typeof request.generation_type === 'string'
    && /^[a-z][a-z0-9_-]{0,31}$/.test(request.generation_type);
}

function validSnapshot(value) {
  return value && typeof value === 'object'
    && Number.isSafeInteger(value.world_revision) && value.world_revision >= 0
    && Number.isSafeInteger(value.commit_sequence) && value.commit_sequence >= 0;
}

function validSourceVersion(value) {
  return typeof value === 'string' && /^core-entity-v1:[1-9][0-9]*$/.test(value);
}

function stripCanonicalSourceLineage(result) {
  if (!result || result.status !== 'ready' || !Array.isArray(result.candidates)) return null;
  return {
    status: result.status,
    admitted: result.admitted,
    candidates: result.candidates.map(candidate => {
      const { source_kind, source_version, ...providerCandidate } = candidate;
      return providerCandidate;
    }),
    reason: result.reason,
    snapshot: result.snapshot,
    provider_evidence_cursor: result.provider_evidence_cursor,
  };
}

/**
 * Compose the generic builder with the live Core reader and the adapter-pinned
 * MemoryNpcConsumer. resolveAuthenticatedScope must derive identity from the
 * branded Host assertion context and independently re-resolve active Core
 * conversation/actor bindings; it must never use caller-supplied identity.
 */
export function createCoreNpcGenerationContextRuntime({
  engine, consumer, adapterId, resolveAuthenticatedScope,
}) {
  if (typeof engine?.readNpcKnowledge !== 'function'
    || typeof engine?.getSnapshot !== 'function'
    || typeof engine?.npcKnowledgeVisibilityAuthorizer !== 'function'
    || typeof consumer?.retrieveForNpc !== 'function'
    || typeof consumer?.revalidateForFinalDispatch !== 'function'
    || !validId(adapterId) || typeof resolveAuthenticatedScope !== 'function') {
    throw new TypeError('NPC generation runtime requires the live Core reader, visibility authorizer, pinned Memory consumer and authenticated scope resolver.');
  }

  function resolveScope() {
    const scope = resolveAuthenticatedScope();
    if (!exactDataRecord(scope, [
      'world_id', 'actor_id', 'conversation_id', 'adapter_id', 'recipient', 'purpose', 'snapshot',
    ]) || !validId(scope.world_id) || !validId(scope.actor_id)
      || !validId(scope.conversation_id) || scope.adapter_id !== adapterId
      || scope.recipient !== RECIPIENT || scope.purpose !== PURPOSE
      || !exactDataRecord(scope.snapshot, ['world_revision', 'commit_sequence'])
      || !validSnapshot(scope.snapshot)) {
      throw new Error('NPC_AUTHENTICATED_SCOPE_UNAVAILABLE');
    }
    return Object.freeze({
      world_id: scope.world_id,
      actor_id: scope.actor_id,
      conversation_id: scope.conversation_id,
      adapter_id: adapterId,
      recipient: RECIPIENT,
      purpose: PURPOSE,
      snapshot: Object.freeze({
        world_revision: scope.snapshot.world_revision,
        commit_sequence: scope.snapshot.commit_sequence,
      }),
    });
  }

  function readLaneA(input, coordinatorLease = null) {
    let trustedScope;
    try { trustedScope = resolveScope(); } catch { return Object.freeze({ status: 'non_ready', lane: 'A' }); }
    const expectedRevision = input?.snapshot?.world_revision ?? input?.expected_revision;
    const expectedCommitSequence = input?.snapshot?.commit_sequence ?? input?.expected_commit_sequence;
    if (input?.world_id !== trustedScope.world_id || input?.actor_id !== trustedScope.actor_id
      || input?.conversation_id !== trustedScope.conversation_id || input?.adapter_id !== adapterId
      || input?.recipient !== RECIPIENT || input?.purpose !== PURPOSE
      || expectedRevision !== trustedScope.snapshot.world_revision
      || expectedCommitSequence !== trustedScope.snapshot.commit_sequence) {
      return Object.freeze({ status: 'non_ready', lane: 'A' });
    }
    const readInput = {
      world_id: trustedScope.world_id,
      actor_id: trustedScope.actor_id,
      conversation_id: trustedScope.conversation_id,
      adapter_id: adapterId,
      recipient: RECIPIENT,
      purpose: PURPOSE,
      expected_revision: expectedRevision,
      expected_commit_sequence: expectedCommitSequence,
      limit: 200,
    };
    const read = coordinatorLease
      ? engine.readNpcKnowledgeUnderCoordinatorLease(readInput, coordinatorLease)
      : engine.readNpcKnowledge(readInput);
    if (!exactDataRecord(read, [
      'status', 'world_id', 'conversation_id', 'adapter_id', 'actor_id', 'recipient',
      'purpose', 'snapshot', 'authorization_ref', 'truncated', 'items',
    ]) || read.status !== 'ready' || read.truncated !== false
      || read.world_id !== trustedScope.world_id || read.actor_id !== trustedScope.actor_id
      || read.conversation_id !== trustedScope.conversation_id || read.adapter_id !== adapterId
      || read.recipient !== RECIPIENT || read.purpose !== PURPOSE
      || !validSnapshot(read.snapshot)
      || read.snapshot.world_revision !== expectedRevision
      || read.snapshot.commit_sequence !== expectedCommitSequence
      || !validId(read.authorization_ref) || !densePlainArray(read.items)) {
      return Object.freeze({ status: 'non_ready', lane: 'A' });
    }

    const visible = [];
    const itemKeys = [
      'acquisition_id', 'fact_id', 'subject_ref', 'predicate', 'value',
      'acquisition_kind', 'provenance_ref', 'provenance_digest',
      'acquisition_authorization_ref', 'source_event_ids',
    ];
    for (let index = 0; index < read.items.length; index += 1) {
      const itemDescriptor = Object.getOwnPropertyDescriptor(read.items, String(index));
      if (!itemDescriptor || !Object.hasOwn(itemDescriptor, 'value')) {
        return Object.freeze({ status: 'non_ready', lane: 'A' });
      }
      const item = itemDescriptor.value;
      if (!exactDataRecord(item, itemKeys)) {
        return Object.freeze({ status: 'non_ready', lane: 'A' });
      }
      let decision;
      try {
        decision = engine.npcKnowledgeVisibilityAuthorizer(Object.freeze({
          world_id: read.world_id,
          conversation_id: read.conversation_id,
          adapter_id: read.adapter_id,
          actor_id: read.actor_id,
          recipient: read.recipient,
          purpose: read.purpose,
          world_revision: read.snapshot.world_revision,
          commit_sequence: read.snapshot.commit_sequence,
          acquisition_id: item.acquisition_id,
          fact_id: item.fact_id,
          subject_ref: item.subject_ref,
          predicate: item.predicate,
          acquisition_kind: item.acquisition_kind,
          acquisition_authorization_ref: item.acquisition_authorization_ref,
          provenance_ref: item.provenance_ref,
          provenance_digest: item.provenance_digest,
        }));
      } catch {
        return Object.freeze({ status: 'non_ready', lane: 'A' });
      }
      const decisionKeys = [
        'status', 'world_id', 'conversation_id', 'adapter_id', 'actor_id', 'recipient',
        'purpose', 'world_revision', 'commit_sequence', 'acquisition_id', 'authorization_ref',
      ];
      if (!exactDataRecord(decision, decisionKeys)
        || !['allowed', 'denied'].includes(decision.status)
        || decision.world_id !== trustedScope.world_id
        || decision.conversation_id !== trustedScope.conversation_id
        || decision.adapter_id !== adapterId || decision.actor_id !== trustedScope.actor_id
        || decision.recipient !== RECIPIENT || decision.purpose !== PURPOSE
        || decision.world_revision !== expectedRevision
        || decision.commit_sequence !== expectedCommitSequence
        || decision.acquisition_id !== item.acquisition_id
        || !validId(decision.authorization_ref)) {
        return Object.freeze({ status: 'non_ready', lane: 'A' });
      }
      // A denied acquisition is withheld without revealing its value, identity,
      // count, or proposition. An allowed acquisition retains its own decision ref.
      if (decision.status === 'denied') continue;
      visible[visible.length] = Object.freeze({
        ...item,
        visibility_authorization_ref: decision.authorization_ref,
      });
    }

    const snapshot = Object.freeze({
      world_revision: read.snapshot.world_revision,
      commit_sequence: read.snapshot.commit_sequence,
    });
    return Object.freeze({
      status: 'ready',
      lane: 'A',
      world_id: trustedScope.world_id,
      actor_id: trustedScope.actor_id,
      conversation_id: trustedScope.conversation_id,
      adapter_id: adapterId,
      recipient: RECIPIENT,
      purpose: PURPOSE,
      snapshot,
      completeness: 'complete',
      read_authorization_ref: read.authorization_ref,
      visibility_authorization_ref: VISIBILITY_POLICY_REF,
      items: Object.freeze(visible),
    });
  }

  function attachCanonicalSourceLineage(result, trustedScope) {
    if (!result || result.status !== 'ready' || !validSnapshot(result.snapshot)
      || !Array.isArray(result.candidates) || result.candidates.length > 50) return null;
    if (result.candidates.length === 0) return result;
    const entityIds = [];
    const seen = new Set();
    if (!densePlainArray(result.candidates)) return null;
    for (let index = 0; index < result.candidates.length; index += 1) {
      const candidate = result.candidates[index];
      if (!exactDataRecord(candidate, [
        'record_ref', 'record_version', 'authorization_generation',
        'source_entity_id', 'epistemic_kind', 'evidence_assessment', 'content',
      ]) || !validId(candidate.source_entity_id)) return null;
      if (!seen.has(candidate.source_entity_id)) {
        seen.add(candidate.source_entity_id);
        entityIds.push(candidate.source_entity_id);
      }
    }
    if (entityIds.length === 0 || entityIds.length > 50) return null;
    let snapshot;
    try {
      snapshot = engine.getSnapshot(trustedScope.world_id, {
        entityIds, includeSourceVersions: true,
      });
    } catch { return null; }
    if (!snapshot || snapshot.world_id !== trustedScope.world_id
      || snapshot.world_revision !== result.snapshot.world_revision
      || snapshot.commit_sequence !== result.snapshot.commit_sequence
      || !densePlainArray(snapshot.entities) || snapshot.entities.length !== entityIds.length) return null;
    const versions = new Map();
    for (let index = 0; index < snapshot.entities.length; index += 1) {
      const entity = snapshot.entities[index];
      if (!exactDataRecord(entity, [
        'entity_id', 'entity_type', 'status', 'attributes', 'created_by_event_id',
        'updated_revision', 'source_version',
      ]) || !validId(entity.entity_id) || !seen.has(entity.entity_id)
        || versions.has(entity.entity_id) || entity.status !== 'active'
        || !validSourceVersion(entity.source_version)) return null;
      versions.set(entity.entity_id, entity.source_version);
    }
    if (versions.size !== entityIds.length) return null;
    return Object.freeze({
      ...result,
      candidates: Object.freeze(result.candidates.map(candidate => Object.freeze({
        ...candidate,
        source_kind: 'canonical_entity',
        source_version: versions.get(candidate.source_entity_id),
      }))),
    });
  }

  async function readLaneB(input) {
    let trustedScope;
    try { trustedScope = resolveScope(); } catch { return Object.freeze({ status: 'non_ready', lane: 'B' }); }
    if (input?.conversation_id !== trustedScope.conversation_id) {
      return Object.freeze({ status: 'non_ready', lane: 'B' });
    }
    let result;
    try {
      result = await consumer.retrieveForNpc({ conversationId: trustedScope.conversation_id });
      result = attachCanonicalSourceLineage(result, trustedScope);
    } catch { result = null; }
    if (!result || result.status !== 'ready' || !validSnapshot(result.snapshot)) {
      return Object.freeze({ status: 'non_ready', lane: 'B' });
    }
    return Object.freeze({
      status: 'ready',
      lane: 'B',
      world_id: trustedScope.world_id,
      actor_id: trustedScope.actor_id,
      conversation_id: trustedScope.conversation_id,
      adapter_id: adapterId,
      recipient: RECIPIENT,
      core_purpose: PURPOSE,
      provider_purpose: 'npc_decision',
      snapshot: Object.freeze({
        world_revision: result.snapshot.world_revision,
        commit_sequence: result.snapshot.commit_sequence,
      }),
      result,
    });
  }

  async function revalidateBuild(scope, envelopes) {
    const freshA = readLaneA(scope);
    if (freshA.status !== 'ready' || JSON.stringify(freshA) !== JSON.stringify(envelopes.laneA)) return false;
    let freshB;
    try {
      const providerResult = stripCanonicalSourceLineage(envelopes.laneB.result);
      if (!providerResult) return false;
      freshB = await consumer.revalidateForFinalDispatch(
        { conversationId: scope.conversation_id },
        providerResult,
      );
      freshB = attachCanonicalSourceLineage(freshB, scope);
    } catch { return false; }
    // Lane B revalidation is asynchronous. Re-read Lane A after that await so
    // a visibility revoke during the Provider/Core checks cannot survive the
    // build fence merely because the earlier Lane A read was still allowed.
    const finalA = readLaneA(scope);
    return freshB?.status === 'ready'
      && JSON.stringify(freshB) === JSON.stringify(envelopes.laneB.result)
      && finalA.status === 'ready'
      && JSON.stringify(finalA) === JSON.stringify(envelopes.laneA);
  }

  async function revalidateIssuedContext(context) {
    let scope;
    try { scope = resolveScope(); } catch { return false; }
    const freshA = readLaneA(scope);
    const laneAContext = context?.lanes?.lane_a;
    if (freshA.status !== 'ready'
      || freshA.read_authorization_ref !== laneAContext?.authorization_ref
      || freshA.visibility_authorization_ref !== laneAContext?.visibility_authorization_ref
      || JSON.stringify(freshA.items) !== JSON.stringify(laneAContext?.items)
      || freshA.snapshot.world_revision !== context?.snapshot?.world_revision
      || freshA.snapshot.commit_sequence !== context?.snapshot?.commit_sequence) return false;
    const laneBContext = context?.lanes?.lane_b;
    // MemoryNpcConsumer uses Node's isDeepStrictEqual for its final
    // freshness comparison. Rebuild the immutable null-prototype payload as
    // ordinary plain data so the comparison checks content, not our internal
    // immutability representation.
    const preparedResult = laneBContext ? {
      status: laneBContext.status,
      admitted: toPlainData(laneBContext.admitted),
      candidates: toPlainData(laneBContext.candidates),
      reason: laneBContext.reason,
      snapshot: toPlainData(laneBContext.snapshot),
    } : null;
    if (preparedResult === null) return false;
    let freshB;
    try {
      const providerResult = stripCanonicalSourceLineage(toPlainData(preparedResult));
      if (!providerResult) return false;
      freshB = await consumer.revalidateForFinalDispatch(
        { conversationId: scope.conversation_id },
        providerResult,
      );
      freshB = attachCanonicalSourceLineage(freshB, scope);
    } catch { return false; }
    // Revalidate Lane A again after the asynchronous Lane B check. The
    // dispatch-start Gateway must still serialize this with durable revoke
    // ordering; this second read closes the avoidable inter-lane await gap.
    const finalA = readLaneA(scope);
    return freshB?.status === 'ready'
      && JSON.stringify(freshB) === JSON.stringify(preparedResult)
      && freshB.snapshot?.world_revision === context.snapshot.world_revision
      && freshB.snapshot?.commit_sequence === context.snapshot.commit_sequence
      && finalA.status === 'ready'
      && finalA.read_authorization_ref === laneAContext?.authorization_ref
      && finalA.visibility_authorization_ref === laneAContext?.visibility_authorization_ref
      && JSON.stringify(finalA.items) === JSON.stringify(laneAContext?.items)
      && finalA.snapshot.world_revision === context.snapshot.world_revision
      && finalA.snapshot.commit_sequence === context.snapshot.commit_sequence;
  }

  const builder = createNpcGenerationContextBuilder({
    resolveScope,
    readLaneA,
    readLaneB,
    revalidateEvidence: revalidateBuild,
    revalidateScope: resolveScope,
  });
  const receiver = builder.createReceiver({
    resolveScope,
    revalidateEvidence: revalidateIssuedContext,
    revalidateScope: resolveScope,
  });
  const dispatchableContexts = new WeakMap();

  function consumeDispatchHandoff(handoff, request) {
    const result = receiver.consumeDispatchHandoff(handoff, request);
    if (result.status === 'accepted') dispatchableContexts.set(result.context, request);
    return result;
  }

  // Synchronous Lane A fence for the Gateway's shared-Coordinator critical
  // section. Lane B admission/grant/source freshness remains the Gateway's
  // independent synchronous Provider responsibility.
  function revalidateLaneAForDispatch(context, request, coordinatorLease = null) {
    if (!context || typeof context !== 'object' || dispatchableContexts.get(context) !== request
      || !request || context.request_id !== request.request_id
      || context.generation_id !== request.generation_id
      || context.generation_type !== request.generation_type
      || context.purpose !== PURPOSE || context.recipient !== RECIPIENT) {
      return Object.freeze({ status: 'non_ready', reason: 'dispatch_context_mismatch' });
    }
    let scope;
    try { scope = resolveScope(); } catch {
      return Object.freeze({ status: 'non_ready', reason: 'dispatch_scope_unavailable' });
    }
    if (scope.world_id !== context.world_id || scope.actor_id !== context.actor_id
      || scope.conversation_id !== context.conversation_id || scope.adapter_id !== context.adapter_id
      || scope.purpose !== context.purpose || scope.recipient !== context.recipient
      || scope.snapshot.world_revision !== context.snapshot.world_revision
      || scope.snapshot.commit_sequence !== context.snapshot.commit_sequence) {
      return Object.freeze({ status: 'non_ready', reason: 'dispatch_scope_changed' });
    }
    let freshA;
    try {
      freshA = readLaneA({
        world_id: scope.world_id, actor_id: scope.actor_id,
        conversation_id: scope.conversation_id, adapter_id: scope.adapter_id,
        recipient: RECIPIENT, purpose: PURPOSE,
        expected_revision: scope.snapshot.world_revision,
        expected_commit_sequence: scope.snapshot.commit_sequence,
      }, coordinatorLease);
    } catch {
      return Object.freeze({ status: 'non_ready', reason: 'dispatch_lane_a_unavailable' });
    }
    const laneAContext = context.lanes?.lane_a;
    if (freshA.status !== 'ready'
      || freshA.read_authorization_ref !== laneAContext?.authorization_ref
      || freshA.visibility_authorization_ref !== laneAContext?.visibility_authorization_ref
      || JSON.stringify(freshA.items) !== JSON.stringify(laneAContext?.items)
      || freshA.snapshot.world_revision !== context.snapshot.world_revision
      || freshA.snapshot.commit_sequence !== context.snapshot.commit_sequence) {
      return Object.freeze({ status: 'non_ready', reason: 'dispatch_lane_a_changed' });
    }
    return Object.freeze({ status: 'ready', reason: null });
  }

  // Single preparation entry point for Host Final-Send prepare(). It keeps
  // the immutable context inside Core and returns only the opaque in-process
  // handoff; no Lane A/B payload is exposed to Host preparation code.
  async function prepareForDispatch(request) {
    const built = await builder.build(request);
    if (built?.status !== 'ready' || !built.context) {
      return Object.freeze({ status: 'non_ready', handoff: null, reason: built?.reason ?? 'context_build_not_ready' });
    }
    const accepted = await receiver.receive(built.context, request);
    if (accepted?.status !== 'accepted') {
      return Object.freeze({ status: 'non_ready', handoff: null, reason: accepted?.reason ?? 'context_receiver_not_ready' });
    }
    const issued = receiver.issueDispatchHandoff(accepted, request);
    if (issued?.status !== 'ready' || !issued.handoff) {
      return Object.freeze({ status: 'non_ready', handoff: null, reason: issued?.reason ?? 'dispatch_handoff_not_ready' });
    }
    return Object.freeze({ status: 'ready', handoff: issued.handoff, reason: null });
  }

  function getLaneBDispatchEvidence(context, request) {
    if (!context || typeof context !== 'object' || dispatchableContexts.get(context) !== request
      || !validateRequest(request)
      || context.request_id !== request.request_id
      || context.generation_id !== request.generation_id
      || context.generation_type !== request.generation_type
      || context.purpose !== PURPOSE || context.recipient !== RECIPIENT) {
      return Object.freeze({ status: 'non_ready', reason: 'dispatch_context_mismatch' });
    }
    const laneB = context.lanes?.lane_b;
    if (!laneB || laneB.status !== 'ready' || laneB.provider_purpose !== 'npc_decision'
      || laneB.core_purpose !== PURPOSE || !validSnapshot(laneB.snapshot)
      || laneB.snapshot.world_revision !== context.snapshot.world_revision
      || laneB.snapshot.commit_sequence !== context.snapshot.commit_sequence
      || !densePlainArray(laneB.candidates) || laneB.candidates.length > 50) {
      return Object.freeze({ status: 'non_ready', reason: 'dispatch_lane_b_unavailable' });
    }
    const candidates = [];
    const sourceMap = new Map();
    for (let index = 0; index < laneB.candidates.length; index += 1) {
      const candidate = laneB.candidates[index];
      if (!exactDataRecord(candidate, [
        'record_ref', 'record_version', 'authorization_generation',
        'source_kind', 'source_entity_id', 'source_version',
        'epistemic_kind', 'evidence_assessment', 'content',
      ]) || !validId(candidate.record_ref) || !validId(candidate.record_version)
        || !Number.isSafeInteger(candidate.authorization_generation) || candidate.authorization_generation < 1
        || candidate.source_kind !== 'canonical_entity' || !validId(candidate.source_entity_id)
        || !validSourceVersion(candidate.source_version)) {
        return Object.freeze({ status: 'non_ready', reason: 'dispatch_lane_b_lineage_invalid' });
      }
      const source = Object.freeze({
        source_kind: 'canonical_entity',
        source_entity_id: candidate.source_entity_id,
        source_version: candidate.source_version,
      });
      sourceMap.set(JSON.stringify([source.source_entity_id, source.source_version]), source);
      candidates.push(Object.freeze({
        record_ref: candidate.record_ref,
        record_version: candidate.record_version,
        authorization_generation: candidate.authorization_generation,
        source_kind: candidate.source_kind,
        source_entity_id: candidate.source_entity_id,
        source_version: candidate.source_version,
      }));
    }
    const sources = [...sourceMap.values()].sort((left, right) =>
      left.source_entity_id < right.source_entity_id ? -1
        : left.source_entity_id > right.source_entity_id ? 1
          : left.source_version < right.source_version ? -1
            : left.source_version > right.source_version ? 1 : 0);
    return Object.freeze({
      status: 'ready',
      lane: 'B',
      world_id: context.world_id,
      actor_id: context.actor_id,
      conversation_id: context.conversation_id,
      adapter_id: context.adapter_id,
      core_purpose: PURPOSE,
      provider_purpose: 'npc_decision',
      snapshot: context.snapshot,
      sources: Object.freeze(sources),
      candidates: Object.freeze(candidates),
    });
  }

  return Object.freeze({
    build: builder.build,
    receive: receiver.receive,
    prepareForDispatch,
    issueDispatchHandoff: receiver.issueDispatchHandoff,
    consumeDispatchHandoff,
    getLaneBDispatchEvidence,
    revalidateLaneAForDispatch,
    revalidateLaneAForDispatchUnderCoordinatorLease: (context, request, lease) =>
      revalidateLaneAForDispatch(context, request, lease),
  });
}
