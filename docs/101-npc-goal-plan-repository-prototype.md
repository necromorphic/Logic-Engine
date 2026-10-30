# NPC Goal-Plan Repository — implementation prototype

**Status:** Draft prototype; not wired into production NPC orchestration.

This document records the implementation branch for the repository boundary in docs/99-npc-goal-plan-repository-interface-contract.md. It does not replace or waive the production gates in docs/99 §9 or the readiness audit in docs/100.

## VFS feasibility status

The minimal same-engine VFS spike in current-main Draft PR #839 passed Windows and Linux in CI run #41110835234: `node:sqlite`/SQLite 3.47.2 default-VFS registration, WAL/SHM/rollback-journal opens, sidecar alias/replacement checks, directory anchoring and concurrent/worker opens. A clean rerun after temporary diagnostic removal is pending. This is a feasibility result, not production approval: POSIX `xDelete` still has a same-directory replacement race, and persistent identity ownership, complete I/O/locking/recovery coverage, production database-role wiring and independent Security review remain open. The repository continues to accept only an injected connection and never opens a path itself. The generic repository prototype is being implemented under explicit project-owner direction; this does not waive docs/99 §9. The first goal family/admissibility owner, trusted decision context, actor/player-agency policy, dispatcher, Core result recovery and rollback handoff remain unsettled, so no goal family is enabled or production-wired.

## Progress

| Area | State | Progress |
|---|---|---:|
| Repository interface and isolated schema | Prototype implemented | 100% |
| CAS, idempotency and audit | Implemented in adapter | 100% |
| Pending-attempt persistence and reconciliation reducer | Implemented behind injected verifier | 100% |
| Windows/Linux contract tests | Current-main port: 21/21 targeted on each OS; Linux full Runtime 1400/1400. Self-hosted Windows full Runtime job remains queued. Source prototype full suite: 1208/1208 on both OS. | 100% |
| Production secure SQLite open | Blocked by VFS identity/TOCTOU gate | 0% |
| Trusted runtime callers and authorization | Not wired | 0% |
| First supported goal family and real dispatch cycle | Not implemented | 0% |

## Boundary

createNpcGoalPlanRepository({ database, ... }) accepts an already-open synchronous SQLite connection. It does not open a path, create a database file, choose a VFS, or access the Core database.

Production composition must inject a separately secured NPC-local database connection only after the VFS secure-open gate is proven. Tests use DatabaseSync(':memory:').

The repository owns NPC-local goals, plan candidates, accepted plan revisions, action-attempt checkpoints, reconciliation records, idempotency outcomes and audit rows. Core remains authoritative for canonical world facts, world revisions, proposal state, committed events and rollback.

## Implemented operations

| Contract operation | Current behavior |
|---|---|
| loadDecisionState | Bounded, scope-filtered read inside one SQLite read transaction; returns goal revisions and selected plans, with optional bounded candidates and pending attempts. |
| createPlanCandidate | Stores a candidate without selecting it. Store generates candidate, plan and step IDs; normalizes the initial active step; captures the caller-supplied world revision/commit sequence; uses request-hash idempotency. |
| acceptPlanCandidate | Uses goal revision and full current-plan pointer CAS. Supersedes the prior current revision and updates the single current-plan pointer atomically. |
| applyGoalTransition | Delegates lifecycle transition to the existing pure reducer. Requires an injected trusted-evidence verifier; otherwise returns review_required. |
| recordActionAttempt | Requires the exact active step and current goal/plan revisions. Persists the Core proposal idempotency key and request hash before dispatch. Prevents a second outstanding attempt for the same step. Does not advance plan progress. |
| reconcileCoreResult | Requires an injected trusted Core-result verifier. Checks scope, proposal idempotency key, request hash, goal/plan/step/action linkage, current revisions and monotonic Core commit sequence before invoking the pure plan-progress reducer. Duplicate results do not advance twice. |
| listPendingReconciliations | Returns bounded pending attempts with a monotonic SQLite rowid cursor. |
| readAudit | Returns bounded audit pages with an AUTOINCREMENT sequence cursor. |

