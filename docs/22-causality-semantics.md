# Causality semantics — Stage 1 proposal

Status: **mixed proposal and implementation boundary**. The typed-link subset documented in `docs/21-stage1-causality-contract.md` is implemented; the broader semantics below remain proposals and are not implied by the current runtime.

Related: [Stage 1 causality contract](21-stage1-causality-contract.md) and [Stage 1 causality test matrix](24-causality-test-matrix.md).

## 1. Purpose and limits

Stage 1 aims to make declared causal relationships explicit and testable before introducing a typed causal graph or changing storage.

The current runtime supports **partial rollback over declared metadata**. It does not prove that all causally relevant inputs were declared. Consequently:

- `causal_completeness` is `unknown` in Stage 1.
- A context manifest records what was available to a model, not what materially influenced its output.
- A `read_set` records caller-declared reads; it is not proof that the declaration is complete.
- Current `caused_by`, `depends_on`, and `read_set` strings are not equivalent to the proposed typed relationships below.
- The generation-bound manifest subset described in `docs/21-stage1-causality-contract.md` is implemented. It does not establish causal completeness or model attention.

## 2. Three distinct evidence layers

1. **Context manifest** — records available context and must be bound to a particular generation and context snapshot.
2. **Read set** — records the context items the caller declares as materially used.
3. **Causal relationships** — express how an event relates to events, claims, or predicates.

The intended validation direction is one-way: each declared read should be verifiable against a trusted, generation-bound manifest. Extra manifest entries do not by themselves show that the read set is incomplete.

For this proposal, a **trusted manifest** must be immutable, bound to the specific generation that produced the event, and integrity-verifiable (for example, by a content hash recorded with the generation metadata). Merely having a manifest-shaped payload is not sufficient to make it trusted.

Proposed basis statuses:

- `all_verified`: every declared read is present in the trusted manifest.
- `invalid_declared`: at least one declared read is absent from the trusted manifest.
- `undeclared`: the read set is empty and a usable manifest is bound.
- `unbound`: the manifest or its generation binding is unavailable.

**Precedence rule:** if the manifest is absent/unbound, status is `unbound`, even when `read_set` is empty. With a trusted manifest, an empty read set is `undeclared`. A manifest that is present but untrusted is not sufficient for `all_verified`.

These labels describe the intended basis semantics; the current API does not yet expose a general basis-status field. The implemented manifest check rejects a declared read that is absent from a supplied trusted-boundary manifest.

**Proposed commit policy for `invalid_declared`:** reject the event commit with HTTP `400` and a stable validation error; do not persist it as an executable event. A future authoring workflow may preserve rejected input in a separate non-executable review record, but that is outside the Stage 1 committed event contract. This is the recommended default for the API proposal and must be confirmed before implementation. A rejected validation attempt does not create a committed event, a successful idempotency result, or a state-changing audit row. Operational/security logs may record the rejected request separately from the canonical world audit. Because the idempotency key is not consumed by a rejected pre-commit validation, a corrected request may retry with that key; once a request is committed, existing request-hash/idempotency rules apply. This behavior is implemented for rejected declared reads against a supplied context manifest.

## 3. Proposed relationship types

| Relationship | Proposed meaning | Rollback implication |
|---|---|---|
| `CAUSES` | Event A directly caused event B | Declared descendant is a rollback candidate; actual status still depends on the rollback contract |
| `PRODUCES` | An event produced or changed a projection/claim | Recompute the affected projection from remaining valid claims |
| `OBSERVES` | Event B asserts predicate P at a specified observation point | Re-evaluate the historical assertion against the reconstructed canonical history; preserve its original manifest as audit evidence |
| `REQUIRES` | Event B was committed on the precondition that P held at B's commit point | Invalidate B only when recomputation establishes that the required precondition did not hold at that point |
| `READS_SOURCE` | B used a particular source event | Rolling back that source makes B a candidate for invalidation |
| `READS_CLAIM` | B used a claim supported by one or more sources | Invalidate B only if the claim no longer satisfies the dependency after recomputation |
| `EVIDENCE_FOR` | A source supports a claim | Recompute claim support after source changes |
| `CONFLICTS_WITH` | Two claims or sources are incompatible under a defined predicate | Recompute the claim's conflict/dispute state |
| `MAINTAINS` | B requires P to remain true throughout an interval | Deferred; not supported by the Stage 1 runtime contract |

`READS_CLAIM` must reference a canonical `claim_id` present in the claim projection and supported by at least one valid source at the relevant historical evaluation point. Arbitrary labels or an unresolvable claim reference are invalid relationship data, not a claim dependency. Claim identity, source-event identity, and whether that claim is supported at a particular historical cursor are separate concepts; a later rollback can change support without changing the claim's identity.

