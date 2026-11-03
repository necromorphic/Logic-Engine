import { types as utilTypes } from 'node:util';

const ID_MAX = 200;
const PURPOSE = 'npc_turn_context';
const RECIPIENT = 'model';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = value => typeof value === 'string' && value.length > 0
  && value.length <= ID_MAX && value === value.trim()
  && ![...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
const validCursor = value => Number.isSafeInteger(value) && value >= 0;
const validSnapshot = value => object(value)
  && validCursor(value.world_revision) && validCursor(value.commit_sequence);
const sameSnapshot = (a, b) => validSnapshot(a) && validSnapshot(b)
  && a.world_revision === b.world_revision && a.commit_sequence === b.commit_sequence;

function plainDataRecord(value, required, allowed = required) {
  if (!object(value) || utilTypes.isProxy(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const keys = Reflect.ownKeys(value);
    if (keys.length < required.length) return false;
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (typeof key !== 'string' || !allowed.includes(key)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return false;
    }
    return required.every(key => Object.hasOwn(value, key));
  } catch { return false; }
}

function densePlainArray(value) {
  if (!Array.isArray(value) || utilTypes.isProxy(value)) return false;
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) return false;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 || !keys.includes('length')) return false;
    for (let i = 0; i < value.length; i += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return false;
    }
    return true;
  } catch { return false; }
}

function exactRecord(value, keys) {
  return plainDataRecord(value, keys, keys) && Reflect.ownKeys(value).length === keys.length;
}

function immutableCopy(value, depth = 0, seen = new WeakSet()) {
  if (depth > 32) throw new TypeError('context value exceeds maximum depth');
  if (value === null || ['string', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || utilTypes.isProxy(value) || seen.has(value)) {
    throw new TypeError('context contains unsupported data');
  }
  seen.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) throw new TypeError('context array is not ordinary');
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 || !keys.includes('length')) throw new TypeError('context array is sparse or extended');
    const copy = [];
    for (let i = 0; i < value.length; i += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('context array contains an accessor');
      copy.push(immutableCopy(descriptor.value, depth + 1, seen));
    }
    seen.delete(value);
    return Object.freeze(copy);
  }
  const keys = Reflect.ownKeys(value);
  if (!plainDataRecord(value, [], keys)) throw new TypeError('context object is not plain data');
  const copy = Object.create(null);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    copy[key] = immutableCopy(descriptor.value, depth + 1, seen);
  }
  seen.delete(value);
  return Object.freeze(copy);
}

function nonReady(reason) {
  return Object.freeze({ status: 'non_ready', context: null, reason });
}

function validateRequest(request) {
  if (!exactRecord(request, ['request_id', 'generation_id', 'generation_type'])) return false;
  return validId(request.request_id) && validId(request.generation_id)
    && typeof request.generation_type === 'string'
    && /^[a-z][a-z0-9_-]{0,31}$/.test(request.generation_type);
}

function validateScope(scope) {
  const keys = ['world_id', 'actor_id', 'conversation_id', 'adapter_id', 'recipient', 'purpose', 'snapshot'];
  return exactRecord(scope, keys)
    && validId(scope.world_id) && validId(scope.actor_id)
    && validId(scope.conversation_id) && validId(scope.adapter_id)
    && scope.recipient === RECIPIENT && scope.purpose === PURPOSE
    && exactRecord(scope.snapshot, ['world_revision', 'commit_sequence'])
    && validSnapshot(scope.snapshot);
}

