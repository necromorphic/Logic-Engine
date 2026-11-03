import { isDeepStrictEqual, types as utilTypes } from 'node:util';
import { createNpcGenerationContextBuilder, createNpcGenerationContextReceiver } from './npc-generation-context.js';

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

function validId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 200
    && value === value.trim()
    && ![...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}

function validSnapshot(value) {
  return value && typeof value === 'object'
    && Number.isSafeInteger(value.world_revision) && value.world_revision >= 0
    && Number.isSafeInteger(value.commit_sequence) && value.commit_sequence >= 0;
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

  function readLaneA(input) {
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
    const read = engine.readNpcKnowledge({
      world_id: trustedScope.world_id,
      actor_id: trustedScope.actor_id,
      conversation_id: trustedScope.conversation_id,
      adapter_id: adapterId,
      recipient: RECIPIENT,
      purpose: PURPOSE,
      expected_revision: expectedRevision,
      expected_commit_sequence: expectedCommitSequence,
      limit: 200,
    });
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

  async function readLaneB(input) {
    let trustedScope;
    try { trustedScope = resolveScope(); } catch { return Object.freeze({ status: 'non_ready', lane: 'B' }); }
    if (input?.conversation_id !== trustedScope.conversation_id) {
      return Object.freeze({ status: 'non_ready', lane: 'B' });
    }
    const result = await consumer.retrieveForNpc({ conversationId: trustedScope.conversation_id });
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
    if (freshA.status !== 'ready' || !isDeepStrictEqual(freshA, envelopes.laneA)) return false;
    let freshB;
    try {
      freshB = await consumer.revalidateForFinalDispatch(
        { conversationId: scope.conversation_id },
        envelopes.laneB.result,
      );
    } catch { return false; }
    return freshB?.status === 'ready'
      && isDeepStrictEqual(freshB, envelopes.laneB.result);
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
    const preparedResult = laneBContext ? {
      status: laneBContext.status,
      admitted: laneBContext.admitted,
      candidates: laneBContext.candidates,
      reason: laneBContext.reason,
      snapshot: laneBContext.snapshot,
    } : null;
    if (preparedResult === null) return false;
    let freshB;
    try {
      freshB = await consumer.revalidateForFinalDispatch(
        { conversationId: scope.conversation_id },
        preparedResult,
      );
    } catch { return false; }
    return freshB?.status === 'ready'
      && JSON.stringify(freshB) === JSON.stringify(preparedResult)
      && freshB.snapshot?.world_revision === context.snapshot.world_revision
      && freshB.snapshot?.commit_sequence === context.snapshot.commit_sequence;
  }

  const builder = createNpcGenerationContextBuilder({
    resolveScope,
    readLaneA,
    readLaneB,
    revalidateEvidence: revalidateBuild,
    revalidateScope: resolveScope,
  });
  const receiver = createNpcGenerationContextReceiver({
    resolveScope,
    revalidateEvidence: revalidateIssuedContext,
    revalidateScope: resolveScope,
  });
  return Object.freeze({
    build: builder.build,
    receive: receiver.receive,
  });
}
