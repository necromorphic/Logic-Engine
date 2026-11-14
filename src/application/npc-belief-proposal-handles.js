import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import { hashRequest } from '../core/request-hash.js';
import { npcPropositionRefFor } from './npc-belief-state.js';

const CONTEXT_TTL_MS = 15 * 60 * 1000;
const HANDLE_MAX = 200;
const STORABLE_ACQUISITION_KINDS = new Set(['author_initial', 'imported']);
const AUTHORIZATION_CONTEXT_KEYS = [
  'world_id', 'conversation_id', 'adapter_id', 'actor_id', 'recipient',
  'purpose', 'expected_revision', 'expected_commit_sequence', 'limit',
];

const validId = value => typeof value === 'string' && value === value.trim()
  && value.length > 0 && value.length <= HANDLE_MAX
  && !/[\u0000-\u001f\u007f]/u.test(value);
const validDigest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function plainDataObject(value) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value) || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    return Reflect.ownKeys(value).every(key => {
      if (typeof key !== 'string') return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor !== undefined && descriptor.enumerable && Object.hasOwn(descriptor, 'value');
    });
  } catch { return false; }
}

function exactDataObject(value, keys) {
  return plainDataObject(value) && Reflect.ownKeys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

function denseArray(value, max = 200) {
  if (utilTypes.isProxy(value) || !Array.isArray(value) || value.length > max) return false;
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) return false;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 || !keys.includes('length')) return false;
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return false;
    }
    return true;
  } catch { return false; }
}

function safeJsonTree(value, ancestors = new Set(), depth = 0, budget = { nodes: 0 }) {
  budget.nodes += 1;
  if (depth > 32 || budget.nodes > 10000) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || utilTypes.isProxy(value) || ancestors.has(value)) return false;
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) return false;
      const keys = Reflect.ownKeys(value);
      if (keys.length !== value.length + 1 || !keys.includes('length')) return false;
      ancestors.add(value);
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')
          || !safeJsonTree(descriptor.value, ancestors, depth + 1, budget)) {
          ancestors.delete(value);
          return false;
        }
      }
      ancestors.delete(value);
      return true;
    }
    if (!plainDataObject(value)) return false;
    ancestors.add(value);
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !safeJsonTree(descriptor.value, ancestors, depth + 1, budget)) {
        ancestors.delete(value);
        return false;
      }
    }
    ancestors.delete(value);
    return true;
  } catch {
    ancestors.delete(value);
    return false;
  }
}

function freezeTree(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function validKey(key) {
  return typeof key === 'string' && key.length >= 16 && key.length <= 4096;
}

function hmac(key, payload) {
  return createHmac('sha256', key).update(hashRequest(payload), 'utf8').digest('base64url');
}

function equalMac(expected, actual) {
  try {
    const left = Buffer.from(expected, 'base64url');
    const right = Buffer.from(actual, 'base64url');
    return left.length === 32 && right.length === 32 && timingSafeEqual(left, right);
  } catch { return false; }
}

function scopeRecord(read, limit) {
  if (!plainDataObject(read) || read.status !== 'ready' || read.truncated === true
    || !plainDataObject(read.snapshot)
    || !Number.isSafeInteger(read.snapshot.world_revision) || read.snapshot.world_revision < 0
    || !Number.isSafeInteger(read.snapshot.commit_sequence) || read.snapshot.commit_sequence < 0
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 200
    || !validId(read.world_id) || !validId(read.conversation_id) || !validId(read.adapter_id)
    || !validId(read.actor_id) || read.recipient !== 'model'
    || !['npc_turn_context', 'npc_action_evaluation'].includes(read.purpose)) {
    throw new TypeError('A complete, authorized NPC knowledge snapshot is required for evidence handles.');
  }
  return Object.freeze({
    world_id: read.world_id,
    conversation_id: read.conversation_id,
    adapter_id: read.adapter_id,
    actor_id: read.actor_id,
    recipient: read.recipient,
    purpose: read.purpose,
    expected_revision: read.snapshot.world_revision,
    expected_commit_sequence: read.snapshot.commit_sequence,
    limit,
  });
}

function contextMacPayload(scope, nonce, expiresAt) {
  return { version: 1, kind: 'npc-belief-context', scope, nonce, expires_at: expiresAt };
}

function parseAndVerifyContextHandle(contextHandle, scope, key, now) {
  if (typeof contextHandle !== 'string') return null;
  const match = /^nctx1\.([A-Za-z0-9_-]{22})\.([0-9]{13})\.([A-Za-z0-9_-]{43})$/.exec(contextHandle);
  if (!match) return null;
  const [, nonce, expiryText, suppliedMac] = match;
  const expiresAt = Number(expiryText);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + CONTEXT_TTL_MS) return null;
  const expectedMac = hmac(key, contextMacPayload(scope, nonce, expiresAt));
  if (!equalMac(expectedMac, suppliedMac)) return null;
  return Object.freeze({ nonce, expires_at: expiresAt });
}

