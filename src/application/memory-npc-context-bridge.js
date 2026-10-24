import { evaluateMemoryCandidateAdmission } from '../npc/memory-candidate-eligibility.js';

/**
 * Opt-in application seam for a future Memory -> NPC integration.
 *
 * This is deliberately not wired into the HTTP API or default runtime. The
 * host must inject trusted result- and candidate-verifiers which consult the
 * authoritative Memory/Core boundaries; caller-supplied labels are not proof.
 * The verifier contract is a proposal until Memory/Core owners approve it.
 */
export class MemoryNpcContextBridge {
  constructor({ retrieve, verifyResult, verifyCandidate }) {
    if (typeof retrieve !== 'function') throw new TypeError('MemoryNpcContextBridge requires a trusted retrieve function');
    if (typeof verifyResult !== 'function') throw new TypeError('MemoryNpcContextBridge requires a trusted result verifier');
    if (typeof verifyCandidate !== 'function') throw new TypeError('MemoryNpcContextBridge requires a trusted candidate verifier');
    this.retrieve = retrieve;
    this.verifyResult = verifyResult;
    this.verifyCandidate = verifyCandidate;
  }

  async read(request) {
    if (!request || typeof request !== 'object'
      || typeof request.world_id !== 'string' || !request.world_id.trim()
      || typeof request.subject_id !== 'string' || !request.subject_id.trim()
      || typeof request.purpose !== 'string' || !request.purpose.trim()) {
      return Object.freeze({ status: 'non_ready', admitted: Object.freeze([]), reason: 'trusted_scope_incomplete' });
    }

    // Snapshot values are part of the trusted request scope. A shallow copy
    // alone would let a retriever mutate request.snapshot through the shared
    // nested object and then make stale candidates appear current to the oracle.
    const trustedRequest = Object.freeze({
      world_id: request.world_id,
      subject_id: request.subject_id,
      purpose: request.purpose,
      ...(request.snapshot == null
        ? {}
        : {
          snapshot: request.snapshot !== null && typeof request.snapshot === 'object' && !Array.isArray(request.snapshot)
            ? Object.freeze({ ...request.snapshot })
            : request.snapshot,
        }),
    });

    let result;
    try {
      result = await this.retrieve(trustedRequest);
    } catch {
      return Object.freeze({ status: 'non_ready', admitted: Object.freeze([]), reason: 'retrieval_unavailable' });
    }

    // A result claiming "complete" is not sufficient. The trusted host
    // verifier must establish scope, access and completeness at the source.
    try {
      if (await this.verifyResult(trustedRequest, result) !== true) {
        return Object.freeze({ status: 'non_ready', admitted: Object.freeze([]), reason: 'authoritative_result_unconfirmed' });
      }
      if (!result || !Array.isArray(result.candidates)) {
        return Object.freeze({ status: 'non_ready', admitted: Object.freeze([]), reason: 'result_incomplete_or_unavailable' });
      }
      for (const candidate of result.candidates) {
        if (await this.verifyCandidate(trustedRequest, candidate) !== true) {
          // Do not silently turn an unverifiable hit into an authorized empty
          // result. Any unverifiable candidate makes this retrieval non-ready.
          return Object.freeze({ status: 'non_ready', admitted: Object.freeze([]), reason: 'authoritative_candidate_unconfirmed' });
        }
      }
    } catch {
      return Object.freeze({ status: 'non_ready', admitted: Object.freeze([]), reason: 'authoritative_verification_unavailable' });
    }

    // The existing NPC oracle remains a second-stage semantic filter. It emits
    // reference metadata only; content projection remains a separate boundary.
    return evaluateMemoryCandidateAdmission(trustedRequest, result);
  }
}
