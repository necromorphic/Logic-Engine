# Causality semantics — Stage 1 proposal

Status: **architecture proposal; not yet a runtime/API contract**. This document records the current agreement and the decisions that must be resolved before tests are treated as normative. It does not change the current runtime's guarantees.

Related: [Stage 1 causality contract](21-stage1-causality-contract.md).

## 1. Purpose and limits

Stage 1 aims to make declared causal relationships explicit and testable before introducing a typed causal graph or changing storage.

The current runtime supports **partial rollback over declared metadata**. It does not prove that all causally relevant inputs were declared. Consequently:

- `causal_completeness` is `unknown` in Stage 1.
- A context manifest records what was available to a model, not what materially influenced its output.
- A `read_set` records caller-declared reads; it is not proof that the declaration is complete.
- Current `caused_by`, `depends_on`, and `read_set` strings are not equivalent to the proposed typed relationships below.
- No new API fields, SQLite tables, or runtime behavior are introduced by this document.

## 2. Three distinct evidence layers

1. **Context manifest** — records available context and, when supported, its generation/revision binding.
2. **Read set** — records the context items the caller declares as materially used.
3. **Causal relationships** — express how an event relates to events, claims, or predicates.

The intended validation direction is one-way: each declared read should be verifiable against a trusted, generation-bound manifest. Extra manifest entries do not by themselves show that the read set is incomplete.

Proposed basis statuses:

- `all_verified`: every declared read is present in the trusted manifest.
- `invalid_declared`: at least one declared read is absent from the trusted manifest.
- `undeclared`: the event has no declared reads.
- `unbound`: the manifest or its generation binding is unavailable.

These are proposed semantic labels, not current runtime output fields. The precise precedence between an empty read set and a missing manifest remains to be specified before implementation.

## 3. Proposed relationship types

| Relationship | Proposed meaning | Rollback implication |
|---|---|---|
| `CAUSES` | Event A directly caused event B | Declared descendant is a rollback candidate; actual status still depends on the rollback contract |
| `PRODUCES` | An event produced or changed a projection/claim | Recompute the affected projection from remaining valid claims |
| `OBSERVES` | Event B asserts predicate P at a specified observation point | Preserve the historical observation unless its asserted historical basis is invalidated; it may be marked stale |
| `REQUIRES` | Event B was committed on the precondition that P held at B's commit point | Invalidate B only when recomputation establishes that the required precondition did not hold at that point |
| `READS_SOURCE` | B used a particular source event | Rolling back that source makes B a candidate for invalidation |
| `READS_CLAIM` | B used a claim supported by one or more sources | Invalidate B only if the claim no longer satisfies the dependency after recomputation |
| `EVIDENCE_FOR` | A source supports a claim | Recompute claim support after source changes |
| `CONFLICTS_WITH` | Two claims or sources are incompatible under a defined predicate | Recompute the claim's conflict/dispute state |
| `MAINTAINS` | B requires P to remain true throughout an interval | Deferred; not supported by the Stage 1 runtime contract |

These names are a design vocabulary, not accepted API values. Stage 1 must not silently interpret an unknown relationship as a supported one.

### 3.1 Commit-time preconditions versus invariants

`REQUIRES` is a historical commit-time precondition, not a continuously maintained invariant. `MAINTAINS` is the proposed interval invariant and is deferred.

Before implementing this distinction, specify how the engine reconstructs the state at an event's commit point after a rollback. A current projection alone is insufficient to answer every historical predicate query.

## 4. Predicate vocabulary under consideration

Candidate predicate forms:

- `entity_exists(entity_id)`
- `entity_attribute(entity_id, attribute, value)`
- `fact_status(subject, attribute, value)`
- `event_occurred(event_id, before_game_time)`
- `predicate_was_false(predicate, observed_revision, observed_game_time)`

Predicate evaluation should be tri-state: `true`, `false`, or `unknown`. Unknown must not be silently coerced to false.

