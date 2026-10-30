# NPC Goal/Plan Repository Interface — Design Contract

**Status:** design contract derived from accepted decision A1 and `docs/98-npc-local-goal-plan-store-contract.md`.
**Date:** 2026-10-30.
**Implementation status:** not implemented. This document defines a repository boundary and operation semantics; it selects a dedicated NPC-owned SQLite database as the target physical store, but does not authorize its implementation, schema, migration, public API, runtime wiring, or automatic action execution.

## 1. Purpose

Define the smallest NPC-owned persistence interface needed to make accepted goals, plan alternatives, current-plan selection, task progress, and Core-result reconciliation durable.

The repository is an adapter around a physically and logically separate NPC-local store. It is not a cognition component and is not a Core service. Pure NPC helpers continue to receive plain values and return decisions/reducer results.

The first implementation slice must preserve the accepted cardinality rule from `docs/98`: multiple candidates may exist for a goal, but no more than one plan is selected as current for that goal at a time.

## 2. Ownership and dependency direction

Allowed dependency direction:

```text
NPC runtime / orchestration
       |
       +----> pure NPC cognition helpers
       |
       +----> NPC GoalPlanRepository interface
                         |
                         v
                 NPC-local store adapter

NPC runtime ---- bounded read request ----> Core AuthorizedReadService
NPC runtime ---- action proposal ----------> Core proposal/approval/commit
NPC runtime <--- verified Core result ----- Core result/recovery path
```

Rules:

- The repository must not import or call Core SQLite storage internals.
- The repository must not decide goal admissibility, generate plans, resolve motives, authorize actions, or interpret world semantics.
- The repository must not call models, schedule work, dispatch actions, or mutate canonical world state.
- Core remains the only authority for canonical world facts, world revisions, proposal state, committed events, and rollback.
- NPC orchestration is responsible for obtaining trusted identity and verified Core evidence before calling repository mutation methods.
- Repository scope is always the exact `(world_id, npc_entity_id)` pair. These values come from trusted runtime binding, never model output.

## 3. Interface shape

The interface is an internal application boundary, not an HTTP endpoint and not a model tool. Names below are proposed stable names for implementation discussion; they do not authorize a public API.

### 3.1 Read decision state

```js
loadDecisionState(scope, options)
```

Input:

- `scope.world_id`
- `scope.npc_entity_id`
- optional `options.goal_id`
- optional bounded inclusion flags for candidates and pending attempts

Returns a bounded snapshot containing:

- requested scope;
- selected goal records and their `goal_revision`;
- current-plan pointer and `plan_selection_revision` for each returned goal;
- current plan revision and ordered steps, if selected;
- candidate metadata only when explicitly requested;
- pending local action-attempt checkpoints only when explicitly requested;
- a repository-local read cursor/schema version for diagnostics.

It must not include canonical world facts or claim that a referenced Core snapshot is current. A caller must reacquire trusted world context from Core before making a world-dependent decision.

### 3.2 Create a plan candidate

```js
createPlanCandidate(scope, candidate, options)
```

The candidate must bind one existing goal, one proposed plan identity/revision, the evidence/snapshot basis, and the expected versions described in `docs/98 §5`.

Semantics:

- validates exact scope and goal linkage;
- validates candidate structure and trusted-generated identifiers;
- records candidate plus idempotency outcome atomically;
- does not alter the goal, current-plan pointer, selected plan, or progress;
- same idempotency key plus same normalized request returns the original candidate result;
- same key plus different request content returns an idempotency conflict.

A model-proposed identifier is data only. Trusted runtime/store code assigns persistent IDs.

### 3.3 Accept a plan candidate

```js
acceptPlanCandidate(scope, candidateId, expected, options)
```

The `expected` object contains:

- `goal_revision`;
- `plan_selection_revision`;
- `current_plan_id` (explicit null allowed);
- `current_plan_revision` (explicit null allowed).

Semantics:

- one atomic compare-and-swap transaction;
- verifies candidate belongs to the exact scope and goal;
- verifies all expected revisions and current-plan identity;
- accepts the candidate as the current plan;
- marks the previous current plan as superseded in selection metadata, without changing its execution lifecycle enum;
- increments `plan_selection_revision`;
- appends exactly one local audit entry and stores the idempotency outcome;
- stale/conflicting requests produce no partial writes.

