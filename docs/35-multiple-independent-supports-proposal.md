# Proposal: multiple independent supports and rollback reconciliation

Status: **proposal for review; not runtime behavior or an approved ADR**.

Scope: clarify the boundary between causal dependency and independently sufficient support, using the existing append-only event/fact-claim model. This document does not authorize new runtime behavior by itself and does not replace `docs/18-rollback-and-causality.md`, `docs/21-stage1-causality-contract.md`, the rollback decision proposal in `docs/decisions/ADR-0006-rollback-semantics.md`, or the executable/specification matrix in `docs/24-causality-test-matrix.md`.

## 1. Problem statement

A single record can have several distinct relationships to other records:

1. **Causal origin** — an event directly produced another event.
2. **Validity dependency** — an event remains valid only while a predicate holds.
3. **Observed input** — an event read a particular historical projection or claim.
4. **Independent support** — a source independently supports the same proposition or knowledge state.

These relationships must not be collapsed into one generic dependency edge. In particular, two sources supporting the same fact do not mean that one source caused the other, and deleting one source must not automatically delete the proposition if another valid, sufficient source remains.

The converse is equally important: the existence of a second source does not automatically preserve a dependent event. Its actual historical preconditions and observed state must still be reconciled.

## 2. Proposed decisions

### D1. Keep canonical identity separate from claims and supports

- A canonical fact identity is the stable key for the proposition being projected (currently represented by `fact_id`, with identity fields such as `subject_ref` and `predicate`).
- A fact claim is one event's assertion for that identity and value.
- Each claim keeps its own source event identity. Two equal claims are two supports, not one duplicated fact.
- A source/support record must not be treated as a causal parent unless a separate causal relationship exists.
- A claim from an invalidated/retracted event is not a valid support in the current projection, though its audit history remains.

This preserves the current append-only claim model. Do not introduce a parallel support table for fact claims unless implementation research demonstrates a concrete missing capability: the existing `fact_claims` rows already distinguish claims by world, fact, and source event.

### D2. Recompute a proposition from remaining valid claims

For one canonical fact identity, evaluate only claims from currently valid events:

| Remaining valid claims | Current projection |
| --- | --- |
| No claims | No active canonical claim |
| One value, one or more supporting claims | That value is active |
| Multiple claims, all asserting the same value | That value is active; retain all source event IDs |
| Incompatible values remain | Explicit `conflicted` projection; consumers must not select a value by last-write-wins |

Removing one of two identical claims must leave the value active. Removing one side of a conflict must leave the surviving value active if it is the only remaining valid value. Removing the last support must remove the active value from the projection.

The runtime already rebuilds fact projections and claim rows from valid events during rollback, and marks incompatible remaining claims as conflicted. Treat those as existing guarantees only to the extent covered by current tests; do not reimplement them in a new support subsystem.

### D3. Reconcile dependent events against their recorded semantics

After a root event is retracted, each candidate dependent event must be handled using the existing declared metadata and historical projection rules:

- **Preserve** if the event is still valid under its recorded preconditions and the relevant historical projection remains semantically equivalent after invalidation.
- **Invalidate** if a required predicate becomes false, or a declared read/claim materially changes in a way that makes the event's result invalid.
- **Require review** if a required predicate cannot be evaluated safely or the current contract cannot distinguish preservation from invalidation.
- **Never preserve merely because an alternative source exists.** The alternative source must actually sustain the predicate/value the dependent event relied on.
- **Never invalidate merely because a source was removed.** If another valid support keeps the relevant projection equivalent, the dependent event may remain valid.

The existing `READS_CLAIM` behavior is a key example: removing one of two equal claims can preserve a reader; removing one side of a conflict can change the projection and invalidate a reader. Keep this behavior distinct from direct event causation.

A historical `REQUIRES` predicate remains a commit-time precondition evaluated against reconstructed history. It is not a continuously maintained invariant and does not imply that every later state change invalidates the event.

### D4. Unknown is not false, and ambiguity must be explicit

If the engine cannot establish whether a remaining source is independent, valid, or sufficient, it must not infer support from textual similarity, timestamps, or caller-provided labels alone.

- A decisive false predicate can invalidate an event.
- An unknown predicate that materially affects the rollback decision must produce a structured review diagnostic and no unsafe partial mutation.
- A conflicted fact evaluates as unknown for predicates that require a single value.
- Caller-supplied `caused_by`, `depends_on`, `read_set`, or evidence labels are declarations, not proof that the causal graph is complete.