function evidenceHandleFor(key, scope, context, item, propositionRef) {
  return 'evh1.' + hmac(key, {
    version: 1,
    kind: 'npc-belief-evidence',
    scope,
    nonce: context.nonce,
    expires_at: context.expires_at,
    acquisition_id: item.acquisition_id,
    fact_id: item.fact_id,
    acquisition_kind: item.acquisition_kind,
    authorization_ref: item.acquisition_authorization_ref,
    provenance_ref: item.provenance_ref,
    provenance_digest: item.provenance_digest,
    source_event_ids_hash: hashRequest(item.source_event_ids ?? []),
    proposition_ref: propositionRef,
    value_hash: hashRequest(item.value),
  });
}

function propositionHandleFor(key, scope, context, propositionRef) {
  return 'prh1.' + hmac(key, {
    version: 1,
    kind: 'npc-belief-proposition',
    scope,
    nonce: context.nonce,
    expires_at: context.expires_at,
    proposition_ref: propositionRef,
  });
}

function subjectHandleFor(key, scope, context, subjectRef) {
  return 'subh1.' + hmac(key, {
    version: 1,
    kind: 'npc-belief-subject',
    scope,
    nonce: context.nonce,
    expires_at: context.expires_at,
    subject_ref: subjectRef,
  });
}

const INTERNAL_VALUE_KEYS = new Set([
  'id', 'world_id', 'actor_id', 'conversation_id', 'adapter_id', 'fact_id',
  'acquisition_id', 'event_id', 'source_event_ids', 'provenance_ref',
  'provenance_digest', 'authorization_ref', 'acquisition_authorization_ref',
  'commit_sequence', 'world_revision', 'snapshot_id',
]);

function containsInternalReference(value, forbiddenIds, depth = 0) {
  if (depth > 32) return true;
  if (typeof value === 'string') {
    return /^(?:world|actor|entity|fact|acq|acquisition|event|conversation|adapter|provenance|authorization):/i.test(value)
      || /^(?:npc|actor|entity|fact|world|conversation|acq|event|adapter)[_-][A-Za-z0-9_-]+$/i.test(value)
      || /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)
      || forbiddenIds.some(id => value.includes(id));
  }
  if (Array.isArray(value)) return value.some(child => containsInternalReference(child, forbiddenIds, depth + 1));
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([key, child]) =>
      INTERNAL_VALUE_KEYS.has(key.toLowerCase()) || /(?:^|_)(?:id|ref|digest)$/i.test(key)
      || containsInternalReference(child, forbiddenIds, depth + 1));
  }
  return false;
}