Only one concurrent candidate acceptance based on the same expected selection state may succeed.

### 3.4 Apply a goal lifecycle transition

```applyGoalTransition(scope, goalId, expectedGoalRevision, transition, evidence)
```

The repository applies a transition only after the caller supplies authenticated evidence appropriate to that transition. It must:

- compare the expected `goal_revision`;
- invoke or validate against the existing pure `transitionNpcGoal` semantics;
- reject terminal or invalid transitions;
- persist the new goal revision, local audit entry, and idempotency outcome atomically.

The repository does not authenticate a caller-reported event merely because it was passed in `evidence`. The trusted orchestration layer must establish the evidence source and provenance. Until an authenticated transition source exists for a transition, that transition remains unavailable for production use.

### 3.5 Record an action attempt

```recordActionAttempt(scope, attempt, options)```

The attempt is an NPC-local durable checkpoint created before handing an action proposal to Core. It binds:

- `attempt_id`;
- goal, plan, plan revision, step, and action identities;
- the local goal/plan selection revisions at attempt creation;
- the Core snapshot pair `(world_revision, commit_sequence)`;
- a stable Core proposal idempotency key and request hash;
- local attempt state such as `prepared` or `awaiting_core_result`.

Local attempt states must not duplicate or impersonate Core proposal states (`pending`, `approved`, `committed`, `cancelled`). The repository does not mark a step completed at attempt creation, proposal creation, or approval.

The record and its idempotency outcome are atomic. Reusing an attempt identity with different content is a conflict.

### 3.6 Reconcile a verified Core result

```reconcileCoreResult(scope, attemptId, verifiedResult, options)
```

The method accepts only a result object supplied by a trusted Core integration/recovery boundary, not a model or arbitrary adapter payload.

Before mutation, the caller must establish at minimum:

- exact Core proposal identity and committed status;
- authoritative `event_id`;
- result world identity;
- resulting `world_revision` and `commit_sequence`;
- linkage between proposal idempotency identity/request hash and the stored attempt;
- linkage between the committed event and the intended step/action.

The repository then performs one local transaction:

1. verifies attempt/scope/goal/plan/step linkage and expected local revisions;
2. verifies that this Core result has not already advanced this step;
3. applies the existing pure `advanceNpcPlan` reducer with the authenticated success event;
4. persists the new plan progress/revision;
5. records the Core result reference and reconciliation outcome;
6. appends one local audit entry.

Duplicate delivery of the same verified result returns the original reconciliation outcome and does not advance the plan again. A different result for an already reconciled attempt conflicts. An unverified, incomplete, or mismatched result remains unresolved/needs-review and does not advance progress.

The repository must not query Core internals itself to manufacture verification. Retrieval/replay of the original proposal result belongs to a trusted Core-facing integration service.

### 3.7 List pending reconciliation work

```listPendingReconciliations(scope, options)
```

Returns a bounded, stable-order page of unresolved local attempts. The caller supplies a strict maximum page size and optional opaque continuation cursor. The operation is read-only.

It must not autonomously retry proposals, approve proposals, commit events, or infer their state.

### 3.8 Read local audit history

```readAudit(scope, options)
```

Returns a bounded, stable-order page of NPC-local goal/plan/candidate/attempt audit entries. It is diagnostic domain history, not a canonical world-event log. Core event IDs may appear only as references.

## 4. Common result and failure semantics

All mutating operations must return explicit typed outcomes rather than ambiguous booleans.

Minimum outcome classes:

| Outcome | Meaning | Mutation |
|---|---|---|
| `applied` | Requested local transition committed | Yes |
| `replayed` | Same idempotent request/result already committed | No additional mutation |
| `stale` | Expected local revision/pointer no longer matches | No |
| `conflict` | Identity, linkage, or idempotency content conflicts | No |
| `review_required` | Evidence missing, unverifiable, or ambiguous | No |
| `non_ready` | Store/record/schema integrity cannot be established | No |

The implementation may use repository-specific error classes, but must preserve these semantics. It must not silently retry with refreshed revisions, rebase a candidate, reset corrupt state, or downgrade an error to success.

## 5. Atomicity and concurrency requirements

The following must be atomic within the NPC store:

