import { isDeepStrictEqual, types as utilTypes } from 'node:util';
import { evaluateMemoryCandidateAdmission } from '../npc/memory-candidate-eligibility.js';
import { getAuthenticatedHostSessionContext, isAuthenticatedHostSessionContext } from './host-session-context.js';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function isPlainDataRecord(value, requiredKeys, allowedKeys = requiredKeys) {
  if (!object(value) || utilTypes.isProxy(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const keys = Reflect.ownKeys(value);
    if (keys.length < requiredKeys.length) return false;
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (typeof key !== 'string') return false;
      let allowed = false;
      for (let allowedIndex = 0; allowedIndex < allowedKeys.length; allowedIndex += 1) {
        if (allowedKeys[allowedIndex] === key) {
          allowed = true;
          break;
        }
      }
      if (!allowed) return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return false;
    }
    for (let index = 0; index < requiredKeys.length; index += 1) {
      if (!Object.hasOwn(value, requiredKeys[index])) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function isDensePlainDataArray(value) {
  if (!Array.isArray(value) || utilTypes.isProxy(value)) return false;
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) return false;
    const keys = Reflect.ownKeys(value);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (key === 'length') continue;
      if (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key)
        || !Number.isSafeInteger(Number(key)) || Number(key) >= value.length) return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return false;
    }
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

const validId = (value) => typeof value === 'string'
  && value === value.trim()
  && value.length > 0
  && value.length <= 200
  && ![...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
// Core snapshot cursors are non-negative safe integers. Accepting arbitrary
// finite numbers or strings would let malformed provider metadata pass the
// structural gate even though it cannot represent a canonical Core cursor.
const validCursorPart = (value) => Number.isSafeInteger(value) && value >= 0;
const validSnapshot = (value) => object(value)
  && validCursorPart(value.world_revision)
  && validCursorPart(value.commit_sequence);
const sameSnapshot = (left, right) => validSnapshot(left) && validSnapshot(right)
  && left.world_revision === right.world_revision
  && left.commit_sequence === right.commit_sequence;
const recordIdentityKey = (ref, version) => JSON.stringify([ref, version]);
const CONTENT_KINDS = new Set(['claim', 'report', 'summary', 'author_initial', 'imported', 'inference']);
const EPISTEMIC_KINDS = new Set(['canonical', 'acquired_report', 'rumor', 'inference', 'authored_initial', 'imported']);
const EVIDENCE_ASSESSMENTS = new Set(['unassessed', 'supported', 'disputed', 'insufficient']);

const INTRINSIC_OBJECT_PROTOTYPE_KEYS = new Set([
  "constructor", "__defineGetter__", "__defineSetter__", "hasOwnProperty",
  "__lookupGetter__", "__lookupSetter__", "isPrototypeOf", "propertyIsEnumerable",
  "toString", "valueOf", "__proto__", "toLocaleString",
]);
const INTRINSIC_ARRAY_ITERATOR = Array.prototype[Symbol.iterator];

function hasSafeObjectPrototype() {
  try {
    const keys = Reflect.ownKeys(Object.prototype);
    for (const key of keys) {
      if (typeof key !== "string" || !INTRINSIC_OBJECT_PROTOTYPE_KEYS.has(key)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, key);
      if (!descriptor) return false;
      if (key === "__proto__") {
        if (!Object.hasOwn(descriptor, "get") || !Object.hasOwn(descriptor, "set")) return false;
      } else if (!Object.hasOwn(descriptor, "value")) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function hasSafeArrayIterator() {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator);
    return descriptor != null
      && Object.hasOwn(descriptor, "value")
      && descriptor.value === INTRINSIC_ARRAY_ITERATOR;
  } catch {
    return false;
  }
}

// Initial knowledge is authoritative only through Core's explicit subject-assignment
// lifecycle. This generic Memory retrieval seam has no assignment-read proof yet.
const INITIAL_ASSIGNMENT_CONTENT_KINDS = new Set(['author_initial', 'imported']);
const INITIAL_ASSIGNMENT_EPISTEMIC_KINDS = new Set(['authored_initial', 'imported']);

const PROVIDER_FAILURE_REASONS = Object.freeze({
  MEMORY_QUERY_DENIED: 'memory_query_denied',
  MEMORY_RECORDS_WITHHELD: 'memory_records_withheld',
  MEMORY_SNAPSHOT_STALE: 'memory_snapshot_stale',
  MEMORY_SNAPSHOT_UNAVAILABLE: 'memory_snapshot_unavailable',
  MEMORY_INDEX_NOT_READY: 'memory_index_not_ready',
  MEMORY_LINEAGE_INVALID: 'memory_lineage_invalid',
  MEMORY_SOURCE_VALIDATION_UNAVAILABLE: 'memory_source_validation_unavailable',
  MEMORY_SOURCE_VERSION_UNVERIFIABLE: 'memory_source_version_unverifiable',
  MEMORY_AUTHORIZATION_CHANGED: 'memory_authorization_changed',
  MEMORY_RECORD_ACCESS_REVOKED: 'memory_record_access_revoked',
});

const providerFailureReason = (error) => {
  try {
    const code = error?.message;
    return typeof code === 'string'
      ? (PROVIDER_FAILURE_REASONS[code] ?? 'memory_retrieval_unavailable')
      : 'memory_retrieval_unavailable';
  } catch {
    return 'memory_retrieval_unavailable';
  }
};

const providerAuthorizationFailureReason = (error, fallback) => {
  const reason = providerFailureReason(error);
  return reason === 'memory_retrieval_unavailable' ? fallback : reason;
};

const nonReady = (reason) => Object.freeze({
  status: 'non_ready',
  admitted: Object.freeze([]),
  candidates: Object.freeze([]),
  reason,
});

/**
 * Internal host seam for a future Memory -> NPC retrieval path.
 *
 * This class deliberately has no default Memory provider or access policy and
 * is not wired into the public API. Its composition pins a configured adapter
 * identity and injects trusted Core conversation query authorization, Memory
 * record authorization/retrieval, and the existing Core AuthorizedReadService.
 *
 * First slice supports only direct canonical-entity sources. Memory summaries
 * and other source kinds are excluded until their source-lineage authorization
 * contract is implemented. Candidate metadata is never treated as proof of
 * access: Core source fields are re-read through AuthorizedReadService.
 */
export class MemoryNpcConsumer {
  #memoryProvider;

  constructor({ authorizedReadService, actorBindingService, hostConversationWorldBindingService, adapterId, memoryProvider, coreQueryAuthorizer, contentFields }) {
    if (typeof authorizedReadService?.readEntityFields !== 'function') {
      throw new TypeError('MemoryNpcConsumer requires AuthorizedReadService');
    }
    if (typeof actorBindingService?.resolveForAdapter !== 'function') {
      throw new TypeError('MemoryNpcConsumer requires Core ActorBindingService trusted adapter resolution');
    }
    if (typeof hostConversationWorldBindingService?.resolve !== 'function') {
      throw new TypeError('MemoryNpcConsumer requires Core HostConversationWorldBindingService');
    }
    if (!validId(adapterId)) {
      throw new TypeError('MemoryNpcConsumer requires a trusted configured adapterId');
    }
    if (typeof coreQueryAuthorizer !== 'function') {
      throw new TypeError('MemoryNpcConsumer requires trusted Core memory query authorization');
    }
    if (typeof memoryProvider?.authorizeQuery !== 'function'
      || typeof memoryProvider?.retrieveCandidates !== 'function'
      || typeof memoryProvider?.authorizeCandidate !== 'function'
      || typeof memoryProvider?.checkCandidateGrant !== 'function') {
      throw new TypeError('MemoryNpcConsumer requires trusted Memory query, retrieval, and record authorization functions');
    }
    if (!Array.isArray(contentFields) || contentFields.length === 0 || contentFields.length > 20
      || contentFields.some((field) => typeof field !== 'string'
        || !/^[a-zA-Z][a-zA-Z0-9_.-]{0,99}$/.test(field)
        || field === 'entity_id'
        || !(field === 'entity_type' || field === 'status'
          || (field.startsWith('attributes.') && field.length > 'attributes.'.length)))
      || new Set(contentFields).size !== contentFields.length) {
      throw new TypeError('contentFields must be a non-empty, unique trusted field allowlist');
    }
    this.authorizedReadService = authorizedReadService;
    this.actorBindingService = actorBindingService;
    this.hostConversationWorldBindingService = hostConversationWorldBindingService;
    this.adapterId = adapterId;
    this.coreQueryAuthorizer = coreQueryAuthorizer;
    this.#memoryProvider = memoryProvider;
    this.contentFields = Object.freeze([...contentFields]);
    Object.freeze(this);
  }

  /**
   * Re-read Core sources and Memory authorization immediately before the Host
   * begins a protected dispatch. This is a freshness check, not a transport
   * lease: Host must still serialize this call with durable DISPATCH_STARTED
   * and the only outbound Gateway path to close the remaining TOCTOU window.
   */
  async revalidateForFinalDispatch(request, preparedResult) {
    if (!hasSafeObjectPrototype() || !hasSafeArrayIterator()) {
      return nonReady('final_dispatch_revalidation_unavailable');
    }
    if (!object(preparedResult) || preparedResult.status !== 'ready'
      || !Array.isArray(preparedResult.admitted) || !Array.isArray(preparedResult.candidates)
      || !validSnapshot(preparedResult.snapshot)) {
      return nonReady('prepared_dispatch_result_invalid');
    }
    let current;
    try { current = await this.retrieveForNpc(request); }
    catch { return nonReady('final_dispatch_revalidation_unavailable'); }
    if (current.status !== 'ready') return nonReady('final_dispatch_source_not_current');
    if (!isDeepStrictEqual(current, preparedResult)) {
      return nonReady('final_dispatch_source_or_authorization_changed');
    }
    // Return the freshly re-read values; callers must not dispatch the stale
    // prepared object. This object alone does not authorize bypassing Host's
    // durable dispatch-start/sole-egress gateway contract.
    return current;
  }

  async retrieveForNpc(request) {
    if (!hasSafeObjectPrototype() || !hasSafeArrayIterator()) {
      return nonReady('memory_result_incomplete_or_scope_mismatch');
    }
    let conversationId;
    try {
      if (object(request)) ({ conversationId } = request);
    } catch {
      return nonReady('trusted_scope_incomplete');
    }
    const adapterId = this.adapterId;
    if (!validId(conversationId)) return nonReady('trusted_scope_incomplete');

    // World and actor are resolved only from Core's durable bindings. Values
    // supplied beside the conversation ID are deliberately ignored.
    let worldId;
    let actorEntityId;
    let conversationBinding;
    try {
      conversationBinding = this.hostConversationWorldBindingService.resolve({
        adapterId, conversationId,
      });
      worldId = conversationBinding.world_id;
    } catch {
      return nonReady('query_access_unconfirmed');
    }
    try {
      const actorBinding = this.actorBindingService.resolveForAdapter(worldId, adapterId);
      actorEntityId = actorBinding.actor.entity_id;
    } catch {
      return nonReady('actor_binding_unavailable');
    }
    if (!validId(worldId) || !validId(actorEntityId)) return nonReady('trusted_scope_unavailable');

    // Bind the caller to a canonical actor before querying Memory. This must
    // happen even for complete-empty results, which otherwise bypass the later
    // AuthorizedReadService call entirely.
    try {
      const binding = this.actorBindingService.resolve(worldId, adapterId, actorEntityId);
      if (!object(binding)
        || binding.world_id !== worldId
        || binding.adapter_id !== adapterId
        || binding.actor?.entity_id !== actorEntityId) {
        return nonReady('actor_binding_unavailable');
      }
    } catch {
      return nonReady('actor_binding_unavailable');
    }

    // The conversation identifier is not a credential. Require a branded
    // context produced from SillyTavern's authenticated signed server session,
    // and compare it with the independently resolved live Core bindings.
    let hostSessionContext;
    try { hostSessionContext = getAuthenticatedHostSessionContext(); } catch {}
    if (!isAuthenticatedHostSessionContext(hostSessionContext, conversationId)
      || hostSessionContext.world_id !== worldId
      || hostSessionContext.actor_id !== actorEntityId) {
      return nonReady('query_access_unconfirmed');
    }

    const scope = Object.freeze({
      world_id: worldId,
      subject_id: actorEntityId,
      purpose: 'npc_decision',
    });
    // Core query purpose describes the model-facing Host turn. Provider's
    // fixed npc_decision purpose remains a separate Memory grant namespace.
    const coreQueryScope = Object.freeze({
      world_id: worldId,
      conversation_id: conversationId,
      adapter_id: adapterId,
      actor_id: actorEntityId,
      recipient: 'model',
      purpose: 'npc_turn_context',
    });
    const coreQueryAllowed = () => {
      try { return this.coreQueryAuthorizer(coreQueryScope, hostSessionContext) === true; }
      catch { return false; }
    };

    let queryAllowed = false;
    try {
      queryAllowed = coreQueryAllowed()
        && await this.#memoryProvider.authorizeQuery(scope) === true
        && coreQueryAllowed();
    } catch {
      queryAllowed = false;
    }
    if (!queryAllowed) return nonReady('query_access_unconfirmed');

    // Query permission can be revoked while retrieval, record checks, or the
    // canonical source read are in flight. Recheck before any READY result;
    // this narrows the race but does not claim an atomic disclosure guarantee.
    const queryStillAllowed = async () => {
      try {
        if (!coreQueryAllowed()) return false;
        const providerAllowed = await this.#memoryProvider.authorizeQuery(scope) === true;
        return providerAllowed && coreQueryAllowed();
      } catch {
        return false;
      }
    };

    // Final synchronous fence used after the last Core field read. There must
    // be no await between this check and returning the envelope.
    const queryStillAllowedSynchronously = () => {
      try {
        return coreQueryAllowed()
          && this.#memoryProvider.authorizeQuery(scope) === true
          && coreQueryAllowed();
      } catch {
        return false;
      }
    };

    let memoryResult;
    try {
      // Freeze a stable data snapshot before any per-record authorization
      // awaits. A mutable in-process index object must not be able to rebind
      // a candidate's source or identity between validation and Core read.
      memoryResult = structuredClone(await this.#memoryProvider.retrieveCandidates(scope));
    } catch (error) {
      let reason = providerFailureReason(error);
      if (reason === 'memory_index_not_ready'
        && typeof this.#memoryProvider.getIndexStatusForDiagnostics === 'function') {
        try {
          const diagnostics = this.#memoryProvider.getIndexStatusForDiagnostics(worldId);
          if (object(diagnostics)) {
            if (diagnostics.index_health === 'rebuilding') reason = 'memory_index_rebuilding';
            else if (diagnostics.index_health === 'unavailable') reason = 'memory_index_unavailable';
            else if (diagnostics.index_health === 'stale') reason = 'memory_index_stale';
            else if (diagnostics.source_reconciliation === 'stale') reason = 'memory_reconciliation_stale';
            else if (diagnostics.source_reconciliation === 'unavailable') reason = 'memory_reconciliation_unavailable';
          }
        } catch {
          // Diagnostics refine a known non-ready state only; they never turn
          // an unavailable retrieval into a ready or empty result.
        }
      }
      return nonReady(reason);
    }

    if (!object(memoryResult)) {
      return nonReady('memory_result_incomplete_or_scope_mismatch');
    }
    if (memoryResult.index_health !== 'ready') {
      const indexReason = memoryResult.index_health === 'rebuilding' ? 'memory_index_rebuilding'
        : memoryResult.index_health === 'stale' ? 'memory_index_stale'
          : memoryResult.index_health === 'unavailable' ? 'memory_index_unavailable'
            : 'memory_index_not_ready';
      return nonReady(indexReason);
    }
    if (memoryResult.source_reconciliation !== 'current') {
      const reconciliationReason = memoryResult.source_reconciliation === 'stale' ? 'memory_reconciliation_stale'
        : memoryResult.source_reconciliation === 'unavailable' ? 'memory_reconciliation_unavailable'
          : 'memory_reconciliation_not_current';
      return nonReady(reconciliationReason);
    }
    if (memoryResult.completeness === 'partial') return nonReady('memory_result_partial');
    if (memoryResult.completeness !== 'complete'
      || !Array.isArray(memoryResult.candidates)
      || memoryResult.candidates.length > 50
      || !validSnapshot(memoryResult.snapshot)
      || memoryResult.scope?.world_id !== scope.world_id
      || memoryResult.scope?.subject_id !== scope.subject_id
      || memoryResult.scope?.purpose !== scope.purpose) {
      return nonReady('memory_result_incomplete_or_scope_mismatch');
    }

    if (memoryResult.candidates.length === 0) {
      // Empty is meaningful only when the provider's complete-result snapshot
      // is tied to a current canonical Core read. Otherwise an old index can
      // claim "nothing here" after a source mutation or rollback.
      let emptySnapshotRead;
      try {
        emptySnapshotRead = this.authorizedReadService.readEntityFields({
          worldId,
          adapterId,
          actorEntityId,
          recipient: 'model',
          purpose: 'npc_decision',
          entityIds: [actorEntityId],
          fields: ['entity_id'],
        });
      } catch {
        return nonReady('authorized_source_read_unavailable');
      }
      if (!object(emptySnapshotRead)
        || emptySnapshotRead.world_id !== worldId
        || !validSnapshot({
          world_revision: emptySnapshotRead.world_revision,
          commit_sequence: emptySnapshotRead.commit_sequence,
        })
        || !sameSnapshot(memoryResult.snapshot, {
          world_revision: emptySnapshotRead.world_revision,
          commit_sequence: emptySnapshotRead.commit_sequence,
        })) {
        return nonReady('memory_snapshot_stale');
      }
      if (!(await queryStillAllowed())) return nonReady('query_access_unconfirmed');
      // Keep the Core snapshot read after asynchronous authorization so a
      // world change during the recheck cannot make a stale empty result ready.
      let finalEmptySnapshotRead;
      try {
        finalEmptySnapshotRead = this.authorizedReadService.readEntityFields({
          worldId,
          adapterId,
          actorEntityId,
          recipient: 'model',
          purpose: 'npc_decision',
          entityIds: [actorEntityId],
          fields: ['entity_id'],
        });
      } catch {
        return nonReady('authorized_source_read_unavailable');
      }
      if (!object(finalEmptySnapshotRead)
        || finalEmptySnapshotRead.world_id !== worldId
        || !validSnapshot({
          world_revision: finalEmptySnapshotRead.world_revision,
          commit_sequence: finalEmptySnapshotRead.commit_sequence,
        })
        || !sameSnapshot(memoryResult.snapshot, {
          world_revision: finalEmptySnapshotRead.world_revision,
          commit_sequence: finalEmptySnapshotRead.commit_sequence,
        })) {
        return nonReady('memory_snapshot_stale');
      }
      if (!queryStillAllowedSynchronously()) return nonReady('query_access_unconfirmed');
      return Object.freeze({
        status: 'ready',
        admitted: Object.freeze([]),
        candidates: Object.freeze([]),
        reason: null,
        snapshot: Object.freeze({
          world_revision: emptySnapshotRead.world_revision,
          commit_sequence: emptySnapshotRead.commit_sequence,
        }),
      });
    }

    let authorizedCandidates = [];
    for (const candidate of memoryResult.candidates) {
      // A result declared complete must not silently turn malformed records
      // into an apparently valid empty result. Scope/identity/snapshot
      // violations invalidate the provider response as a whole. Well-formed
      // but unsupported source kinds (including summaries) remain excluded.
      if (!object(candidate)
        || candidate.world_id !== scope.world_id
        || candidate.subject_id !== scope.subject_id
        || candidate.purpose !== scope.purpose
        || !validSnapshot(candidate.snapshot)
        || !validId(candidate.record?.ref)
        || !validId(candidate.record?.version)
        || !Number.isSafeInteger(candidate.authorization_generation)
        || candidate.authorization_generation < 1) {
        return nonReady('memory_candidate_invalid_or_scope_mismatch');
      }
      // Every row must belong to the same provider snapshot, even if its
      // source kind will later be excluded from NPC admission. Otherwise an
      // inconsistent stale row could be silently filtered into ready-empty.
      if (!sameSnapshot(candidate.snapshot, memoryResult.snapshot)) {
        return nonReady('memory_snapshot_stale');
      }
      if (candidate.content_kind === 'summary'
        || candidate.source?.kind !== 'canonical_entity'
        || !validId(candidate.source?.entity_id)
        || !validId(candidate.source?.source_version)) {
        // Do not report item-level rejection reasons or counts to the caller.
        continue;
      }

      let recordAllowed;
      try {
        recordAllowed = await this.#memoryProvider.authorizeCandidate({
          ...scope,
          record_ref: candidate.record.ref,
          record_version: candidate.record.version,
          authorization_generation: candidate.authorization_generation,
          source_kind: candidate.source.kind,
          source_entity_id: candidate.source.entity_id,
          source_version: candidate.source.source_version,
        }) === true;
      } catch (error) {
        // A denial is an ordinary filtered record; an authorization failure is
        // not evidence that the result is complete-empty. Preserve known typed
        // revoke/stale/unavailable outcomes without returning internal details.
        return nonReady(providerAuthorizationFailureReason(error, 'memory_record_authorization_unavailable'));
      }
      if (!recordAllowed) return nonReady('memory_record_authorization_unconfirmed');

      // Initial/imported knowledge is not authorized by a Memory candidate row.
      // Core owns the explicit subject-assignment record, and this consumer has
      // no assignment-read proof yet. Do not silently filter these rows into a
      // ready-empty result or let the generic retrieval path imply acquisition.
      // Use a generic non-ready result so the caller learns no item-level detail.
      if (INITIAL_ASSIGNMENT_CONTENT_KINDS.has(candidate.content_kind)
        || INITIAL_ASSIGNMENT_EPISTEMIC_KINDS.has(candidate.epistemic_kind)) {
        return nonReady('memory_result_incomplete_or_unavailable');
      }

      // Once the provider confirms this record is visible, required semantic
      // metadata must be present and use known vocabularies. Otherwise the
      // admission oracle could filter a malformed row and make it look like a
      // legitimate empty result. Denied rows are skipped before this check.
      if (!CONTENT_KINDS.has(candidate.content_kind)
        || !EPISTEMIC_KINDS.has(candidate.epistemic_kind)
        || !validId(candidate.producer?.kind)
        || !validId(candidate.lifecycle?.content_disposition)
        || !EVIDENCE_ASSESSMENTS.has(candidate.lifecycle?.evidence_assessment)) {
        return nonReady('memory_candidate_metadata_incomplete');
      }

      // Check Memory-owned currentness only after record authorization, so a
      // denied record cannot change the result shape based on its freshness.
      // A visible stale/rebuilding record is non-ready, not complete-empty.
      if (candidate.freshness?.status !== 'current'
        || candidate.lifecycle?.source_reconciliation !== 'current'
        || candidate.lifecycle?.index_health !== 'ready') {
        return nonReady('memory_source_not_current');
      }
      authorizedCandidates.push(candidate);
    }

    // Revalidate Memory access after the full initial authorization pass. A
    // later candidate's asynchronous authorization may take long enough for
    // access to an earlier candidate to be revoked. Do not carry that earlier
    // allow straight into the Core content read without a final access check.
    // This narrows the TOCTOU window; atomic revocation guarantees still depend
    // on a future owner-approved provider snapshot/lease contract.
    const initiallyAuthorizedCandidates = authorizedCandidates;
    authorizedCandidates = [];
    for (const candidate of initiallyAuthorizedCandidates) {
      let stillAllowed;
      try {
        stillAllowed = await this.#memoryProvider.authorizeCandidate({
          ...scope,
          record_ref: candidate.record.ref,
          record_version: candidate.record.version,
          authorization_generation: candidate.authorization_generation,
          source_kind: candidate.source.kind,
          source_entity_id: candidate.source.entity_id,
        }) === true;
      } catch (error) {
        return nonReady(providerAuthorizationFailureReason(error, 'memory_record_authorization_unavailable'));
      }
      if (!stillAllowed) return nonReady('memory_record_authorization_unconfirmed');
      authorizedCandidates.push(candidate);
    }

    if (authorizedCandidates.length === 0) {
      // A result that becomes empty only after authorization/filtering still
      // needs a current Core snapshot. Otherwise a stale Memory index can be
      // reported as ready-empty simply because every row was denied or
      // unsupported, bypassing the snapshot check used for true empty results.
      let filteredEmptySnapshotRead;
      try {
        filteredEmptySnapshotRead = this.authorizedReadService.readEntityFields({
          worldId,
          adapterId,
          actorEntityId,
          recipient: 'model',
          purpose: 'npc_decision',
          entityIds: [actorEntityId],
          fields: ['entity_id'],
        });
      } catch {
        return nonReady('authorized_source_read_unavailable');
      }
      if (!object(filteredEmptySnapshotRead)
        || filteredEmptySnapshotRead.world_id !== worldId
        || !validSnapshot({
          world_revision: filteredEmptySnapshotRead.world_revision,
          commit_sequence: filteredEmptySnapshotRead.commit_sequence,
        })
        || !sameSnapshot(memoryResult.snapshot, {
          world_revision: filteredEmptySnapshotRead.world_revision,
          commit_sequence: filteredEmptySnapshotRead.commit_sequence,
        })) {
        return nonReady('memory_snapshot_stale');
      }
      if (!(await queryStillAllowed())) return nonReady('query_access_unconfirmed');
      // Keep the Core snapshot read after asynchronous authorization so a
      // world change during the recheck cannot make a stale empty result ready.
      let finalEmptySnapshotRead;
      try {
        finalEmptySnapshotRead = this.authorizedReadService.readEntityFields({
          worldId,
          adapterId,
          actorEntityId,
          recipient: 'model',
          purpose: 'npc_decision',
          entityIds: [actorEntityId],
          fields: ['entity_id'],
        });
      } catch {
        return nonReady('authorized_source_read_unavailable');
      }
      if (!object(finalEmptySnapshotRead)
        || finalEmptySnapshotRead.world_id !== worldId
        || !validSnapshot({
          world_revision: finalEmptySnapshotRead.world_revision,
          commit_sequence: finalEmptySnapshotRead.commit_sequence,
        })
        || !sameSnapshot(memoryResult.snapshot, {
          world_revision: finalEmptySnapshotRead.world_revision,
          commit_sequence: finalEmptySnapshotRead.commit_sequence,
        })) {
        return nonReady('memory_snapshot_stale');
      }
      return Object.freeze({
        status: 'ready',
        admitted: Object.freeze([]),
        candidates: Object.freeze([]),
        reason: null,
        snapshot: Object.freeze({
          world_revision: filteredEmptySnapshotRead.world_revision,
          commit_sequence: filteredEmptySnapshotRead.commit_sequence,
        }),
      });
    }

    // A stable Memory record identity/version must not be rebound to a
    // different source or different semantic metadata within one retrieval.
    // Deduplicate identical repeats; fail closed on conflicting identities.
    const uniqueCandidates = [];
    const identitySignatures = new Map();
    const identityCounts = new Map();
    for (const candidate of authorizedCandidates) {
      const identity = recordIdentityKey(candidate.record.ref, candidate.record.version);
      identityCounts.set(identity, (identityCounts.get(identity) ?? 0) + 1);
    }
    for (const candidate of authorizedCandidates) {
      const identity = recordIdentityKey(candidate.record.ref, candidate.record.version);
      const signature = {
        source_entity_id: candidate.source.entity_id,
        content_kind: candidate.content_kind,
        epistemic_kind: candidate.epistemic_kind,
        producer_kind: candidate.producer?.kind,
        authorization_generation: candidate.authorization_generation,
        content_disposition: candidate.lifecycle?.content_disposition,
        evidence_assessment: candidate.lifecycle?.evidence_assessment,
        index_health: candidate.lifecycle?.index_health,
        snapshot: candidate.snapshot,
      };
      const previous = identitySignatures.get(identity);
      if (previous) {
        if (!isDeepStrictEqual(previous, signature)) return nonReady('memory_record_identity_conflict');
        continue;
      }
      identitySignatures.set(identity, signature);
      // No approved immutable digest proves repeated ref/version rows identical.
      // Exclude every occurrence instead of silently retaining the first one.
      if (identityCounts.get(identity) !== 1) continue;
      uniqueCandidates.push(candidate);
    }

    // Even if every candidate was excluded as an ambiguous duplicate, require
    // a current canonical snapshot read before returning ready-empty.
    const entityIds = uniqueCandidates.length === 0
      ? [actorEntityId]
      : [...new Set(uniqueCandidates.map((candidate) => candidate.source.entity_id))];
    if (entityIds.length > 50) return nonReady('source_read_limit_exceeded');

    let sourceRead;
    try {
      sourceRead = this.authorizedReadService.readEntityFields({
        worldId,
        adapterId,
        actorEntityId,
        recipient: 'model',
        purpose: 'npc_decision',
        entityIds,
        fields: ['entity_id', ...this.contentFields],
      });
    } catch {
      // Missing, denied, or unavailable source reads have one safe outcome.
      return nonReady('authorized_source_read_unavailable');
    }

    const sourceReadKeys = ['world_id', 'world_revision', 'commit_sequence', 'entities'];
    if (!isPlainDataRecord(sourceRead, sourceReadKeys)
      || sourceRead.world_id !== worldId
      || !validSnapshot({ world_revision: sourceRead.world_revision, commit_sequence: sourceRead.commit_sequence })
      || !isDensePlainDataArray(sourceRead.entities)) {
      return nonReady('authorized_source_read_invalid');
    }

    if (!sameSnapshot(memoryResult.snapshot, {
      world_revision: sourceRead.world_revision,
      commit_sequence: sourceRead.commit_sequence,
    })) {
      return nonReady('memory_snapshot_stale');
    }

    const sourceById = new Map();
    const requestedEntityIds = new Set(entityIds);
    const allowedEntityKeys = ['entity_id', ...this.contentFields];
    for (const entity of sourceRead.entities) {
      if (!isPlainDataRecord(entity, ['entity_id'], allowedEntityKeys)
        || !validId(entity.entity_id)
        || !requestedEntityIds.has(entity.entity_id)
        || sourceById.has(entity.entity_id)) {
        // The Core envelope must contain exactly the requested canonical
        // identities and only the allowlisted projection fields. Never accept
        // an extra entity, duplicate identity, accessor, Proxy, or diagnostic.
        return nonReady('authorized_source_read_invalid');
      }
      sourceById.set(entity.entity_id, entity);
    }
    if (sourceById.size !== requestedEntityIds.size) {
      return nonReady('authorized_source_missing');
    }

    const oracleCandidates = [];
    const contentByIdentity = new Map();
    for (const candidate of uniqueCandidates) {
      // A Memory record is eligible only if its index snapshot exactly matches
      // the canonical read snapshot. The composite cursor is a snapshot marker,
      // not a source-specific version or change journal.
      if (!sameSnapshot(candidate.snapshot, {
        world_revision: sourceRead.world_revision,
        commit_sequence: sourceRead.commit_sequence,
      })) {
        // A non-empty retrieval with a stale index snapshot is not a complete
        // empty result. Reject the whole read so callers cannot mistake stale
        // Memory for absence of relevant knowledge.
        return nonReady('memory_snapshot_stale');
      }

      const source = sourceById.get(candidate.source.entity_id);
      // Missing canonical source is not evidence of an empty Memory result:
      // it may mean deletion, incomplete projection, or a source-read boundary
      // failure. Fail closed. A present source with a denied field may still be
      // safely excluded without disclosing which field policy denied it.
      if (!source) return nonReady('authorized_source_missing');
      if (this.contentFields.some((field) => !Object.hasOwn(source, field))) continue;

      const trustedCandidate = {
        ...candidate,
        access: { outcome: 'allow', subject_id: scope.subject_id, purpose: scope.purpose },
        snapshot: {
          world_revision: sourceRead.world_revision,
          commit_sequence: sourceRead.commit_sequence,
        },
        // The Core cursor validates the canonical read snapshot only. It must
        // not overwrite Memory-owned freshness or reconciliation dimensions.
        lifecycle: {
          ...candidate.lifecycle,
          access_outcome: 'allow',
        },
      };
      oracleCandidates.push(trustedCandidate);
      const identity = recordIdentityKey(candidate.record.ref, candidate.record.version);
      contentByIdentity.set(identity, {
        record_ref: candidate.record.ref,
        record_version: candidate.record.version,
        authorization_generation: candidate.authorization_generation,
        source_entity_id: candidate.source.entity_id,
        source_version: candidate.source.source_version,
        epistemic_kind: candidate.epistemic_kind,
        evidence_assessment: candidate.lifecycle?.evidence_assessment,
        content: Object.fromEntries(this.contentFields.map((field) => [field, source[field]])),
      });
    }

    const decision = evaluateMemoryCandidateAdmission(
      {
        ...scope,
        snapshot: {
          world_revision: sourceRead.world_revision,
          commit_sequence: sourceRead.commit_sequence,
        },
      },
      {
        completeness: 'complete',
        access: { outcome: 'allow', subject_id: scope.subject_id, purpose: scope.purpose },
        scope,
        candidates: oracleCandidates,
      },
    );

    if (decision.status !== 'ready') return nonReady(decision.reason || 'candidate_admission_not_ready');

    const admitted = decision.admitted
      .map((item) => contentByIdentity.get(recordIdentityKey(item.record_ref, item.record_version)))
      .filter(Boolean);

    // A record may be revoked while Core is reading its canonical source.
    // Recheck every record that would actually be returned after that read.
    // If any final check fails, reject the whole result rather than leaking a
    // partial set or silently turning a revoked result into complete-empty.
    for (const item of admitted) {
      let stillAllowed;
      try {
        stillAllowed = await this.#memoryProvider.authorizeCandidate({
          ...scope,
          record_ref: item.record_ref,
          record_version: item.record_version,
          authorization_generation: item.authorization_generation,
          source_kind: 'canonical_entity',
          source_entity_id: item.source_entity_id,
          source_version: item.source_version,
        }) === true;
      } catch (error) {
        return nonReady(providerAuthorizationFailureReason(error, 'memory_record_authorization_unavailable'));
      }
      if (!stillAllowed) return nonReady('memory_record_authorization_unconfirmed');
    }

    // Complete all asynchronous authorization rechecks before the final
    // field-bearing read. No await or authorization operation follows it.
    if (!(await queryStillAllowed())) return nonReady('query_access_unconfirmed');

    let finalSourceSnapshotRead;
    try {
      finalSourceSnapshotRead = this.authorizedReadService.readEntityFields({
        worldId,
        adapterId,
        actorEntityId,
        recipient: 'model',
        purpose: 'npc_decision',
        entityIds,
        fields: ['entity_id', ...this.contentFields],
      });
    } catch {
      return nonReady('authorized_source_read_unavailable');
    }
    if (!isPlainDataRecord(finalSourceSnapshotRead, sourceReadKeys)
      || finalSourceSnapshotRead.world_id !== worldId
      || !validSnapshot({
        world_revision: finalSourceSnapshotRead.world_revision,
        commit_sequence: finalSourceSnapshotRead.commit_sequence,
      })
      || !isDensePlainDataArray(finalSourceSnapshotRead.entities)) {
      return nonReady('authorized_source_read_invalid');
    }
    if (!sameSnapshot(sourceRead, {
      world_revision: finalSourceSnapshotRead.world_revision,
      commit_sequence: finalSourceSnapshotRead.commit_sequence,
    })) {
      return nonReady('memory_snapshot_stale');
    }

    // Reapply field visibility at the disclosure boundary. The first source
    // read is used for admission only; returned values come from this final
    // authorized read, after Provider and Core authorization rechecks.
    const finalSourceById = new Map();
    for (const entity of finalSourceSnapshotRead.entities) {
      if (!isPlainDataRecord(entity, ['entity_id'], allowedEntityKeys)
        || !validId(entity.entity_id)
        || !requestedEntityIds.has(entity.entity_id)
        || finalSourceById.has(entity.entity_id)) {
        return nonReady('authorized_source_read_invalid');
      }
      finalSourceById.set(entity.entity_id, entity);
    }
    if (finalSourceById.size !== requestedEntityIds.size) {
      return nonReady('authorized_source_missing');
    }
    const finalContentByIdentity = new Map();
    for (const item of admitted) {
      const source = finalSourceById.get(item.source_entity_id);
      if (!source || this.contentFields.some((field) => !Object.hasOwn(source, field))) {
        return nonReady('authorized_source_read_unavailable');
      }
      finalContentByIdentity.set(recordIdentityKey(item.record_ref, item.record_version),
        Object.fromEntries(this.contentFields.map((field) => [field, source[field]])));
    }

    // Recheck exact Provider record grants after the final field-bearing read.
    // SQLite checks are synchronous, so no event-loop yield occurs between the
    // final Core authorization fence and envelope construction.
    for (const item of admitted) {
      try {
        if (this.#memoryProvider.checkCandidateGrant({
          ...scope,
          record_ref: item.record_ref,
          record_version: item.record_version,
          authorization_generation: item.authorization_generation,
        }) !== true) return nonReady('memory_record_authorization_unconfirmed');
      } catch (error) {
        return nonReady(providerAuthorizationFailureReason(error, 'memory_record_authorization_unavailable'));
      }
    }
    // Core conversation/world and actor bindings are checked last, after the
    // Provider fence, so a revoke during that synchronous fence cannot slip
    // through to a ready envelope. This remains a cross-database freshness
    // fence, not an atomic lease with a later model transport.
    if (!queryStillAllowedSynchronously()) return nonReady('query_access_unconfirmed');

    return Object.freeze({
      status: 'ready',
      admitted: decision.admitted,
      candidates: Object.freeze(admitted.map((item) => Object.freeze({
        ...item,
        content: Object.freeze(finalContentByIdentity.get(recordIdentityKey(item.record_ref, item.record_version))),
      }))),
      reason: null,
      snapshot: Object.freeze({
        world_revision: sourceRead.world_revision,
        commit_sequence: sourceRead.commit_sequence,
      }),
    });
  }
}