function eligibleEvidenceItems(items, scope) {
  if (!denseArray(items, 200)) throw new TypeError('Visible Core evidence must be a bounded dense array.');
  const eligible = [];
  const seenAcquisitions = new Set();
  const valueBudget = { nodes: 0 };
  for (const item of items) {
    if (!plainDataObject(item)) {
      throw new TypeError('Visible Core evidence item must be a plain data record.');
    }
    if (!STORABLE_ACQUISITION_KINDS.has(item.acquisition_kind)) continue;
    if (!validId(item.acquisition_id)
      || !validId(item.fact_id)
      || !validId(item.subject_ref)
      || !validId(item.predicate)
      || !validId(item.provenance_ref)
      || !validId(item.acquisition_authorization_ref)
      || item.evidence_type !== item.acquisition_kind
      || !denseArray(item.source_event_ids, 200)
      || item.source_event_ids.length === 0
      || new Set(item.source_event_ids).size !== item.source_event_ids.length
      || item.source_event_ids.some(sourceEventId => !validId(sourceEventId))
      || !validDigest(item.provenance_digest)
      || !safeJsonTree(item.value, new Set(), 0, valueBudget)
      || containsInternalReference(item.value, [
        scope.world_id, scope.conversation_id, scope.adapter_id, scope.actor_id,
        item.acquisition_id, item.fact_id, item.event_id, item.subject_ref, item.provenance_ref,
        item.provenance_digest, item.authorization_ref, item.acquisition_authorization_ref,
        ...(Array.isArray(item.source_event_ids) ? item.source_event_ids.filter(value => typeof value === 'string') : []),
      ].filter(value => typeof value === 'string' && value.length > 0))
      || containsInternalReference(item.predicate, [
        scope.world_id, scope.conversation_id, scope.adapter_id, scope.actor_id,
        item.acquisition_id, item.fact_id, item.subject_ref,
      ].filter(value => typeof value === 'string' && value.length > 0))
      || npcPropositionRefFor(item) === null) {
      throw new TypeError('Visible fact-backed Core evidence is malformed; handle issuance must fail closed.');
    }
    if (seenAcquisitions.has(item.acquisition_id)) {
      throw new TypeError('Visible Core evidence contains duplicate acquisition identities.');
    }
    seenAcquisitions.add(item.acquisition_id);
    eligible.push(item);
  }
  return eligible;
}

/**
 * Build a model-safe projection. Internal Core IDs and provenance references
 * are used only inside HMAC payloads and never appear in model_context.
 */
export function createNpcBeliefProposalContext({ read, visibleItems, key, limit = 200, now = Date.now } = {}) {
  if (!validKey(key) || typeof now !== 'function') {
    throw new TypeError('A trusted evidence-handle key and clock are required.');
  }
  const scope = scopeRecord(read, limit);
  const currentTime = now();
  if (!Number.isSafeInteger(currentTime) || currentTime < 0) {
    throw new TypeError('Evidence-handle clock must return a non-negative integer timestamp.');
  }
  const expiresAt = currentTime + CONTEXT_TTL_MS;
  const nonce = randomBytes(16).toString('base64url');
  const context = Object.freeze({ nonce, expires_at: expiresAt });
  const contextHandle = 'nctx1.' + nonce + '.' + expiresAt + '.'
    + hmac(key, contextMacPayload(scope, nonce, expiresAt));
  const items = eligibleEvidenceItems(visibleItems, scope);
  const byProposition = new Map();

  for (const item of items) {
    const propositionRef = npcPropositionRefFor(item);
    const group = byProposition.get(propositionRef) ?? {
      proposition_ref: propositionRef,
      subject_ref: item.subject_ref,
      predicate: item.predicate,
      evidence: [],
    };
    if (group.subject_ref !== item.subject_ref || group.predicate !== item.predicate) {
      throw new TypeError('Core proposition identity is inconsistent across its evidence.');
    }
    group.evidence.push(Object.freeze({
      handle: evidenceHandleFor(key, scope, context, item, propositionRef),
      evidence_type: item.evidence_type ?? item.acquisition_kind,
      object: freezeTree(cloneJson(item.value)),
    }));
    byProposition.set(propositionRef, group);
  }

  const propositions = [...byProposition.values()]
    .sort((left, right) => left.proposition_ref.localeCompare(right.proposition_ref))
    .map(group => Object.freeze({
      handle: propositionHandleFor(key, scope, context, group.proposition_ref),
      subject_handle: subjectHandleFor(key, scope, context, group.subject_ref),
      subject_kind: group.subject_ref === read.actor_id || group.subject_ref === 'entity:' + read.actor_id
        ? 'current_actor' : 'referenced_entity',
      predicate: group.predicate,
      evidence: Object.freeze(group.evidence.sort((left, right) => left.handle.localeCompare(right.handle))),
    }));

  return Object.freeze({
    status: 'ready',
    expires_at: expiresAt,
    model_context: freezeTree({
      schema_version: 1,
      context_handle: contextHandle,
      propositions,
    }),
  });
}

/**
 * Verify the original signed context scope for a replay acknowledgement.
 * Expiry may be ignored because this path returns only an existing commit
 * acknowledgement; the current actor/conversation authorization is checked
 * separately by Core before the acknowledgement is returned.
 */
