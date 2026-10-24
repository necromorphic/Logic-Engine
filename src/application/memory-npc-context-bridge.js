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

  read(request) {
    if (!request || typeof request !== 'object'
      || typeof request.world_id !== 'string' || !request.world_id.trim()
      || typeof request.subject_id !== 'string' || !request.subject_id.trim()
      || typeof request.purpose !== 'string' || !request.purpose.trim()) {
      return Object.freeze({ status: 'non_ready', admitted: Object.freeze([]), reason: 'trusted_scope_incomplete' });
    }

    let result;
    try {
      result = this.retrieve(Object.freeze({ ...request }));
    } catch {
      return Object.freeze({ status: 'non_ready', admitted: Object.freeze([]), reason: 'retrieval_unavailable' });
    }

    // A result claiming "complete" is not sufficient. The trusted host
    // verifier must establish scope, access and completeness at the source.
    try {
      if (this.verifyResult(Object.freeze({ ...request }), result) !== true) {
        return Object.freeze({ status: 'non_ready', admitted: Object.freeze([]), reason: 'authoritative_result_unconfirmed' });
      }
      if (!result || !Array.isArray(result.candidates)) {
        return Object.freeze({ status: 'non_ready', admitted: Object.freeze([]), reason: 'result_incomplete_or_unavailable' });
      }
      for (const candidate of result.candidates) {
        if (this.verifyCandidate(Object.freeze({ ...request }), candidate) !== true) {
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
    return evaluateMemoryCandidateAdmission(request, result);
  }
}
