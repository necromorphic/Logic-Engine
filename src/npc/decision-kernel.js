/**
 * Isolated NPC decision-kernel prototype.
 *
 * This is NOT a production contract or runtime executor. The input vocabulary is
 * deliberately local to this pure prototype and must not be treated as a
 * serialized/API schema. It accepts classifications already supplied by a
 * caller; it does not authorize actions or evaluate world rules.
 *
 * No I/O, persistence, model/network calls, Memory access, or world mutation.
 */

const FEASIBILITY = new Set(["feasible", "blocked", "unknown"]);

function invalid(message) {
  throw new TypeError(`Invalid NPC decision prototype input: ${message}`);
}

/**
 * Classify a small, explicit candidate set.
 *
 * Prototype candidate shape:
 *   { id: non-empty string, feasibility: feasible|blocked|unknown,
 *     preference: finite number }
 *
 * Preference is considered only after feasibility is known. A unique maximum
 * wins; ties and unresolved feasibility defer rather than use input order.
 */
export function evaluateNpcDecisionPrototype(candidates) {
  if (!Array.isArray(candidates)) invalid("candidates must be an array");

  const seen = new Set();
  const normalized = candidates.map((candidate) => {
    if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
      invalid("each candidate must be an object");
    }
    if (typeof candidate.id !== "string" || !candidate.id.trim()) {
      invalid("candidate id must be a non-empty string");
    }
    if (seen.has(candidate.id)) invalid("candidate ids must be unique");
    seen.add(candidate.id);

    if (!FEASIBILITY.has(candidate.feasibility)) {
      invalid("candidate feasibility must be feasible, blocked, or unknown");
    }
    if (typeof candidate.preference !== "number" || !Number.isFinite(candidate.preference)) {
      invalid("candidate preference must be a finite number");
    }

    return {
      id: candidate.id,
      feasibility: candidate.feasibility,
      preference: candidate.preference,
    };
  }).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const unknown = normalized.filter((candidate) => candidate.feasibility === "unknown");
  const feasible = normalized.filter((candidate) => candidate.feasibility === "feasible");

  if (unknown.length > 0) {
    return {
      status: "unresolved",
      reason: "unknown_feasibility",
      candidateIds: normalized.map(({ id }) => id),
    };
  }

  if (feasible.length === 0) {
    return {
      status: "no_feasible_candidate",
      reason: normalized.length === 0 ? "no_candidates" : "all_candidates_blocked",
      candidateIds: normalized.map(({ id }) => id),
    };
  }

  const highest = Math.max(...feasible.map(({ preference }) => preference));
  const winners = feasible.filter(({ preference }) => preference === highest);

  if (winners.length !== 1) {
    return {
      status: "unresolved",
      reason: "incomparable_or_tied_preference",
      candidateIds: winners.map(({ id }) => id).sort(),
    };
  }

  return {
    status: "proposal_selected",
    reason: "unique_highest_feasible_preference",
    candidateIds: [winners[0].id],
  };
}
