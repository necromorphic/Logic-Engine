# Process Manager — Core transaction and recovery boundary

Status: **Core ownership boundary and acceptance register; runtime behavior is implemented only to the extent explicitly listed below in the unmerged #248 candidate. This document is not itself runtime implementation or production approval.**

Related work:
- [Issue #243 — first durable Process Manager slice](https://github.com/necromorphic/Logic-Engine/issues/243)
- [Behavioral contract: NPC autonomy and Process Manager](https://github.com/necromorphic/Logic-Engine/blob/main/docs/06-npc-autonomy-and-process-manager.md)
- Shared decisions and handoff: [Logic-Engine — архитектура и реестр требований](https://app.notion.com/p/403a42c0fcaf8145850bcd7cfd9bcdf7)

This document isolates the Core-owned portion of the first process slice: canonical commit, concurrency validation, idempotency, crash recovery, and rollback/rebuild interaction. It does not approve a schema, public API, general process DSL, background scheduler, NPC knowledge grant, or player delivery.

## 1. Ownership boundary

- **Time block:** temporal coordinates, due-milestone planning, deterministic ordering, interruption point, and temporal policy.
- **Core:** canonical-state authority, world/revision/snapshot validation, proposal validation, transaction boundary, event provenance, idempotency, and rollback/rebuild effects.
- **Process Manager (runtime candidate in PR #248):** process identity/definition version, legal lifecycle transitions, durable milestone checkpoints, cancellation/pause/resume semantics, and process-level validation.
- **NPC / delivery:** knowledge acquisition, belief updates, narration, and player notification are separate state transitions. A completed process does not imply any of these occurred.

A process must reuse the existing time-advance, registered-trigger, and Core segment pipeline. No process-specific code may write canonical projections or events outside Core's existing commit boundary.

## 2. Commit invariant and current evidence

For one accepted milestone, these effects must succeed or fail together in the same existing Core segment transaction:

1. validated canonical event/effects for the milestone;
2. event provenance and causal references;
3. process checkpoint transition (current milestone, lifecycle state, and checkpoint version);
4. completion/claim of the corresponding scheduled trigger or equivalent existing scheduler record;
5. the segment/operation checkpoint already owned by the time-advance runtime;
6. the idempotency result for the accepted operation, where that result is persisted by the existing transaction path.

**Invariant:** no observable state may say that a milestone is complete if its canonical effects were rolled back, and no canonical milestone effects may remain committed while the matching process checkpoint says the milestone did not occur.

The #248 draft candidate now has a durable process store and executes milestone completion through the existing Core segment transaction. Its integration tests verify that a process milestone checkpoint and trigger segment commit together, that an injected process-checkpoint failure rolls back the segment, and that the committed process state survives SQLite restart. This evidence is branch-local and unmerged. The broader invariant above remains the acceptance target; not every row in it has been independently proven by the current test suite.

### Failure behavior

- Validation failure before commit: no canonical effect and no checkpoint advance.
- Transaction failure during commit: rollback all writes in the transaction; retry may safely replay the same request.
- Crash after successful commit but before response delivery: replay with the same idempotency key and same request fingerprint returns the stored outcome without duplicating effects.
- Same idempotency key with changed request content: conflict; do not advance time or process state.
- Missing, stale, or contradictory process/segment checkpoint: stop with a typed non-success / needs-review outcome. Never infer completion from a trigger claim alone.
- A process row or checkpoint from another world is never eligible for the current world.

## 3. Concurrency and snapshot validation

Every milestone commit proposal must be bound to the world and canonical snapshot from which it was prepared. The commit gate must reject stale world/revision/commit-sequence evidence using the existing Core contract.

Do not treat the composite snapshot marker as source-event lineage. It detects that the observed canonical snapshot changed; it does not identify which causal inputs changed or prove a milestone remains valid after rollback.

If policy or process definition version is pinned at planning time, that version must be included in the proposal fingerprint. If the active version changes before commit, the owner-approved policy must either invalidate the proposal or explicitly allow the pinned version; do not silently mix versions.

## 4. Idempotency contract

The operation fingerprint should cover, at minimum, the world, process identity, process-definition/version reference, expected process checkpoint version, milestone identity, intended transition, and validated effects/proposal reference. The precise serialized fields are pending the process owner’s identity/version contract.

- Same key + same fingerprint: return the previously committed result.
- Same key + different fingerprint: conflict.
- Different key against an already-consumed milestone/checkpoint: reject as stale or conflicting; do not duplicate canonical effects.
- A failed transaction must not leave a durable idempotency success record detached from its effects.

Do not invent a second idempotency ledger if the existing Core operation/event transaction can own this guarantee.

## 5. Rollback and rebuild semantics

Rollback must not blindly delete every later process milestone, nor preserve progress whose required causal inputs are no longer valid.

Core's existing rollback path computes the invalidated canonical-event closure and calls Process Manager invalidation inside the same SQLite transaction. The current PR #248 candidate then expands direct milestone hits through transitive `prerequisites` in the already-persisted definition and marks completed descendants `needs_review`.

Current guarantee is deliberately bounded:
1. Canonical event rollback/rebuild uses Core's existing causal/projection machinery and provides the invalidated event IDs to Process Manager in the same transaction.
2. Within one process definition, a completed milestone directly supported by an invalidated event and its transitive completed prerequisite descendants are marked `needs_review`; process progress is gated and audited.
3. Pending milestones retain their pending status, but the process is blocked at `needs_review`; no automatic replan or recomputation is implied.
4. The schema has no explicit cross-process prerequisite edge, so causal closure across separate processes is not proven. If a cross-process dependency is unknown or cannot be enumerated, Core must not claim independence or preserve it as verified progress.
5. Deterministic recomputation is not implemented by this slice. Affected progress stays `needs_review` until a separately approved reconciliation/rebuild operation exists.
6. Never infer causation from timestamp order alone. Same-coordinate order is not causal evidence.

The new executable A→B→C integration test on PR #248 verifies within-process closure, audit/progress projection, blocked resume, and SQLite restart. Cross-process closure, proof that unrelated progress is independent, and automatic causal recomputation remain open acceptance items.
 
## 6. Recovery contract and tested slice

Recovery must reconcile the process checkpoint with the existing durable time-advance operation and trigger records. It must not create a second scheduler or wall-clock catch-up path.

On SQLite close/reopen:
- a fully committed milestone is visible exactly once and can be resumed from its committed checkpoint;
- a rolled-back/incomplete transaction leaves no partial milestone effects or false checkpoint;
- an operation that was interrupted between segments resumes only from the last atomically committed segment/checkpoint;
- stale or mutually inconsistent records fail closed into a typed blocked/needs-review state;
- recovery is scoped to one world and does not claim process completion from elapsed wall-clock time.

The process checkpoint and segment checkpoint should normally be transactionally consistent because the milestone invariant requires one transaction. If an existing code path cannot provide that boundary, document the exact limitation and keep that path unsupported for process milestones rather than simulating atomicity in application code.

## 7. Core-owned acceptance test matrix (mixed status)

| Case | Setup / action | Required result |
| --- | --- | --- |
| Atomic success | Valid milestone proposal and matching process checkpoint | Effects, provenance, trigger/segment checkpoint, process checkpoint, and idempotency outcome commit together |
| Pre-commit rejection | Invalid precondition or stale world snapshot | No effects; no checkpoint advance |
| Injected transaction failure | Fail after writing one of the milestone's records but before transaction commit | All milestone writes roll back |
| Response-loss retry | Commit succeeds; caller retries same key and same fingerprint | Same result; no duplicate event/effect/checkpoint transition |
| Key misuse | Reuse key with changed milestone/effects | Conflict; canonical state unchanged |
| Competing checkpoint | Two proposals target the same process checkpoint version | At most one commits; other is stale/conflict |
| Segment interruption | Multi-segment time advance interrupted after a committed segment | Resume from that segment only; no skipped/duplicated milestone |
| Close/reopen | Close SQLite after committed milestone and reopen | Exactly one committed transition; deterministic resume |
| Cross-world replay | Reuse process or operation reference against another world | Rejected; no cross-world effects |
| Rollback invalidates prerequisite | Roll back a causal source needed by a later milestone | Affected progress invalidated or needs-review; unrelated proven-independent progress preserved |
| Unknown dependency | Causal inputs are incomplete or unenumerable | Fail closed; no guessed preservation/replay |
| Same-coordinate conflict | Two milestones produce conflicting writes at one coordinate | Explicit conflict/needs-review; no arbitrary ordering |
| Knowledge/delivery separation | Process completes | No NPC acquisition/belief or player-delivery record is created implicitly |

Status of this matrix: **mixed**. The #248 branch has executable tests for stale revision rejection, competing lifecycle checkpoint versions, idempotent create/advance and lifecycle retries, injected checkpoint failure, interrupted-advance restart, pause/resume/cancel, overdue resume fail-closed, and within-process A→B→C rollback invalidation/restart. These are branch-local tests and do not make the unmerged PR a mainline guarantee. Rows not explicitly covered by those tests remain acceptance requirements, not completed evidence; in particular, cross-world replay coverage, response-loss replay at every commit boundary, full causal recomputation, cross-process closure, and proof that unrelated progress is independent must not be marked complete without direct tests.

## 8. Decisions required before schema/API work

| Question | Proposed owner | Safe fallback | Closure evidence |
| --- | --- | --- | --- |
| What is the stable process identity and process-definition version? | Time + Core | No persisted process API yet | Identity/world-isolation contract and negative tests |
| Which lifecycle states/transitions are legal? | Time proposes; Core validates canonical effects | Reject unknown transitions | State table and transition tests |
| Which existing record owns trigger claim/completion? | Time + Core | Reuse existing trigger lifecycle; no duplicate scheduler record | Integration test against real segment transaction |
| What is the canonical checkpoint version and concurrency token? | Core | Stale/unknown checkpoint blocks | Competing-update test |
| How are causal inputs and outputs identified for rollback? | Core, with Time providing milestone references | needs-review when dependency closure is unknown | Rollback/rebuild integration tests |
| Can a policy/process-definition change invalidate a scheduled milestone? | Core + Time | Reject stale version until explicit rule | Version-change race test |
| How are cancellation and interruption distinguished? | Time proposes; Core persists validated transition | No ambiguous implicit cancellation | Restart and repeated-cancel tests |
| What records player/NPC awareness? | NPC / delivery owner, separate from process completion | No implicit knowledge or notification | Negative integration test |

## 9. Completion gate

The first runtime slice now exists on draft PR #248 and reuses the existing store/transaction seam, registered triggers, scheduler, and time-advance pipeline. The current branch evidence is not yet a merged or production guarantee. Remaining closure gates are cross-block review, explicit tests for any unverified matrix rows, safe branch refresh against current main, and the unresolved causal-rebuild scope described above. Do not describe the runtime as absent; do not describe all proposed invariants as implemented.


## Cross-block follow-up evidence (24 Oct 2026)

The following are executable branch tests in the companion Process Manager runtime candidate (#248), not tests contained in this documentation-only PR:

- **Stale canonical revision:** process creation with a stale `expected_revision` fails with `REVISION_CONFLICT`; no process, trigger, process-created audit record, or world-revision mutation is allowed.
- **Competing process checkpoints:** two lifecycle commands target the same expected process version; one accepted transition increments the version and creates one lifecycle audit record; the competitor fails with `PROCESS_VERSION_CONFLICT` and no second transition.
- **Rollback/rebuild boundary:** Core rollback returns the invalidated event closure; #248 tests the completed A→B→C chain, process/milestone `needs_review`, resume gating, audit affected IDs, and persistence after SQLite reopen. The existing Core rollback/rebuild path remains the canonical owner.
- **Atomicity/recovery:** #248's injected process-checkpoint failure verifies the existing Core segment transaction does not leave a partial time advance or completed process milestone. Its interruption/restart test verifies continuation from the last committed segment.
- **Idempotency/lifecycle:** #248 covers create/advance replay, pause/resume/cancel retries, key-content conflict, and stale competing lifecycle version.

These tests are evidence only for the exact #248 branch head and do not become mainline guarantees until reviewed and merged. PR #247 remains proposal/boundary documentation, not an implementation of the Core transaction contract.

### Causal scope decision for review

The first slice's causal invalidation scope is **within one process definition only**, using the already-declared `prerequisites` edges. Cross-process causal dependencies are **out of scope for this slice**, because there is no explicit persisted cross-process dependency edge/identity contract. This is a scope boundary, not a claim that cross-process dependencies do not exist. If causal dependency is unknown or cannot be enumerated, do not infer independence: retain affected progress as `needs_review`. Full causal rebuild/recomputation is not complete.

### Overdue replan contract

Overdue resume remains fail-closed and must not shift `due_coordinate`. Time's #249 review specifies a separate explicit-replan acceptance contract but adds no API/schema: validate current process version and world revision, explicit proposed due-coordinate changes, prerequisite/conflict/interruption constraints through the existing scheduler, idempotency, and audit retaining old/new coordinates. Until Core and Process Manager approve the precise operation, overdue processes stay paused and no replan is implied.