export function verifyNpcBeliefProposalContextHandle({
  authorizationContext, contextHandle, key, now = Date.now, allowExpired = false,
} = {}) {
  if (!validKey(key) || typeof now !== 'function'
    || !exactDataObject(authorizationContext, AUTHORIZATION_CONTEXT_KEYS)
    || typeof contextHandle !== 'string') {
    return Object.freeze({ status: 'non_ready', reason: 'invalid_context_verification_input' });
  }
  try {
    const scope = scopeRecord({
      status: 'ready',
      ...authorizationContext,
      snapshot: {
        world_revision: authorizationContext.expected_revision,
        commit_sequence: authorizationContext.expected_commit_sequence,
      },
    }, authorizationContext.limit);
    const match = /^nctx1\.([A-Za-z0-9_-]{22})\.([0-9]{13})\.([A-Za-z0-9_-]{43})$/.exec(contextHandle);
    if (!match) return Object.freeze({ status: 'non_ready', reason: 'invalid_context_handle' });
    const [, nonce, expiryText, suppliedMac] = match;
    const expiresAt = Number(expiryText);
    const currentTime = now();
    if (!Number.isSafeInteger(currentTime) || currentTime < 0
      || !Number.isSafeInteger(expiresAt) || expiresAt > currentTime + CONTEXT_TTL_MS
      || (!allowExpired && expiresAt <= currentTime)) {
      return Object.freeze({ status: 'non_ready', reason: 'invalid_context_expiry' });
    }
    const expectedMac = hmac(key, contextMacPayload(scope, nonce, expiresAt));
    if (!equalMac(expectedMac, suppliedMac)) {
      return Object.freeze({ status: 'non_ready', reason: 'context_scope_mismatch' });
    }
    return Object.freeze({ status: 'ready', expires_at: expiresAt });
  } catch {
    return Object.freeze({ status: 'non_ready', reason: 'invalid_context_scope' });
  }
}

/**
 * Resolve untrusted model-selected handles against a fresh, currently visible
 * Core read. This returns internal IDs only to the trusted Core caller.
 */