These names are a design vocabulary, not all accepted API values. The current runtime supports `READS_SOURCE`, `READS_ENTITY`, `READS_CLAIM`, and a restricted `REQUIRES` subset as additive `causal_links[]` entries. `REQUIRES` accepts `entity_exists(entity_id)`, `entity_absent(entity_id)`, `entity_attribute(entity_id, attribute, value)`, `fact_value(fact_id, value)`, and `fact_absent(fact_id)`, evaluated against canonical projections before commit and reconstructed entity/fact history before the event's `commit_sequence` during rollback. `entity_absent` treats a destroyed tombstone as absent; `fact_absent` means no valid fact claim exists at that cursor. Conflicted fact values evaluate to `unknown`: commit is rejected, while rollback preserves a still-valid event and lists it in `requires_review_event_ids` if recomputation remains unknown. Direct event causation remains in the legacy `caused_by[]` field; the typed `CAUSES` graph edge is not yet part of this additive link shape. General predicate composition, arbitrary negative-read forms, `PRODUCES`, `OBSERVES`, `EVIDENCE_FOR`, `CONFLICTS_WITH`, and `MAINTAINS` remain unsupported. Stage 1 must reject unknown relationships rather than silently interpret them as supported.

### 3.1 Commit-time preconditions versus invariants

`REQUIRES` is a historical commit-time precondition, not a continuously maintained invariant. `MAINTAINS` is the proposed interval invariant and is deferred.

A `REQUIRES` predicate is evaluated at the event's commit point in the **reconstructed canonical history**, not against the current projection alone. If rollback removes the only support for the predicate before that point, the requiring event is invalidated. If independent valid support keeps the predicate true at that point, the requiring event can remain valid.

This does not mean every later change to P invalidates the earlier event. A later state change does not violate a commit-time precondition.

## 4. Predicate vocabulary under consideration

Candidate predicate forms:

- `entity_exists(entity_id)`
- `entity_attribute(entity_id, attribute, value)`
- `fact_status(subject, attribute, value)`
- `event_occurred(event_id, before_game_time)`
- `predicate_was_false(predicate, observed_at)`

Predicate evaluation should be tri-state: `true`, `false`, or `unknown`. Unknown must not be silently coerced to false.

The final schema must define canonical identifiers, supported attribute values, comparison rules, and the exact relationship between event commit sequence, world revision, and game time.

### 4.1 Recommended historical model for negative observations

A bare `observed_revision` is not sufficient to define historical meaning. `world_revision` is monotonic and advances on transactions including rollback; it is not, by itself, a stable event-history cursor.

Use two separate concepts:

