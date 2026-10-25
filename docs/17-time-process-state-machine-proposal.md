# Time-owned Process Manager contract reconciliation

**Status:** Time review of the existing Core runtime draft; no second process model or scheduler is introduced here.

Related work:
- [Issue #243 — Process Manager acceptance](https://github.com/necromorphic/Logic-Engine/issues/243)
- [Core transaction/recovery boundary, PR #247](https://github.com/necromorphic/Logic-Engine/pull/247)
- [Core durable Process Manager runtime, PR #281](https://github.com/necromorphic/Logic-Engine/pull/281)
- [Shared architecture and decision register](https://app.notion.com/p/403a42c0-fcaf-8145-850b-cd7cfd9bcdf7)

## Contract agreed for review

The merged runtime slice in #281 owns the durable process definition, lifecycle records, trigger registration, and process persistence. Time's responsibility is to verify that its milestone semantics are compatible with the existing deterministic scheduler and time-advance pipeline. This PR must not introduce a second process lifecycle implementation.

The runtime behavior below was checked against the merged #281 implementation and tests. This document records the observed boundary, not a promise that unimplemented operations exist.

The shared contract is:

- **Identity:** `process_id` is unique within `world_id`; `definition_version` identifies the authored definition. `milestone_id` identifies a milestone within the process. `trigger_id` identifies the existing scheduler record and is not the process identity.
- **Definition shape (verified in `src/application/engine.js::createProcess`):** each milestone uses `due_coordinate`, `prerequisites` (milestone IDs), `read_set`, `write_set`, and an event proposal. The engine builds a milestone-ID → declared `trigger_id` map, then calls `registerTimeTrigger` with prerequisite IDs mapped to trigger-ID `dependencies`. The scheduler receives its existing trigger shape; it does not consume process milestone IDs directly.
- **Temporal rule (observed):** process-definition validation rejects unsafe coordinates, non-future creation coordinates, prerequisites scheduled later than their dependents, and cycles. Equal-coordinate prerequisites are passed to the existing planner as trigger dependencies; deterministic dependency order is applied there. The planner rejects unresolved read/write conflicts and honors interruption boundaries. These are separate validation layers, not a new process scheduler.
- **Lifecycle:** `scheduled`, `running`, `paused`, `completed`, `cancelled`, `failed`, `needs_review`. Resume is an operation returning to `scheduled`, not a stored state. It must mint fresh trigger IDs for pending milestones only when their original due coordinates remain in the future; overdue resume fails with `PROCESS_RESUME_REQUIRES_REPLAN`.
- **Commit authority:** Time proposes due work and interruption boundaries. Core validates current world/revision and event proposals, and commits canonical effects plus process/trigger/segment checkpoints atomically through the existing segment transaction.
- **Rollback:** Core owns canonical rollback/rebuild. PR #281's current candidate expands invalidation from directly affected milestones through transitive `prerequisites` within the same process definition; completed descendants become `needs_review`, the process is gated, and the update is audited in the rollback transaction. Cross-process dependency closure and automatic recomputation remain unsupported; unknown causality stays `needs_review`.
- **Knowledge/delivery:** process completion does not grant NPC knowledge, update beliefs, create reports, or notify the player.

## Ownership by PR

- **#247 — Core boundary:** proposal/test matrix for atomicity, snapshot validation, idempotency, recovery, and rollback/rebuild. Documentation-only; not itself runtime implementation.
- **#281 — Core runtime slice (merged):** durable process/milestone storage and lifecycle operations over existing triggers and segment transactions. Merge plus passing CI establishes repository integration, not production approval or complete cross-process causal reconstruction.
- **#249 — Time contract review:** tests the existing scheduler semantics using process-shaped milestone fixtures and records any mismatch. It must not duplicate #281's runtime contract or add a second scheduler.

## Time-owned acceptance

1. Deterministic due ordering and same-coordinate declared prerequisite boundaries.
2. Missing, cancelled, not-yet-due, and cyclic prerequisites fail closed without a partial plan.
3. Same-coordinate read/write conflicts without a declared causal order require review.
4. Pure planner: interruption returns the stop coordinate, includes eligible work at that coordinate, and leaves later triggers unplanned. A second planner call with a simulated completed-trigger snapshot tests planner behavior only; durable interruption/restart/continuation is verified separately by the merged #281 integration suite.
5. Durable interruption + SQLite close/reopen + continuation of the same process is covered by the integration tests merged through #281; Time's scheduler tests are complementary, not a replacement for that real-path test.

The #249 tests are **pure scheduler tests with a fixture adapter**, not end-to-end runtime tests. Every fixture milestone declares a `trigger_id`; the adapter maps prerequisite milestone IDs only to those declared IDs and uses an explicit unresolved-dependency sentinel for deliberately missing prerequisites. It calls `planDueWork` directly and does not exercise persistence, API routing, lifecycle transitions, or the Core transaction. The merged #281 integration suite is the evidence for the real registered-trigger → time-advance → Core transaction path, including pause/resume restart and A→B→C rollback/restart. These results prove only within-process prerequisite invalidation, not cross-process causal rebuild. The overall issue remains open until the cross-PR review and all required acceptance evidence are complete.


## Overdue resume and explicit replan contract (review proposal; no runtime API added)

- **Resume is not replan.** If any pending milestone's persisted `due_coordinate` is at or behind the world's confirmed game-time coordinate, resume returns `PROCESS_RESUME_REQUIRES_REPLAN`, leaves the process paused, and preserves every due coordinate and checkpoint version. It must not catch up by wall clock or silently shift dates.
- **Replan must be explicit and separately authorized.** It is not part of `resume`, does not run automatically after restart, and does not add a second scheduler. It must use the existing process definition + registered-trigger + Core transaction path, with Time validating the proposed temporal plan and Core validating current world revision and atomically committing any approved canonical/checkpoint changes.
- **Inputs/validation required before implementation:** current process identity and checkpoint version; current world revision/confirmed coordinate; explicit proposed due-coordinate changes for named pending milestones; unchanged/approved definition version semantics; prerequisite order, scheduler conflicts, interruption boundaries, and due coordinates all revalidated against the existing scheduler. No timestamps alone may infer causal ordering.
- **Required outcome:** stale process version/revision, missing causal inputs, invalid prerequisites, or unresolved conflicts fail closed with no mutation. A successful replan must preserve the prior plan in audit, record old/new coordinates and the accepted plan identity/version under a Core-approved audit contract, and be idempotent for an identical request; key reuse with changed content conflicts. The old plan is not overwritten without retained audit provenance.
- **Not implemented / needs approval:** there is no replan endpoint or operation contract in the current runtime slice. The bullets above are acceptance requirements for owner review, not an invented API/schema. Until Core and Process Manager approve the exact operation/identity/version semantics, overdue processes remain paused and overdue resume remains rejected.

## Acceptance status after Core integration tests

PR #281's current integration branch adds explicit stale-revision rejection and competing lifecycle checkpoint tests through the existing runtime path. These tests must assert no process/trigger/audit side effects on stale revision and exactly one successful audited transition when two commands target the same checkpoint version. They do not prove multi-process causal closure or automatic rebuild/replanning.