export function resolveNpcBeliefProposalHandles({
  read, visibleItems, key, authorizationContext, proposal, now = Date.now,
} = {}) {
  if (!validKey(key) || typeof now !== 'function' || !plainDataObject(authorizationContext)
    || !plainDataObject(proposal)) {
    return Object.freeze({ status: 'non_ready', reason: 'invalid_handle_resolution_input' });
  }
  const scope = scopeRecord(read, authorizationContext.limit ?? 200);
  if (!exactDataObject(authorizationContext, AUTHORIZATION_CONTEXT_KEYS)) {
    return Object.freeze({ status: 'non_ready', reason: 'invalid_authorization_context_shape' });
  }
  const expectedScope = {
    world_id: authorizationContext.world_id,
    conversation_id: authorizationContext.conversation_id,
    adapter_id: authorizationContext.adapter_id,
    actor_id: authorizationContext.actor_id,
    recipient: authorizationContext.recipient,
    purpose: authorizationContext.purpose,
    expected_revision: authorizationContext.expected_revision,
    expected_commit_sequence: authorizationContext.expected_commit_sequence,
    limit: authorizationContext.limit,
  };
  if (hashRequest(scope) !== hashRequest(expectedScope)) {
    return Object.freeze({ status: 'non_ready', reason: 'authorization_scope_mismatch' });
  }
  const currentTime = now();
  if (!Number.isSafeInteger(currentTime) || currentTime < 0) {
    return Object.freeze({ status: 'non_ready', reason: 'invalid_handle_resolution_clock' });
  }
  const proposalKeys = [
    'schema_version', 'context_handle', 'proposition_handle', 'object',
    'supporting_evidence_handles', 'contradicting_evidence_handles',
  ];
  if (!exactDataObject(proposal, proposalKeys)
    || proposal.schema_version !== 1
    || typeof proposal.proposition_handle !== 'string'
    || !/^prh1\.[A-Za-z0-9_-]{43}$/.test(proposal.proposition_handle)
    || !safeJsonTree(proposal.object)
    || !denseArray(proposal.supporting_evidence_handles, 200)
    || !denseArray(proposal.contradicting_evidence_handles, 200)) {
    return Object.freeze({ status: 'non_ready', reason: 'invalid_proposal_shape' });
  }
  const allHandles = [...proposal.supporting_evidence_handles, ...proposal.contradicting_evidence_handles];
  if (allHandles.length === 0 || allHandles.length > 200 || new Set(allHandles).size !== allHandles.length
    || allHandles.some(handle => typeof handle !== 'string' || !/^evh1\.[A-Za-z0-9_-]{43}$/.test(handle))) {
    return Object.freeze({ status: 'non_ready', reason: 'invalid_or_duplicate_evidence_handles' });
  }

  const context = parseAndVerifyContextHandle(proposal.context_handle, scope, key, currentTime);
  if (!context) return Object.freeze({ status: 'non_ready', reason: 'invalid_expired_or_wrong_scope_context_handle' });

  let items;
  try { items = eligibleEvidenceItems(visibleItems, scope); }
  catch { return Object.freeze({ status: 'non_ready', reason: 'invalid_current_core_evidence' }); }
  const forbiddenProposalIds = [
    scope.world_id, scope.conversation_id, scope.adapter_id, scope.actor_id,
    ...items.flatMap(item => [
      item.acquisition_id, item.fact_id, item.subject_ref, item.provenance_ref,
      item.provenance_digest, item.authorization_ref, item.acquisition_authorization_ref,
      ...(item.source_event_ids ?? []),
    ]),
  ].filter(value => typeof value === 'string' && value.length > 0);
  if (containsInternalReference(proposal.object, forbiddenProposalIds)) {
    return Object.freeze({ status: 'non_ready', reason: 'proposal_object_contains_internal_reference' });
  }
  const byEvidenceHandle = new Map();
  const byPropositionHandle = new Map();
  const byProposition = new Map();
  for (const item of items) {
    const propositionRef = npcPropositionRefFor(item);
    const evidenceHandle = evidenceHandleFor(key, scope, context, item, propositionRef);
    if (byEvidenceHandle.has(evidenceHandle)) {
      return Object.freeze({ status: 'non_ready', reason: 'duplicate_current_evidence_handle' });
    }
    byEvidenceHandle.set(evidenceHandle, item);
    const group = byProposition.get(propositionRef) ?? [];
    group.push(item);
    byProposition.set(propositionRef, group);
    const propositionHandle = propositionHandleFor(key, scope, context, propositionRef);
    const existingPropositionRef = byPropositionHandle.get(propositionHandle);
    if (existingPropositionRef !== undefined && existingPropositionRef !== propositionRef) {
      return Object.freeze({ status: 'non_ready', reason: 'proposition_handle_collision' });
    }
    byPropositionHandle.set(propositionHandle, propositionRef);
  }

  const propositionRef = byPropositionHandle.get(proposal.proposition_handle);
  if (!propositionRef) return Object.freeze({ status: 'non_ready', reason: 'unknown_proposition_handle' });
  const propositionItems = byProposition.get(propositionRef) ?? [];
  const objectHash = hashRequest(proposal.object);

  const supportingItems = proposal.supporting_evidence_handles.map(handle => byEvidenceHandle.get(handle));
  const contradictingItems = proposal.contradicting_evidence_handles.map(handle => byEvidenceHandle.get(handle));
  if (supportingItems.some(item => !item || npcPropositionRefFor(item) !== propositionRef)
    || contradictingItems.some(item => !item || npcPropositionRefFor(item) !== propositionRef)) {
    return Object.freeze({ status: 'non_ready', reason: 'unknown_or_cross_proposition_evidence_handle' });
  }
  const citedHandles = new Set(allHandles);
  if (propositionItems.some(item => !citedHandles.has(evidenceHandleFor(key, scope, context, item, propositionRef)))) {
    return Object.freeze({ status: 'non_ready', reason: 'not_all_current_proposition_evidence_accounted_for' });
  }

  if (supportingItems.some(item => hashRequest(item.value) !== objectHash)
    || contradictingItems.some(item => hashRequest(item.value) === objectHash)) {
    return Object.freeze({ status: 'non_ready', reason: 'evidence_side_does_not_match_object' });
  }

  return Object.freeze({
    status: 'ready',
    resolution: Object.freeze({
      proposition_ref: propositionRef,
      proposition_value: freezeTree(cloneJson(proposal.object)),
      supporting_acquisition_ids: Object.freeze(supportingItems.map(item => item.acquisition_id).sort()),
      contradicting_acquisition_ids: Object.freeze(contradictingItems.map(item => item.acquisition_id).sort()),
      reason_rule_ref: 'rule:belief-update-v1',
    }),
  });
}
