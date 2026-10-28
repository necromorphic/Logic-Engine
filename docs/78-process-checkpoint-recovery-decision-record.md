# Process checkpoint recovery: Core decision record

**Status: BLOCKED — decision required before implementing reconciliation.**  
**Scope:** Core-owned recovery boundary for issue #243 and the evaluation/recalculation boundary in #262.  
**This document is an evidence/decision record, not authorization to change runtime behavior.**

## Verified behavior already covered

Two narrow restart/idempotency cases have test evidence on separate draft PRs:

- **Failure before successful segment commit:** Draft PR #335 tests a failed checkpoint path that persists the operation as `needs_review`, closes and reopens SQLite, then replays the same idempotency key. The test asserts no canonical time/revision/commit-sequence/event, process progress, trigger completion, or audit residue. Runtime CI passed on the PR's recorded exact head.
- **Successful commit, response lost:** Draft PR #340 tests a successful durable time-advance commit followed by SQLite close/reopen and retry with the same request/idempotency key. It asserts the completed operation is replayed without duplicate canonical state, process progress, trigger state, audit, commit sequence, or events; changed request content under the same key is an idempotency conflict. Runtime CI passed on exact head `adc1f947f4c6e343e3801579fd2b027f6816846a`.

These cases do **not** decide what to do when persisted process state and the segment/operation checkpoint disagree.

## Unresolved case

Issue #243 requires recovery semantics when process records and segment checkpoints are interrupted or stale. The currently verified tests above cover failure/replay and successful-commit/replay separately; they do not establish a source-of-truth rule for contradictory checkpoint evidence.

Until the existing runtime/store code and the owning Core decision establish that rule, the behavior is **unsupported and must fail closed**. Do not infer authority from timestamps, insertion order, or a convenient projection. Do not silently advance process progress, replay effects, or rebuild a checkpoint merely to make records agree.

## Required decisions before a reconciliation implementation

1. **Evidence inventory:** identify the exact existing persisted fields and records that can disagree, and the existing read APIs/transaction boundaries that expose them. No new fields are implied by this list.
2. **Authority rule:** decide, based on existing canonical commit and operation semantics, whether any mismatch can be deterministically reconstructed from existing durable evidence. If not demonstrable, require manual review rather than guessing.
3. **No-write failure behavior:** define what happens for missing, stale, contradictory, or unknown evidence. Until approved, no automatic resume/replan and no canonical mutation are allowed for these cases.
4. **Audit and idempotency:** specify how accepted recovery attempts and rejected mismatches are represented using existing mechanisms; do not invent an audit schema or new idempotency semantics here.
5. **Causal effects:** define how process progress relates to committed milestone events during rollback/rebuild, without treating process completion as NPC knowledge acquisition or player delivery.
6. **Acceptance tests:** after decisions 1–5 are approved, test each accepted and rejected case against the real Core path, including SQLite restart, same-key replay, world isolation, and unchanged canonical state on rejected recovery.

## Explicit non-decisions

This record does not select a reconciliation algorithm, designate one checkpoint as authoritative, authorize automatic repair, or introduce an API/schema/store/cursor/outbox. It does not resolve cross-process prerequisites or authorize automatic replanning. Those remain outside the proven contract.

## Release boundary

- Keep #243 open until its full acceptance matrix is satisfied.
- Keep the broader Core evaluation/recalculation/publication boundary in #262 open until its own source-backed acceptance matrix is satisfied.
- Keep production Memory→NPC **DISABLED / FAIL-CLOSED**; this document grants no release or disclosure authority.