1. **Generation evidence:** an immutable manifest/snapshot identifier describing what was actually available to the model. Rollback never rewrites this record.
2. **Historical assertion point:** a stable event-history cursor (for example, the observed event's commit sequence) at which the predicate was asserted.

**Recommended Stage 1 semantics:** after rollback, evaluate the negative observation against the reconstructed canonical history at its historical assertion point. If the predicate that was asserted false is now true at that point, the observation is no longer consistent with the reconstructed canonical history and its owning event becomes an invalidation candidate. The original manifest remains unchanged as evidence of what the model saw. This is a deliberate historical correction, not a mutation of the old manifest.

This model must be adopted explicitly before implementation. If the product instead wants immutable historical truth (“what the engine exposed then remains a true historical record even after a correction”), the observation should remain historically valid and receive a separate stale/corrected annotation. Those policies are not interchangeable. The proposed default here is reconstructed canonical history because rollback is intended to correct canonically accepted history.

The observation point must be addressable even when several events share the same `game_time`. Do not use game time alone as the history cursor.

**Implemented Stage 1 storage contract:** each committed event record carries a `commit_sequence`, strictly increasing and unique within its `world_id`. It is the event-history cursor and is distinct from `world_revision`, `game_time`, and `event_id`. Allocation and event persistence occur inside the same SQLite transaction. Only committed events expose a sequence: a transaction that aborts before commit creates no historical cursor, so a value calculated inside that failed transaction may be reused. The sequence visible in committed history never decreases or changes, and rollback does not renumber prior events or consume a cursor. Existing events are backfilled in `committed_revision,event_id` order during migration. This cursor is now available in event responses and supports historical reconstruction for the implemented entity-only `REQUIRES` predicates; context-generation cursor binding and broader predicate reconstruction remain future work.

## 5. Event status versus rollback outcome

These are separate axes.

Proposed event statuses:

- `valid`: currently included in the canonical history.
- `invalidated`: excluded because a required commit-time precondition or historical assertion is no longer supported in the reconstructed canonical history.
- `superseded`: replaced by a later event under a specifically defined supersession rule. Supersession is not implemented by this proposal.

Proposed rollback outcomes apply to the **rollback operation**:

- `resolved`: all events and projections covered by the implemented rules were processed; no known ambiguity blocked the operation.
- `partially_resolved`: some classifications or dependent projections were deferred.
- `requires_review`: a specific ambiguity requires an explicit decision.

Per-event diagnostics must use a separate classification/reason field rather than attaching the operation-level `rollback_outcome` to each event.

**Proposed atomicity rule for `partially_resolved`:** the rollback operation is one database transaction. It may commit classifications and projection recomputations only for the fully classified, dependency-closed portion of the affected graph. Events whose classification is unresolved retain their prior event status; projections whose correct value depends on unresolved events are not changed. Status changes, eligible projection updates, audit rows, and the single `world_revision` increment commit together or all roll back together. The operation is `partially_resolved` only if that internally consistent partial result commits successfully; it is not permission to expose half-written database state. If no safe dependency-closed subset can be applied, commit no semantic changes and return `requires_review` without incrementing the revision. A classified event is not eligible for the partial commit merely because its own predicate was evaluated: every dependency needed to establish its resulting status and every projection it would change must also be resolved. If an unresolved event can affect a candidate event or projection transitively, that candidate stays at its prior status and its affected projection stays unchanged unless a separately resolved rule conclusively determines the result without relying on the unresolved branch. For example, if B is invalidated but claim F's recomputed support depends on unresolved D, a C that reads F is not updated until F's support can be resolved. Audit rows for a committed partial result must identify both applied classifications and deferred items; if the operation makes no semantic change, record the review attempt only in operational logs or a separately specified non-mutating diagnostic channel, not as a committed world-state audit transaction. This rule is a proposal and must be tested before runtime implementation.

`causal_completeness = unknown` is a system-wide Stage 1 limitation. It does not, by itself, force every rollback to be `requires_review`; otherwise `resolved` would have no useful meaning. A review reason should identify a concrete unresolved case, such as an unbound manifest, ambiguous legacy predicate, unresolved source conflict, or deferred invariant. A system that cannot determine whether a particular event is affected should not silently label that event definitively valid or invalid.

### 5.1 Conservative runtime behavior for unresolved rollback predicates

The runtime returns structured `requires_review_items` when a valid event's historical `REQUIRES` predicate evaluates to `unknown` and the predicate's target projection is affected by the proposed rollback. Each item includes `event_id`, `reason_code` (`historical_predicate_unknown`), `pre_rollback_status`, the predicate, its tri-state evaluation, and the affected projection reference.

For this case, the runtime applies **no semantic rollback changes**: the root and candidate events retain their statuses, projections and `world_revision` remain unchanged, and no canonical-state rollback audit row is written. The diagnostic response is saved with the idempotency key so an identical retry returns the same review result. `proposed_invalidated_event_ids` reports the candidate set without claiming those events were invalidated. The caller can retry with a new idempotency key after the underlying ambiguity is corrected.

Unknown predicates whose target projections are unrelated to the rollback do not block it. This is a conservative Stage 1 boundary, not a general partial-rollback algorithm: the runtime does not yet compute a dependency-closed partial subset. The ordinary commit path rejects unknown `REQUIRES` predicates, so runtime review tests construct explicitly marked legacy/inconsistent event metadata to exercise this defensive path. Do not interpret those fixtures as normal API-reachable histories.

### 5.2 Deferred `MAINTAINS`

Stage 1 does not accept `MAINTAINS` as a supported causal relationship. The API contract must reject an unsupported relationship rather than silently commit it as though its invariant had been enforced. If a future authoring/analysis layer needs to preserve such a proposal, it may store it as a non-executable review item outside the committed causal contract. It must not be represented as an enforced relationship on a committed event.

## 6. Candidate invariants

These are proposed and require testable definitions before they become normative:

- **INV-1 — declared reads:** every declared read must be present in a trusted, generation-bound manifest; manifest extras do not imply an incomplete read set.
- **INV-2 — monotonic game time:** rollback does not decrease `game_time`.
- **INV-3 — monotonic revision:** each successful rollback transaction increments `world_revision` exactly once.
- **INV-4 — required preconditions:** an event is invalidated for a `REQUIRES` dependency only when that dependency is false at the event's defined commit point in the reconstructed canonical history.
- **INV-5 — completeness:** `causal_completeness` remains `unknown` throughout Stage 1.
- **INV-6 — negative observations:** the manifest is immutable generation evidence; the assertion is evaluated at a stable historical cursor in reconstructed canonical history.
- **INV-7 — source versus claim:** a direct source dependency and a claim dependency have different rollback semantics.
- **INV-8 — review:** review is driven by a concrete unresolved classification, not solely by the general fact that causal completeness is unknown.
- **INV-9 — unsupported relationship:** a relationship type deferred from Stage 1 is rejected by the executable causal contract; it is not silently treated as enforced.

## 7. Test plan

The scenario matrix in [docs/24-causality-test-matrix.md](24-causality-test-matrix.md) is the proposed source of truth for test ordering and setup. Tests must state event order, commit-point predicates, independent sources, rollback root, and expected event/projection/operation status. Tests that depend on a not-yet-implemented historical cursor or typed relationship remain specification tests until the runtime can represent that data.

## 8. Explicitly deferred

- `MAINTAINS` enforcement and interval invariants.
- Reactivation/revival of previously invalidated events.
- Counterfactual proof of causal completeness.
- Confidence scores or provenance-weighted trust.
- A normalized `causal_edges` storage table.
- Rollback/recomputation of NPC processes, timers, knowledge, and StoryBeats.

## 9. Compatibility boundary

The broader proposals in this document do not change runtime behavior unless explicitly identified in `docs/21-stage1-causality-contract.md`. Existing string-based `caused_by`, `depends_on`, and `read_set` metadata remains supported for backward compatibility; `causal_links[]` is an additive typed subset, not proof of causal completeness.
