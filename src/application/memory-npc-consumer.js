import { isDeepStrictEqual } from 'node:util';
import { evaluateMemoryCandidateAdmission } from '../npc/memory-candidate-eligibility.js';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = (value) => typeof value === 'string'
  && value === value.trim()
  && value.length > 0
  && value.length <= 200
  && ![...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
const validCursorPart = (value) => (typeof value === 'string' && value.trim().length > 0)
  || (typeof value === 'number' && Number.isFinite(value));
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
 * is not wired into the public API. The host must inject trusted Memory
 * authorization/retrieval functions and the existing Core AuthorizedReadService.
 *
 * First slice supports only direct canonical-entity sources. Memory summaries
 * and other source kinds are excluded until their source-lineage authorization
 * contract is implemented. Candidate metadata is never treated as proof of
 * access: Core source fields are re-read through AuthorizedReadService.
 */
export class MemoryNpcConsumer {
  constructor({ authorizedReadService, actorBindingService, memoryProvider, contentFields }) {
    if (typeof authorizedReadService?.readEntityFields !== 'function') {
      throw new TypeError('MemoryNpcConsumer requires AuthorizedReadService');
    }
    if (typeof actorBindingService?.resolve !== 'function') {
      throw new TypeError('MemoryNpcConsumer requires Core ActorBindingService');
    }
    if (typeof memoryProvider?.authorizeQuery !== 'function'
      || typeof memoryProvider?.retrieveCandidates !== 'function'
      || typeof memoryProvider?.authorizeCandidate !== 'function') {
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
    this.memoryProvider = memoryProvider;
    this.contentFields = Object.freeze([...contentFields]);
  }

  async retrieveForNpc(request) {
    let worldId;
    let adapterId;
    let actorEntityId;
    try {
      if (object(request)) ({ worldId, adapterId, actorEntityId } = request);
    } catch {
      return nonReady('trusted_scope_incomplete');
    }
    if (!validId(worldId) || !validId(adapterId) || !validId(actorEntityId)) {
      return nonReady('trusted_scope_incomplete');
    }

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

    const scope = Object.freeze({
      world_id: worldId,
      subject_id: actorEntityId,
      purpose: 'npc_decision',
    });

    let queryAllowed = false;
    try {
      queryAllowed = await this.memoryProvider.authorizeQuery(scope) === true;
    } catch {
      queryAllowed = false;
    }
    if (!queryAllowed) return nonReady('query_access_unconfirmed');

    let memoryResult;
    try {
      // Freeze a stable data snapshot before any per-record authorization
      // awaits. A mutable in-process index object must not be able to rebind
      // a candidate's source or identity between validation and Core read.
      memoryResult = structuredClone(await this.memoryProvider.retrieveCandidates(scope));
    } catch {
      return nonReady('memory_retrieval_unavailable');
    }

    if (!object(memoryResult)) {
      return nonReady('memory_result_incomplete_or_scope_mismatch');
    }
    if (memoryResult.index_health !== 'ready') {
      return nonReady('memory_index_not_ready');
    }
    if (memoryResult.source_reconciliation !== 'current') {
      return nonReady('memory_reconciliation_not_current');
    }
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
        || !validId(candidate.record?.version)) {
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
        || !validId(candidate.source?.entity_id)) {
        // Do not report item-level rejection reasons or counts to the caller.
        continue;
      }

      let recordAllowed;
      try {
        recordAllowed = await this.memoryProvider.authorizeCandidate({
          ...scope,
          record_ref: candidate.record.ref,
          record_version: candidate.record.version,
          source_kind: candidate.source.kind,
          source_entity_id: candidate.source.entity_id,
        }) === true;
      } catch {
        // A denial is an ordinary filtered record; an authorization failure is
        // not evidence that the result is complete-empty.
        return nonReady('memory_record_authorization_unavailable');
      }
      if (!recordAllowed) continue;

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
        stillAllowed = await this.memoryProvider.authorizeCandidate({
          ...scope,
          record_ref: candidate.record.ref,
          record_version: candidate.record.version,
          source_kind: candidate.source.kind,
          source_entity_id: candidate.source.entity_id,
        }) === true;
      } catch {
        return nonReady('memory_record_authorization_unavailable');
      }
      if (stillAllowed) authorizedCandidates.push(candidate);
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
    for (const candidate of authorizedCandidates) {
      const identity = recordIdentityKey(candidate.record.ref, candidate.record.version);
      const signature = {
        source_entity_id: candidate.source.entity_id,
        content_kind: candidate.content_kind,
        epistemic_kind: candidate.epistemic_kind,
        producer_kind: candidate.producer?.kind,
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
      uniqueCandidates.push(candidate);
    }

    const entityIds = [...new Set(uniqueCandidates.map((candidate) => candidate.source.entity_id))];
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

    if (!object(sourceRead)
      || sourceRead.world_id !== worldId
      || !validSnapshot({ world_revision: sourceRead.world_revision, commit_sequence: sourceRead.commit_sequence })
      || !Array.isArray(sourceRead.entities)) {
      return nonReady('authorized_source_read_invalid');
    }

    if (!sameSnapshot(memoryResult.snapshot, {
      world_revision: sourceRead.world_revision,
      commit_sequence: sourceRead.commit_sequence,
    })) {
      return nonReady('memory_snapshot_stale');
    }

    const sourceById = new Map();
    for (const entity of sourceRead.entities) {
      if (!object(entity) || !validId(entity.entity_id)) return nonReady('authorized_source_read_invalid');
      sourceById.set(entity.entity_id, entity);
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
        source_entity_id: candidate.source.entity_id,
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

    return Object.freeze({
      status: 'ready',
      admitted: decision.admitted,
      candidates: Object.freeze(admitted.map((item) => Object.freeze({
        ...item,
        content: Object.freeze(item.content),
      }))),
      reason: null,
      snapshot: Object.freeze({
        world_revision: sourceRead.world_revision,
        commit_sequence: sourceRead.commit_sequence,
      }),
    });
  }
}