### D5. Knowledge and process support are separate future contracts

Do not assume that fact-claim behavior automatically solves NPC beliefs, memories, evidence, deliveries, long-running processes, timers, or StoryBeat state. Those records do not all exist in the current runtime.

For a future knowledge subsystem, distinguish at least:
- source validity (did the source event still happen?);
- epistemic history (did the character actually receive/believe the information in-world?);
- current assessment (known, suspected, disputed, retracted, or another explicitly defined status);
- sufficient independent support for the current assessment.

A rollback that erases an event as never having happened differs from a later discovery that a real in-world source was false. The former may retract knowledge acquired only from that event; the latter may preserve the character's historical belief while updating its assessment. Exact statuses and transitions require a separate knowledge contract.

For processes, record checkpoints and their inputs/outputs before attempting partial reconciliation. A process stage must not be preserved or discarded just because it is temporally before/after a rolled-back event.

### T-11 boundary: unresolved branches and partial rollback

The current runtime has regression coverage for an affected historical `REQUIRES` predicate that evaluates to unknown: it returns `requires_review` and applies no semantic changes. It also verifies that an unrelated unknown predicate does not block a separate rollback. Those cases do **not** implement the broader T-11 scenario in `docs/24-causality-test-matrix.md`.

T-11 additionally requires representing an unresolved source/branch whose status may change the support projection, then proving which subset of classifications and projection updates is dependency-closed. The current event model does not provide a general unresolved event classification or a generic partial-resolution algorithm. Do not simulate this by marking a source valid/invalid speculatively, and do not begin partial commits until the atomicity rule in `docs/22-causality-semantics.md` §5 is promoted to a tested contract. Until then, the safe current-runtime behavior is the implemented no-op review result for the narrower unknown-`REQUIRES` case.

## 3. Existing implementation versus gaps

### Already present in the current runtime (verify against tests when changing)

- Event-sourced fact claims retain their source event IDs.
- Rollback rebuilds projections from currently valid events.
- Equal claims can support one active value.
- Incompatible valid claims produce a conflicted projection.
- The supported typed `READS_CLAIM` relation compares relevant historical projection before and after proposed invalidation.
- A rollback that encounters a materially changed required read may invalidate the reader; unsupported/unknown cases can require review.

### Not established by those mechanisms

- General evidence/provenance graph with typed independent-support semantics.
- NPC belief and knowledge-source reconciliation.
- Partial reconciliation of long-running process checkpoints.
- Timer and StoryBeat recomputation.
- Proof that caller-supplied dependency metadata is complete.
- SillyTavern message/generation-to-event mapping and host-triggered rollback.

Do not describe these future capabilities as implemented just because fact claims support multiple sources.

## 4. Acceptance matrix

The following tests refine the RB-001–RB-010 target contract. Existing tests should be located and reused before adding duplicates.

| Case | Setup | Expected result | Status boundary |
| --- | --- | --- | --- |
| MS-001 / RB-004 fact case | Two valid events assert the same fact value; retract one | Fact remains active, surviving source remains recorded | Current-runtime behavior; retain regression coverage |
| MS-002 | Two events assert incompatible values; retract one | Remaining valid value becomes active, not conflicted | Current-runtime behavior; retain regression coverage |
| MS-003 | Retract the last valid claim for a fact | No active value remains | Current-runtime behavior; retain regression coverage |
| MS-004 | A reader declares `READS_CLAIM` for a fact with two equal claims; retract one | Reader remains valid if the relevant historical projection is unchanged | Current-runtime behavior; retain regression coverage |
| MS-005 | A reader declares `READS_CLAIM` for a conflicted fact; retract one side of the conflict | Reader is invalidated if the projection it relied on materially changes | Current-runtime behavior; retain regression coverage |
| MS-006 | Same fact identity is claimed with inconsistent identity fields across valid history | Commit is rejected before writes, or a migration/replay produces an explicit review error; projection must not silently inherit identity fields from the last claim | Contract/implementation audit required |
| MS-007 | One knowledge item has two independent valid sources; retract one | Knowledge remains only if the remaining source meets the defined threshold/status rule | Future knowledge subsystem |
| MS-008 | One process checkpoint depends on a rolled-back branch but also has independent progress | Reconcile affected checkpoint and preserve only independently justified progress | Future process subsystem |
| MS-009 | A support is merely later in time, with no causal/evidence relation | It does not preserve the earlier proposition by chronology alone | Contract invariant |
| MS-010 | A required predicate is unknown after retraction | Return structured review; do not guess or apply a partial semantic rollback | Current contract boundary; verify all relevant paths |
| MS-011 | A source is invalidated but an independent event has already occurred based on it | Reconcile through declared reads/preconditions; if safe resolution is unavailable, emit conflict/review rather than silently retconning the independent event | Broader rollback contract |

