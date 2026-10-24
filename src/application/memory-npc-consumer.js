import { isDeepStrictEqual } from 'node:util';
import { evaluateMemoryCandidateAdmission } from '../npc/memory-candidate-eligibility.js';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
const validCursorPart = (value) => (typeof value === 'string' && value.trim().length > 0)
  || (typeof value === 'number' && Number.isFinite(value));
const validSnapshot = (value) => object(value)
  && validCursorPart(value.world_revision)
  && validCursorPart(value.commit_sequence);
const sameSnapshot = (left, right) => validSnapshot(left) && validSnapshot(right)
  && left.world_revision === right.world_revision
  && left.commit_sequence === right.commit_sequence;

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
      || contentFields.some((field) => typeof field !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_.-]{0,99}$/.test(field)
        || field === 'entity_id')
      || new Set(contentFields).size !== contentFields.length) {
      throw new TypeError('contentFields must be a non-empty, unique trusted field allowlist');
    }
    this.authorizedReadService = authorizedReadService;
    this.actorBindingService = actorBindingService;
    this.memoryProvider = memoryProvider;
    this.contentFields = Object.freeze([...contentFields]);
  }

  async retrieveForNpc({ worldId, adapterId, actorEntityId }) {
    if (!validId(worldId) || !validId(adapterId) || !validId(actorEntityId)) {
      return nonReady('trusted_scope_incomplete');
    }

    // Bind the caller to a canonical actor before querying Memory. This must
    // happen even for complete-empty results, which otherwise bypass the later
    // AuthorizedReadService call entirely.
    try {
      this.actorBindingService.resolve(worldId, adapterId, actorEntityId);
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
      memoryResult = await this.memoryProvider.retrieveCandidates(scope);
    } catch {
      return nonReady('memory_retrieval_unavailable');
    }

    if (!object(memoryResult)
      || memoryResult.completeness !== 'complete'
      || !Array.isArray(memoryResult.candidates)
      || memoryResult.candidates.length > 50
      || memoryResult.scope?.world_id !== scope.world_id
      || memoryResult.scope?.subject_id !== scope.subject_id
      || memoryResult.scope?.purpose !== scope.purpose) {
      return nonReady('memory_result_incomplete_or_scope_mismatch');
    }

    if (memoryResult.candidates.length === 0) {
      // Empty is meaningful only after the trusted provider explicitly
      // authorized this query and confirmed a complete result.
      return Object.freeze({
        status: 'ready',
        admitted: Object.freeze([]),
        candidates: Object.freeze([]),
        reason: null,
        snapshot: null,
      });
    }

    const authorizedCandidates = [];
    for (const candidate of memoryResult.candidates) {
      if (!object(candidate)
        || candidate.world_id !== scope.world_id
        || candidate.subject_id !== scope.subject_id
        || candidate.purpose !== scope.purpose
        || candidate.content_kind === 'summary'
        || candidate.source?.kind !== 'canonical_entity'
        || !validId(candidate.source?.entity_id)
        || !validSnapshot(candidate.snapshot)
        || !validId(candidate.record?.ref)
        || !validId(candidate.record?.version)) {
        // Do not report item-level rejection reasons or counts to the caller.
        continue;
      }

      let recordAllowed = false;
      try {
        recordAllowed = await this.memoryProvider.authorizeCandidate({
          ...scope,
          record_ref: candidate.record.ref,
          record_version: candidate.record.version,
          source_kind: candidate.source.kind,
          source_entity_id: candidate.source.entity_id,
        }) === true;
      } catch {
        recordAllowed = false;
      }
      if (recordAllowed) authorizedCandidates.push(candidate);
    }

    if (authorizedCandidates.length === 0) {
      return Object.freeze({
        status: 'ready',
        admitted: Object.freeze([]),
        candidates: Object.freeze([]),
        reason: null,
        snapshot: null,
      });
    }

    // A stable Memory record identity/version must not be rebound to a
    // different source or different semantic metadata within one retrieval.
    // Deduplicate identical repeats; fail closed on conflicting identities.
    const uniqueCandidates = [];
    const identitySignatures = new Map();
    for (const candidate of authorizedCandidates) {
      const identity = candidate.record.ref + '\\u0000' + candidate.record.version;
      const signature = {
        source_entity_id: candidate.source.entity_id,
        content_kind: candidate.content_kind,
        epistemic_kind: candidate.epistemic_kind,
        producer_kind: candidate.producer?.kind,
        content_disposition: candidate.lifecycle?.content_disposition,
        evidence_assessment: candidate.lifecycle?.evidence_assessment,
        index_health: candidate.lifecycle?.index_health,
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
      })) continue;

      const source = sourceById.get(candidate.source.entity_id);
      if (!source || this.contentFields.some((field) => !Object.hasOwn(source, field))) continue;

      const trustedCandidate = {
        ...candidate,
        access: { outcome: 'allow', subject_id: scope.subject_id, purpose: scope.purpose },
        snapshot: {
          world_revision: sourceRead.world_revision,
          commit_sequence: sourceRead.commit_sequence,
        },
        freshness: { status: 'current' },
        lifecycle: {
          ...candidate.lifecycle,
          source_reconciliation: 'current',
          access_outcome: 'allow',
        },
      };
      oracleCandidates.push(trustedCandidate);
      const identity = candidate.record.ref + '\u0000' + candidate.record.version;
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
      .map((item) => contentByIdentity.get(item.record_ref + '\u0000' + item.record_version))
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