- candidate creation plus its idempotency record;
- candidate acceptance plus current-plan pointer, supersession metadata, audit, and idempotency record;
- goal transition plus goal revision, audit, and idempotency record;
- action-attempt creation plus idempotency record;
- Core-result reconciliation plus plan progress, Core result deduplication record, audit, and idempotency outcome.

Compare-and-swap checks must occur inside the same transaction as the corresponding write. A read-then-write check outside the transaction is insufficient.

Uniqueness constraints must cover at least:

- `(world_id, npc_entity_id, goal_id)` goal identity;
- `(world_id, npc_entity_id, plan_id)` plan identity;
- one current-plan pointer per goal;
- candidate idempotency identity within NPC scope;
- action-attempt identity within NPC scope;
- authoritative Core result identity per reconciled step/attempt.

The exact physical schema and index syntax are implementation decisions and remain open.

## 6. Selected storage technology and implementation gate

The selected target is a dedicated NPC-owned SQLite database, physically separate from Core's canonical SQLite database. This is a target technology decision, not implementation authorization. Before creating or opening the NPC database in production, Issue #770's file-identity / SQLite-open TOCTOU security gate must be resolved by a reviewed mechanism that covers this database and supported Windows/POSIX platforms. The mechanism must bind identity validation to the database actually opened; repeated path checks are insufficient. Any implementation must demonstrate:

- isolation from Core's canonical SQLite store;
- atomic multi-record transactions for the operations in §5;
- uniqueness and compare-and-swap under concurrent callers;
- durable writes and crash recovery;
- corruption detection and fail-closed behavior;
- deterministic migration/version handling;
- testability without coupling pure NPC helpers to storage.

SQLite is selected for the NPC store because the required operations need local transactions, uniqueness constraints, and compare-and-swap semantics. The database file and repository boundary must remain distinct from Core's canonical store. Do not share Core's SQLite connection or tables.

## 7. Test contract

Repository implementation is not acceptable until tests exercise the real adapter/store boundary for:

1. exact world/NPC scope isolation on every operation;
2. candidate creation leaves selected state unchanged;
3. same-key/same-content idempotent replay and same-key/different-content conflict;
4. two concurrent acceptances from one expected selection revision: exactly one wins;
5. stale goal revision, plan-selection revision, current plan ID, or current plan revision causes no partial writes;
6. replacement acceptance atomically updates pointer, supersession metadata, audit, and idempotency;
7. invalid or unauthenticated goal evidence cannot mutate lifecycle;
8. attempt creation cannot advance plan progress;
9. pending/approved Core proposals cannot advance plan progress;
10. one verified committed Core result advances exactly one step;
11. duplicate verified result delivery does not advance twice;
12. crash after Core commit and before local reconciliation recovers the original result without a second world effect;
13. mismatched proposal, event, world, attempt, or step linkage fails closed;
14. corrupt/missing store state does not silently reset goals or progress;
15. bounded pagination does not omit or duplicate pending attempts/audit records across stable cursors;
16. pure cognition helpers remain independent of repository/storage modules.

Mocks may test pure helpers, but authorization, Core proposal/approval/commit, result recovery, and rollback evidence must be tested through their real service boundaries.

## 8. Explicitly out of scope

This interface does not implement or authorize:

- goal generation or goal admissibility policy;
- model calls, motive generation, plan generation, or plan scoring;
- multiple simultaneously current plans for one goal;
- autonomous scheduling, dispatch, action execution, or automatic approval/commit;
- canonical world state, world event history, game time, causality, or rollback;
- NPC knowledge, acquisition, provenance, belief, delivery receipts, or Relationship state;
- a Core-to-NPC rollback invalidation feed;
- public API endpoints or model-accessible repository operations.

## 9. Implementation gates

Before implementing the repository adapter, the project must separately settle:

1. first supported goal family and its admissibility owner;
2. trusted NPC decision-context builder and actor/purpose/field policy;
3. NPC actor authorization and player-agency contract for proposed actions;
4. supported action/effect semantics and production dispatcher boundary;
5. trusted Core proposal-result recovery path;
6. Core rollback/invalidation handoff into NPC reconciliation;
7. physical storage choice and migration/backup/recovery policy.

Passing repository unit tests alone cannot close these Core/Host integration gates.