function validateLaneA(envelope, scope) {
  const keys = ['status', 'lane', 'world_id', 'actor_id', 'conversation_id', 'adapter_id',
    'recipient', 'purpose', 'snapshot', 'completeness', 'read_authorization_ref',
    'visibility_authorization_ref', 'items'];
  if (!exactRecord(envelope, keys) || envelope.status !== 'ready' || envelope.lane !== 'A'
    || envelope.world_id !== scope.world_id || envelope.actor_id !== scope.actor_id
    || envelope.conversation_id !== scope.conversation_id || envelope.adapter_id !== scope.adapter_id
    || envelope.recipient !== RECIPIENT || envelope.purpose !== PURPOSE
    || envelope.completeness !== 'complete'
    || !validId(envelope.read_authorization_ref) || !validId(envelope.visibility_authorization_ref)
    || !exactRecord(envelope.snapshot, ['world_revision', 'commit_sequence'])
    || !sameSnapshot(envelope.snapshot, scope.snapshot) || !densePlainArray(envelope.items)) return false;
  try {
    const ids = new Set();
    for (let i = 0; i < envelope.items.length; i += 1) {
      const d = Object.getOwnPropertyDescriptor(envelope.items, String(i));
      if (!d || !Object.hasOwn(d, 'value')) return false;
      const item = d.value;
      const itemKeys = ['acquisition_id', 'fact_id', 'subject_ref', 'predicate', 'value',
        'acquisition_kind', 'provenance_ref', 'provenance_digest', 'acquisition_authorization_ref',
        'source_event_ids', 'visibility_authorization_ref'];
      if (!exactRecord(item, itemKeys) || !validId(item.acquisition_id) || ids.has(item.acquisition_id)
        || !validId(item.fact_id) || !validId(item.subject_ref) || !validId(item.predicate)
        || !validId(item.acquisition_kind) || !validId(item.provenance_ref)
        || !validId(item.acquisition_authorization_ref) || !validId(item.visibility_authorization_ref)
        || typeof item.provenance_digest !== 'string' || !/^[a-f0-9]{64}$/.test(item.provenance_digest)
        || !densePlainArray(item.source_event_ids) || item.source_event_ids.length === 0
        || immutableCopy(item.source_event_ids).some(id => !validId(id))) return false;
      ids.add(item.acquisition_id);
      immutableCopy(item.value);
    }
    return true;
  } catch { return false; }
}

function validateLaneB(envelope, scope) {
  const keys = ['status', 'lane', 'world_id', 'actor_id', 'conversation_id', 'adapter_id',
    'recipient', 'core_purpose', 'provider_purpose', 'snapshot', 'result'];
  if (!exactRecord(envelope, keys) || envelope.status !== 'ready' || envelope.lane !== 'B'
    || envelope.world_id !== scope.world_id || envelope.actor_id !== scope.actor_id
    || envelope.conversation_id !== scope.conversation_id || envelope.adapter_id !== scope.adapter_id
    || envelope.recipient !== RECIPIENT || envelope.core_purpose !== PURPOSE
    || envelope.provider_purpose !== 'npc_decision'
    || !exactRecord(envelope.snapshot, ['world_revision', 'commit_sequence'])
    || !sameSnapshot(envelope.snapshot, scope.snapshot)) return false;
  const result = envelope.result;
  if (!exactRecord(result, ['status', 'admitted', 'candidates', 'reason', 'snapshot'])
    || result.status !== 'ready' || result.reason !== null
    || !densePlainArray(result.admitted) || !densePlainArray(result.candidates)
    || !exactRecord(result.snapshot, ['world_revision', 'commit_sequence'])
    || !sameSnapshot(result.snapshot, scope.snapshot)
    || result.admitted.length !== result.candidates.length) return false;
  try {
    const identities = new Set();
    for (let i = 0; i < result.candidates.length; i += 1) {
      const candidate = result.candidates[i];
      const admitted = result.admitted[i];
      if (!exactRecord(candidate, ['record_ref', 'record_version', 'authorization_generation',
        'source_entity_id', 'source_version', 'epistemic_kind', 'evidence_assessment', 'content'])
        || !plainDataRecord(admitted, ['record_ref', 'record_version'], ['record_ref', 'record_version', 'epistemic_kind', 'evidence_assessment'])
        || !validId(candidate.record_ref) || !validId(candidate.record_version)
        || !Number.isSafeInteger(candidate.authorization_generation) || candidate.authorization_generation < 1
        || !validId(candidate.source_entity_id) || !validId(candidate.source_version)
        || !validId(candidate.epistemic_kind)
        || !['unassessed', 'supported', 'disputed', 'insufficient'].includes(candidate.evidence_assessment)
        || admitted.record_ref !== candidate.record_ref || admitted.record_version !== candidate.record_version) return false;
      const identity = JSON.stringify([candidate.record_ref, candidate.record_version]);
      if (identities.has(identity)) return false;
      identities.add(identity);
      immutableCopy(candidate.content);
    }
    return true;
  } catch { return false; }
}