### Test method

1. Existing coverage has been located: `tests/core.test.js` contains `conflicting independent fact claims are not silently resolved`; `tests/causality-contract.test.js` contains rollback cases for a `READS_CLAIM` reader when another valid source preserves the projection and when a claim loses its only source. `docs/24-causality-test-matrix.md` documents the broader T-06 cases and identifies which parts are executable versus proposed.
2. Before adding tests, inspect those cases in full and confirm they assert both the resulting projection and the reader event's validity/review diagnostics. A projection-only assertion is not enough for MS-004/MS-005.
3. For each added test, assert both current projection and event validity/review diagnostics.
4. Run the repository's documented test command on the exact proposed commit.
5. Do not claim the broader RB-004 knowledge case is covered by fact-claim tests.


### MS-012 — later support must not retroactively justify a historical read

Setup:
1. Event A commits a claim for fact F at cursor 1.
2. Reader R commits at cursor 2 with a declared `READS_CLAIM(F)` relationship; at R's commit point, A is the only valid support.
3. Independent event B commits the same claim at cursor 3. B has no causal or validity dependency on A and does not read A.
4. Roll back A.

Expected:
- Reconstruct the projection relevant to R at R's historical commit cursor, excluding invalidated events and events committed after R.
- B must not retroactively make R's historical read valid merely because B supports F in the present-day projection.
- If removing A changes the relevant projection at R's cursor, classify R using the current rollback contract (invalidate when the declared read materially changes; otherwise use the contract's explicit review outcome).
- The current projection after cursor 3 may still contain F supported by B; that does not alter what was available to R at cursor 2.

Status boundary: executable coverage is already present on `main` in `tests/causality-contract.test.js` as `READS_CLAIM cannot use a later source to retroactively support an earlier reader`. It asserts that rolling back A invalidates R even though later source B remains valid and the current projection still contains F. Reuse and preserve this test when integrating the stack; do not add a duplicate test, new runtime API, or support table for the case.

## 5. Identity and migration guardrail

Fact identity must be checked across all valid claims that contribute to the same canonical `fact_id`. A projection reconstructed from the last claim is not sufficient evidence that earlier claims share the same identity.

Before any identity-contract implementation is merged:
- reject duplicate `fact.set` claims for the same `fact_id` in one event before persistence, because the current claim key cannot represent them separately;
- validate that every remaining valid claim for a `fact_id` has compatible `subject_ref` and `predicate`;
- reject surrounding whitespace for identity fields at the translation/commit boundary rather than silently trimming or preserving padded variants;
- preserve valid, unpadded identifier strings exactly;
- make rollback reconstruction and direct commit enforce the same identity rule;
- test legacy histories and fail safely with a diagnostic if they violate the newly enforced invariant.

These points must be reconciled with the fact-identity proposal and mechanic-effect translator before the relevant PRs are integrated. This document alone does not settle those PRs or authorize a migration.

## 6. Non-goals

This proposal does not:
- implement a generic evidence graph or confidence scoring;
- add knowledge/process/timer/StoryBeat tables;
- make message or generation rollback work in SillyTavern;
- infer causality from text, time, or prompt co-presence;
- change the existing HTTP API;
- assert causal completeness;
- authorize merging the identity or mechanic-intent PRs.

## 7. Review checklist / decisions still open

The following points need explicit architecture review before an implementation PR is opened:

1. Is the existing event-backed `fact_claims` representation sufficient for canonical facts, with richer evidence records reserved for future knowledge/evidence modules?
2. Which typed relationship should represent independent support (likely a separate `EVIDENCE_FOR` or support record), and which target record types may use it?
3. What is the minimum validity rule for a knowledge status: one valid source, a source class, or a World Pack-defined policy? Do not invent numeric confidence.
4. When a source is removed but a dependent event has already produced irreversible in-world consequences, which cases require `ConflictRecord` rather than invalidation?
5. What exact structured diagnostic is returned when support validity or sufficiency is unknown?

Until these decisions are reviewed, implement only regression tests for behavior already promised by the normative current-runtime contract; do not expand runtime semantics based on this proposal.