The final schema must define canonical identifiers, supported attribute values, comparison rules, and the exact relationship between event commit sequence, `world_revision`, and `game_time`.

### 4.1 Negative observations

A negative observation must refer to a predicate/query, not to an absent `fact_id`. A proposed representation may include the predicate, an observation revision, and the observed game time.

**Open semantic decision:** does `observed_revision` identify an immutable historical snapshot, or a position in a canonical event history that is reconstructed after rollback? Those interpretations produce different results. Do not implement invalidation of negative observations until this is resolved. In particular, a rollback transaction must not be assumed to mutate an immutable historical snapshot retroactively.

## 5. Event status versus rollback outcome

These are separate axes.

Proposed event statuses:

- `valid`: currently included in the canonical history.
- `invalidated`: excluded because a required commit-time precondition is no longer supported in the reconstructed canonical history.
- `superseded`: replaced by a later event under a specifically defined supersession rule.

Proposed rollback outcomes for the **rollback operation**:

- `resolved`: all events classified by the defined rules were processed; no known ambiguity blocked the operation.
- `partially_resolved`: some classifications or dependent projections were deferred.
- `requires_review`: a specific ambiguity requires an explicit decision.

If per-event diagnostics are needed, use a separate per-event classification field rather than attaching an operation-level `rollback_outcome` to each event.

`causal_completeness = unknown` is a system-wide Stage 1 limitation. It does not, by itself, force every rollback to be `requires_review`; otherwise `resolved` would have no useful meaning. A review reason should identify a concrete unresolved case, such as an unbound manifest, ambiguous legacy predicate, unresolved source conflict, or deferred invariant.

## 6. Candidate invariants

The following are proposed and require testable definitions before they become normative:

- **INV-1 — declared reads:** every declared read must be present in a trusted, generation-bound manifest; manifest extras do not imply an incomplete read set.
- **INV-2 — monotonic game time:** rollback does not decrease `game_time`.
- **INV-3 — monotonic revision:** each successful rollback transaction increments `world_revision` exactly once.
- **INV-4 — required preconditions:** an event is invalidated for a `REQUIRES` dependency only when that dependency is false at the event's defined commit point in the reconstructed canonical history.
- **INV-5 — completeness:** `causal_completeness` remains `unknown` throughout Stage 1.
- **INV-6 — negative observations:** classification requires a defined historical-snapshot/reconstruction model; no behavior is normative until that model is chosen.
- **INV-7 — source versus claim:** a direct source dependency and a claim dependency have different rollback semantics.
- **INV-8 — review:** review is driven by a concrete unresolved classification, not solely by the general fact that causal completeness is unknown.

## 7. Test plan candidates (not yet normative)

After the open semantics are settled, derive contract tests for:

- negative observation at a historical revision;
- required precondition invalidated by rollback of its only support;
- required precondition still supported by an independent source;
- source-specific read versus claim-level read with multiple sources;
- manifest-bound, missing-read, empty-read-set, and unbound-manifest cases;
- event status independent from rollback-operation outcome;
- causal diamond rollback and preservation of an independent branch.

Names such as T-03R, T-04R-1, T-04R-3, T-05R, T-05S, T-06R, T-06S, T-07R, and T-08 may be used as working identifiers, but the test matrix should be finalized only after each scenario states its event order, required predicates, and expected historical-state semantics.

## 8. Explicitly deferred

- `MAINTAINS` enforcement and interval invariants.
- Reactivation/revival of previously invalidated events.
- Counterfactual proof of causal completeness.
- Confidence scores or provenance-weighted trust.
- A normalized `causal_edges` storage table.
- Rollback/recomputation of NPC processes, timers, knowledge, and StoryBeats.

## 9. Compatibility boundary

This proposal does not change the current runtime contract documented in `docs/21-stage1-causality-contract.md`. Existing string-based metadata remains legacy input until a separately reviewed runtime/API proposal defines migration, validation, and backward compatibility.