/**
 * Core-composed builder. The callbacks are trusted application dependencies:
 * they resolve the authenticated Host scope, perform each lane's own Core
 * authorization, and return lane-specific verified envelopes. The caller can
 * supply correlation metadata only, never identity or evidence.
 */
export function createNpcGenerationContextBuilder({
  resolveScope, readLaneA, readLaneB, revalidateEvidence, revalidateScope,
}) {
  const dependencies = { resolveScope, readLaneA, readLaneB, revalidateEvidence, revalidateScope };
  const dependencyNames = Object.keys(dependencies);
  // Each builder owns its own issuance registry. A different adapter/runtime
  // must not be able to accept a context issued by this builder.
  const issuedContexts = new WeakMap();
  const consumedContexts = new WeakSet();
  const acceptedReceipts = new WeakMap();
  const consumedReceipts = new WeakSet();
  const dispatchHandoffs = new WeakMap();
  const consumedHandoffs = new WeakSet();
  for (let index = 0; index < dependencyNames.length; index += 1) {
    const name = dependencyNames[index];
    if (typeof dependencies[name] !== 'function') throw new TypeError(name + ' must be a trusted Core callback');
  }

  async function build(request) {
    if (!validateRequest(request)) return nonReady('invalid_generation_request');
    let scope;
    try { scope = await resolveScope(Object.freeze({ ...request })); } catch { return nonReady('trusted_scope_unavailable'); }
    if (!validateScope(scope)) return nonReady('trusted_scope_unavailable');

    let laneA;
    let laneB;
    try {
      laneA = await readLaneA(Object.freeze({
        world_id: scope.world_id, actor_id: scope.actor_id, conversation_id: scope.conversation_id,
        adapter_id: scope.adapter_id, recipient: RECIPIENT, purpose: PURPOSE,
        expected_revision: scope.snapshot.world_revision,
        expected_commit_sequence: scope.snapshot.commit_sequence, limit: 200,
      }));
    } catch { return nonReady('lane_a_evidence_unavailable'); }
    try {
      laneB = await readLaneB(Object.freeze({ conversation_id: scope.conversation_id }));
    } catch { return nonReady('lane_b_evidence_unavailable'); }

    if (!validateLaneA(laneA, scope)) return nonReady('lane_a_evidence_not_current_or_authorized');
    if (!validateLaneB(laneB, scope)) return nonReady('lane_b_evidence_not_current_or_authorized');

    let evidenceCurrent;
    try { evidenceCurrent = await revalidateEvidence(scope, Object.freeze({ laneA, laneB })); }
    catch { return nonReady('generation_evidence_changed'); }
    if (evidenceCurrent !== true) return nonReady('generation_evidence_changed');

    let current;
    try { current = await revalidateScope(scope); } catch { return nonReady('generation_scope_changed'); }
    if (!validateScope(current) || current.world_id !== scope.world_id || current.actor_id !== scope.actor_id
      || current.conversation_id !== scope.conversation_id || current.adapter_id !== scope.adapter_id
      || !sameSnapshot(current.snapshot, scope.snapshot)) return nonReady('generation_scope_changed');

    let lanes;
    try {
      lanes = Object.freeze({
        lane_a: immutableCopy({
          lane: 'A', purpose: PURPOSE,
          authorization_ref: laneA.read_authorization_ref,
          visibility_authorization_ref: laneA.visibility_authorization_ref,
          items: laneA.items,
        }),
        lane_b: immutableCopy({
          lane: 'B', core_purpose: PURPOSE, provider_purpose: 'npc_decision',
          status: laneB.result.status,
          admitted: laneB.result.admitted,
          candidates: laneB.result.candidates,
          reason: laneB.result.reason,
          snapshot: laneB.result.snapshot,
        }),
      });
    } catch { return nonReady('generation_context_invalid'); }

    const context = Object.freeze({
      schema: 'npc-generation-context/v1',
      request_id: request.request_id,
      generation_id: request.generation_id,
      generation_type: request.generation_type,
      world_id: scope.world_id,
      actor_id: scope.actor_id,
      conversation_id: scope.conversation_id,
      adapter_id: scope.adapter_id,
      recipient: RECIPIENT,
      purpose: PURPOSE,
      snapshot: immutableCopy(scope.snapshot),
      lanes,
    });
    issuedContexts.set(context, Object.freeze({
      request_id: request.request_id, generation_id: request.generation_id,
      world_id: scope.world_id, actor_id: scope.actor_id,
      conversation_id: scope.conversation_id, adapter_id: scope.adapter_id,
      purpose: PURPOSE, snapshot: context.snapshot,
    }));
    return Object.freeze({ status: 'ready', context, reason: null });
  }

  return Object.freeze({
    build,
    createReceiver: receiverOptions => createNpcGenerationContextReceiver({
      ...receiverOptions, issuedContexts, consumedContexts,
      acceptedReceipts, consumedReceipts, dispatchHandoffs, consumedHandoffs,
    }),
  });
}