An additional createAcceptedGoal seam exists because the eight-method contract has no goal-admission insertion operation. It requires an injected goalAdmissionVerifier; without one, goal creation returns review_required. This seam delegates admissibility and does not define a goal family.

## Storage and consistency

Schema version 1 is NPC-local and contains:

- npc_goals
- npc_goal_selection
- npc_plan_revisions
- npc_plan_candidates
- npc_action_attempts
- npc_core_reconciliations
- npc_idempotency
- npc_audit

Mutations use BEGIN IMMEDIATE transactions. Decision-state reads use a single read transaction. The schema enforces one current plan per goal and one pending attempt per active step. Versioned stores are rejected if required tables or indexes are missing; an unversioned partial database is never silently reset.

Idempotency is scoped by (world_id, npc_entity_id, operation, idempotency_key). For action attempts, the Core request hash is kept distinct from the hash of the full local checkpoint, so reusing a proposal key with a different goal, plan, step or snapshot conflicts.

All reads and writes use the exact (world_id, npc_entity_id) scope. Scope identifiers are not silently trimmed or normalized.

## Explicit fail-closed seams

The three verifier callbacks are integration seams, not production trust implementations:

- goalAdmissionVerifier
- goalEvidenceVerifier
- coreResultVerifier

No caller-provided verified=true flag is accepted as proof. If the relevant verifier is absent or does not synchronously return true, the operation does not mutate state.

The repository does not query Core to manufacture evidence, authorize actions, call a model, schedule work, dispatch an action, or mutate canonical world state.

## Open production gates

1. **VFS secure open:** current-main Draft PR #839 has passed the minimal same-engine feasibility matrix on Windows and Linux at exact-head CI run #41110835234: Node 22.13.0 / SQLite 3.47.2 registration, WAL/SHM/rollback-journal opens, sidecar alias/replacement checks, directory anchoring and concurrent/worker opens. A clean rerun after removing temporary diagnostics is pending. This is not production approval: Linux `xDelete` still has a same-directory name-replacement race; role and sidecar ownership are process-local; persistent identity manifests, complete `sqlite3_io_methods`/locking/WAL/temp/recovery coverage, startup/restart integration and independent Security review remain open. The uploaded ST-VectorService uses a separate better-sqlite3 13.0.3 engine and is not covered by this node:sqlite proof. Issue #770 remains open.
2. **Trusted decision context:** no production caller yet supplies a complete trusted NPC decision envelope.
3. **Host completeness:** final-send/lifecycle proof remains incomplete.
4. **Action authorization:** actor identity is not action permission; NPC/player-agency policy and an executable allowlist remain required.
5. **Core result recovery:** the production proposal → committed-event correlation and crash recovery owner is not wired.
6. **Rollback/revocation:** Core rollback or invalidation must invalidate or reconcile affected NPC attempts and plans.
7. **First goal family:** observe remains design-only; no production template or end-to-end admissibility owner exists.
8. **Dispatcher/scheduler:** no production dispatch-start boundary is connected.
9. **Operations:** schema migration, backup/restore, corruption recovery, retention and audit-growth policy require review.

Memory → NPC remains disabled/fail-closed.

## Contract decisions still requiring confirmation

- Reconciliation increments plan_revision and plan_selection_revision because the current-plan pointer includes the plan revision. Confirm this interpretation against the contract before production wiring.
- A Core result currently advances only a verified step_succeeded outcome. Rejected, denied, rolled-back or invalidated results remain unresolved and must not be treated as progress.
- The adapter currently has no production method for rollback invalidation or for resolving a failed proposal attempt. Those require an explicit Core-owned recovery contract.

## Relationship to docs/99 §9

The user-directed sequence allowed a repository prototype immediately after the initial VFS registration spike. This branch implements that prototype without connecting it to production file storage or runtime callers.

Docs/99 §9 and docs/100 still govern production readiness: the first goal family, trusted decision context, action authorization, Core result/rollback handoff and secure SQLite open must be proven before the repository is wired into an autonomous NPC cycle.
