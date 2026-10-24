# Process Manager — Core transaction and recovery boundary

Status: **proposal for review; not a runtime contract yet**.

Related work:
- [Issue #243 — first durable Process Manager slice](https://github.com/necromorphic/Logic-Engine/issues/243)
- [Behavioral contract: NPC autonomy and Process Manager](https://github.com/necromorphic/Logic-Engine/blob/main/docs/06-npc-autonomy-and-process-manager.md)
- Shared decisions and handoff: [Logic-Engine — архитектура и реестр требований](https://app.notion.com/p/403a42c0fcaf8145850bcd7cfd9bcdf7)

This document isolates the Core-owned portion of the first process slice: canonical commit, concurrency validation, idempotency, crash recovery, and rollback/rebuild interaction. It does not approve a schema, public API, general process DSL, background scheduler, NPC knowledge grant, or player delivery.

## 1. Ownership boundary

- **Time block:** temporal coordinates, due-milestone planning, deterministic ordering, interruption point, and temporal policy.
- **Core:** canonical-state authority, world/revision/snapshot validation, proposal validation, transaction boundary, event provenance, idempotency, and rollback/rebuild effects.
- **Process lifecycle owner (to be confirmed by the Time/Core handoff):** process identity, legal state transitions, cancellation/pause/resume semantics, and process-level validation.
- **NPC / delivery:** knowledge acquisition, belief updates, narration, and player notification are separate state transitions. A completed process does not imply any of these occurred.

A process must reuse the existing time-advance, registered-trigger, and Core segment pipeline. No process-specific code may write canonical projections or events outside Core's existing commit boundary.

## 2. Proposed commit invariant

For one accepted milestone, these effects must succeed or fail together in the same existing Core segment transaction:

1. validated canonical event/effects for the milestone;
2. event provenance and causal references;
3. process checkpoint transition (current milestone, lifecycle state, and checkpoint version);
4. completion/claim of the corresponding scheduled trigger or equivalent existing scheduler record;
5. the segment/operation checkpoint already owned by the time-advance runtime;
6. the idempotency result for the accepted operation, where that result is persisted by the existing transaction path.

**Invariant:** no observable state may say that a milestone is complete if its canonical effects were rolled back, and no canonical milestone effects may remain committed while the matching process checkpoint says the milestone did not occur.

This is a proposed acceptance invariant derived from issue #243, not a claim that a process table or transaction path currently exists.

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

Proposed conservative rule:
1. Each committed milestone records causal input references and the canonical event/effect references it produced.
2. When rollback/rebuild invalidates a causal input, Core computes the affected process-milestone dependency closure only where the declared dependency contract is complete.
3. If a milestone is provably independent of the invalidated input, it may remain valid.
4. If deterministic recomputation is supported and all required inputs/policies are available, recomputation must produce a new validated proposal and commit through Core; it must not mutate history silently.
5. If dependency completeness, source validity, or recomputation semantics are unknown, mark the affected process progress as stale/needs-review and block further progression until reviewed.
6. Never infer causation from timestamp order alone. Same-coordinate order is not causal evidence.

Open decision: whether process progress is represented as append-only transition history plus a current projection, or as a mutable checkpoint with event-level causal references. Choose only after inspecting existing event/projection conventions and demonstrating rollback/rebuild behavior in tests. Do not add a parallel event store.

## 6. Recovery contract

Recovery must reconcile the process checkpoint with the existing durable time-advance operation and trigger records. It must not create a second scheduler or wall-clock catch-up path.

On SQLite close/reopen:
- a fully committed milestone is visible exactly once and can be resumed from its committed checkpoint;
- a rolled-back/incomplete transaction leaves no partial milestone effects or false checkpoint;
- an operation that was interrupted between segments resumes only from the last atomically committed segment/checkpoint;
- stale or mutually inconsistent records fail closed into a typed blocked/needs-review state;
- recovery is scoped to one world and does not claim process completion from elapsed wall-clock time.

The process checkpoint and segment checkpoint should normally be transactionally consistent because the milestone invariant requires one transaction. If an existing code path cannot provide that boundary, document the exact limitation and keep that path unsupported for process milestones rather than simulating atomicity in application code.

## 7. Core-owned acceptance test matrix

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

These are proposed tests; they are not represented as existing tests or executed evidence.

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

This Core slice is ready for implementation only when the Time block returns its state/transition and milestone contract, existing Core transaction paths are confirmed to support the atomicity invariant, and the rollback policy is sufficiently precise to test. Then implement the smallest vertical slice against the existing store/transaction seam, add failure injection and restart tests, and report exact-head Runtime CI.

Until then this file is an architectural proposal and test plan only. It does not claim that Process Manager runtime, schema, API, rollback integration, or production readiness exists.