/**
 * Future dispatch receiver. It accepts only object-identical contexts issued by
 * this module's builder and rechecks the request binding and live Core scope.
 * It does not send to a model or create a transport lease.
 */
function createNpcGenerationContextReceiver({
  resolveScope, revalidateEvidence, revalidateScope, issuedContexts, consumedContexts,
  acceptedReceipts, consumedReceipts, dispatchHandoffs, consumedHandoffs,
}) {
  if (!(issuedContexts instanceof WeakMap) || !(consumedContexts instanceof WeakSet)
    || !(acceptedReceipts instanceof WeakMap) || !(consumedReceipts instanceof WeakSet)
    || !(dispatchHandoffs instanceof WeakMap) || !(consumedHandoffs instanceof WeakSet)
    || typeof resolveScope !== 'function' || typeof revalidateEvidence !== 'function'
    || typeof revalidateScope !== 'function') {
    throw new TypeError('Receiver requires trusted Core scope and evidence callbacks');
  }
  // The Builder owns this one-shot registry, shared by every Receiver it
  // creates. Consume synchronously before any await to block concurrent reuse.
  async function receive(context, request) {
    const issued = context && typeof context === 'object' ? issuedContexts.get(context) : null;
    if (!issued || !validateRequest(request)
      || issued.request_id !== request.request_id || issued.generation_id !== request.generation_id
      || context.request_id !== request.request_id || context.generation_id !== request.generation_id
      || context.generation_type !== request.generation_type) return nonReady('context_request_mismatch');
    if (consumedContexts.has(context)) return nonReady('context_replay_rejected');
    consumedContexts.add(context);
    let scope;
    let evidenceCurrent;
    let current;
    try {
      scope = await resolveScope(Object.freeze({ ...request }));
      evidenceCurrent = await revalidateEvidence(context);
      current = await revalidateScope(scope);
    } catch { return nonReady('context_scope_unavailable'); }
    if (evidenceCurrent !== true) return nonReady('context_evidence_changed');
    if (!validateScope(scope) || !validateScope(current)
      || scope.world_id !== issued.world_id || scope.actor_id !== issued.actor_id
      || scope.conversation_id !== issued.conversation_id || scope.adapter_id !== issued.adapter_id
      || current.world_id !== issued.world_id || current.actor_id !== issued.actor_id
      || current.conversation_id !== issued.conversation_id || current.adapter_id !== issued.adapter_id
      || !sameSnapshot(scope.snapshot, issued.snapshot)
      || !sameSnapshot(current.snapshot, issued.snapshot)) return nonReady('context_scope_changed');
    const accepted = Object.freeze({ status: 'accepted', context, reason: null });
    acceptedReceipts.set(accepted, Object.freeze({
      context,
      request_id: request.request_id,
      generation_id: request.generation_id,
      generation_type: request.generation_type,
    }));
    return accepted;
  }

  // Mint an opaque, in-process, one-shot handoff only from this Receiver's
  // successful receipt. The token carries no serialized context and cannot be
  // reconstructed from request metadata or a cloned context.
  function issueDispatchHandoff(accepted, request) {
    const receipt = accepted && typeof accepted === 'object' ? acceptedReceipts.get(accepted) : null;
    if (!receipt || consumedReceipts.has(accepted) || !validateRequest(request)
      || receipt.request_id !== request.request_id
      || receipt.generation_id !== request.generation_id
      || receipt.generation_type !== request.generation_type
      || accepted.context !== receipt.context) {
      return nonReady('dispatch_handoff_rejected');
    }
    consumedReceipts.add(accepted);
    const handoff = Object.freeze(Object.create(null));
    dispatchHandoffs.set(handoff, receipt);
    return Object.freeze({ status: 'ready', handoff, reason: null });
  }

  // Called only by the trusted in-process Gateway while it owns the shared
  // dispatch-start ordering boundary. It is synchronous and one-shot; the
  // Gateway must still revalidate both lanes under that same boundary.
  function consumeDispatchHandoff(handoff, request) {
    const receipt = handoff && typeof handoff === 'object' ? dispatchHandoffs.get(handoff) : null;
    if (!receipt || consumedHandoffs.has(handoff) || !validateRequest(request)
      || receipt.request_id !== request.request_id
      || receipt.generation_id !== request.generation_id
      || receipt.generation_type !== request.generation_type) {
      return nonReady('dispatch_handoff_rejected');
    }
    consumedHandoffs.add(handoff);
    return Object.freeze({ status: 'accepted', context: receipt.context, reason: null });
  }

  // Non-authorizing prompt projection for the exact issued handoff. It
  // exposes bounded data only; the opaque handoff remains private and
  // unconsumed until Gateway calls consumeDispatchHandoff() under its lease.
  function projectDispatchHandoff(handoff, request) {
    const receipt = handoff && typeof handoff === 'object' ? dispatchHandoffs.get(handoff) : null;
    if (!receipt || consumedHandoffs.has(handoff) || !validateRequest(request)
      || receipt.request_id !== request.request_id
      || receipt.generation_id !== request.generation_id
      || receipt.generation_type !== request.generation_type) {
      return nonReady('dispatch_projection_rejected');
    }
    const context = receipt.context;
    const laneA = context?.lanes?.lane_a;
    const laneB = context?.lanes?.lane_b;
    if (!plainDataRecord(laneA, ['lane', 'items'], [
      'lane', 'purpose', 'authorization_ref', 'visibility_authorization_ref', 'items',
    ]) || laneA.lane !== 'A' || laneA.purpose !== PURPOSE
      || !validId(laneA.authorization_ref) || !validId(laneA.visibility_authorization_ref)
      || !densePlainArray(laneA.items)
      || !plainDataRecord(laneB, ['lane', 'candidates', 'admitted'], [
        'lane', 'core_purpose', 'provider_purpose', 'status', 'admitted',
        'candidates', 'reason', 'snapshot',
      ]) || laneB.lane !== 'B' || laneB.core_purpose !== PURPOSE
      || laneB.provider_purpose !== 'npc_decision' || laneB.status !== 'ready'
      || laneB.reason !== null || !sameSnapshot(context.snapshot, laneB.snapshot)
      || !densePlainArray(laneB.candidates) || !densePlainArray(laneB.admitted)
      || laneB.candidates.length !== laneB.admitted.length) {
      return nonReady('dispatch_projection_invalid');
    }
    try {
      const contentBlocks = [];
      for (let index = 0; index < laneA.items.length; index += 1) {
        const item = laneA.items[index];
        if (!plainDataRecord(item, ['acquisition_kind', 'subject_ref', 'predicate', 'value'], [
          'acquisition_id', 'fact_id', 'subject_ref', 'predicate', 'value',
          'acquisition_kind', 'provenance_ref', 'provenance_digest',
          'acquisition_authorization_ref', 'source_event_ids', 'visibility_authorization_ref',
        ]) || !validId(item.acquisition_kind) || !validId(item.subject_ref)
          || !validId(item.predicate)) return nonReady('dispatch_projection_invalid');
        contentBlocks.push({
          epistemic_kind: item.acquisition_kind,
          evidence_assessment: 'unassessed',
          content: {
            subject_ref: item.subject_ref,
            predicate: item.predicate,
            value: item.value,
          },
        });
      }
      const candidates = [];
      const sourceByIdentity = new Map();
      for (let index = 0; index < laneB.candidates.length; index += 1) {
        const candidate = laneB.candidates[index];
        const admitted = laneB.admitted[index];
        if (!exactRecord(candidate, [
          'record_ref', 'record_version', 'authorization_generation',
          'source_entity_id', 'source_version', 'epistemic_kind',
          'evidence_assessment', 'content',
        ]) || !plainDataRecord(admitted, ['record_ref', 'record_version'], [
          'record_ref', 'record_version', 'epistemic_kind', 'evidence_assessment',
        ])
          || !validId(candidate.record_ref) || !validId(candidate.record_version)
          || !Number.isSafeInteger(candidate.authorization_generation)
          || candidate.authorization_generation < 1
          || !validId(candidate.source_entity_id) || !validSourceVersion(candidate.source_version)
          || !validId(candidate.epistemic_kind)
          || !['unassessed', 'supported', 'disputed', 'insufficient'].includes(candidate.evidence_assessment)
          || admitted.record_ref !== candidate.record_ref
          || admitted.record_version !== candidate.record_version) {
          return nonReady('dispatch_projection_invalid');
        }
        candidates.push({
          record_ref: candidate.record_ref,
          record_version: candidate.record_version,
          authorization_generation: candidate.authorization_generation,
          source_kind: 'canonical_entity',
          source_entity_id: candidate.source_entity_id,
          source_version: candidate.source_version,
        });
        const sourceIdentity = JSON.stringify([candidate.source_entity_id, candidate.source_version]);
        sourceByIdentity.set(sourceIdentity, {
          source_kind: 'canonical_entity',
          source_entity_id: candidate.source_entity_id,
          source_version: candidate.source_version,
        });
        contentBlocks.push({
          epistemic_kind: candidate.epistemic_kind,
          evidence_assessment: candidate.evidence_assessment,
          content: candidate.content,
        });
      }
      const sources = [...sourceByIdentity.values()].sort((a, b) =>
        a.source_entity_id < b.source_entity_id ? -1
          : a.source_entity_id > b.source_entity_id ? 1
            : a.source_version < b.source_version ? -1
              : a.source_version > b.source_version ? 1 : 0);
      const projection = immutableCopy({
        world_id: context.world_id,
        actor_id: context.actor_id,
        conversation_id: context.conversation_id,
        adapter_id: context.adapter_id,
        purpose: context.purpose,
        snapshot: context.snapshot,
        contentBlocks,
        sources,
        candidates,
      });
      return Object.freeze({ status: 'ready', projection, reason: null });
    } catch {
      return nonReady('dispatch_projection_invalid');
    }
  }

  return Object.freeze({ receive, issueDispatchHandoff, consumeDispatchHandoff, projectDispatchHandoff });
}
