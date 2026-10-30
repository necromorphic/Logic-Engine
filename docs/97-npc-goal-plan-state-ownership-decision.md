# NPC Goal and Plan State — Ownership Decision and Store Contract

**Status:** accepted architecture decision; contract baseline for design.
**Date:** 2026-10-30.
**Implementation status:** not implemented. This document does not authorize runtime, API, schema, database, Host, Memory, scheduler, dispatch, or Core changes.
**Scope:** ownership and integration boundary for durable NPC-local goals and plans.

## 1. Decision

Adopt **A1 — NPC-owned local persistence**.

The NPC subsystem owns the domain meaning and lifecycle of each NPC's goals and plans. A dedicated NPC-local persistence boundary stores that state independently of Core's canonical world-state storage.

This is an ownership decision, not a decision about a particular database engine, file format, or deployment topology. The NPC subsystem must access persistence through its own repository/store interface; cognition code must not issue direct SQL or access Core's SQLite connection.

A future move to Core-backed physical storage (A2) requires a separate architecture decision. It must preserve the ownership and authority boundaries in this document; sharing a database file must not make Core the semantic owner of NPC plans.

## 2. Authority model

There are two distinct authoritative domains:

| Domain | Owner | Authority |
|---|---|---|
| NPC cognition state | NPC subsystem | Goals, plans, plan revisions, task progress, NPC-local lifecycle and revision audit |
| Canonical world state | Core | World facts, entities, time, canonical events, causal provenance, revisions, authorization, validation, approval, commit and rollback |

NPC-local state is authoritative **within the NPC domain**. It is not canonical world state and cannot establish that a world action occurred.

Core is not the owner of goal meaning, plan selection, plan revision, or NPC-local plan lifecycle. The NPC subsystem is not the owner of canonical world mutation, world revision, causal history, permissions, or commit.

The store is not a second world-state database, event log, causality graph, rollback engine, permission system, or authoritative knowledge/acquisition store.

## 3. NPC-local records

The NPC-local store may persist, subject to a later concrete schema contract:

- stable NPC identity/reference;
- stable goal identity and goal-domain state;
- stable plan identity and its association with exactly one goal;
- plan revision/version and goal revision/version;
- ordered plan steps and their NPC-local progress state;
- current-plan selection and supersession/closure history;
- typed revision reasons, assumptions and blockers;
- references to the trusted world snapshot used to assess or propose a plan;
- references to authoritative Core outcomes used to reconcile plan progress;
- append-only audit entries for accepted, rejected, superseded, closed, blocked, and reconciled transitions.

A goal or plan record must not duplicate canonical world facts as if the duplicate were authoritative. It may retain bounded references, assumptions, and provenance needed to explain a decision; current world facts must be reacquired through Core.

The existing plan helper's shape does not yet establish a goal-plan link or version token. This document does not silently add a goal_id, version, or any other production field. Their exact schema and migration remain a later contract task.

## 4. Plan lifecycle and acceptance

1. A generated or revised plan is a **candidate**, not the current plan.
2. Candidate creation must not mutate the current plan or goal.
3. A candidate must identify the exact goal and current plan revision it is intended to serve/replace.
4. Acceptance is an NPC-domain transition owned by the NPC subsystem and persisted atomically by the NPC-local store.
5. Acceptance must verify the goal association and expected goal/plan revisions. If any expected revision is stale, reject the candidate and require reassessment.
6. On acceptance, the new plan becomes current and the prior plan becomes superseded in the same atomic store transaction. The goal is unchanged unless a separate explicit goal-lifecycle transition authorizes a change.
7. Rejection, expiry, or staleness of a candidate must not erase the current plan or goal.
8. Closing, abandoning, completing, blocking, and superseding are distinct semantic outcomes. Their exact enum mapping must be reconciled with existing helper statuses before schema/API work; do not overload one status to mean several outcomes.

A plan acceptance transition does not dispatch an action, advance game time, or commit a world effect.

## 5. Core integration boundary

The intended interaction is:

    NPC cognition
        | load/save NPC-domain records
        v
    NPC-local Store
        | bounded request for current world context
        v
    Core AuthorizedReadService
        | actor-scoped, authorized, version-bound context
        v
    NPC cognition evaluates / revises / proposes
        | action proposal (not an event)
        v
    Existing Core proposal -> approval -> commit path
        | authoritative committed/rejected result
        v
    NPC reconciliation
        | atomic NPC-local progress/revision update
        v
    NPC-local Store

Rules:

- Core supplies trusted, actor-scoped, access-filtered context and the exact world snapshot/version basis. Missing, inaccessible, incomplete, or ambiguous information remains unknown or withheld.
- NPC cognition decides what a goal or plan means and whether to propose a revision. Core does not make those domain decisions.
- A plan step is not an authorized action merely because it appears in an accepted plan.
- Every world-affecting action still requires the existing authorization, validation, proposal, approval, and Core commit path.
- The NPC-local store must not mark a world action as successful based on model text, intention selection, dispatch attempt, or an unverified caller claim.
- Plan progress is reconciled only from an authoritative Core result or an explicitly trusted adjudication path.
- A Core result reference is evidence for reconciliation; it does not transfer ownership of the plan to Core.
- NPC cognition must not write directly to Core SQLite or mutate canonical world state.

## 6. Versioning and concurrency

The future store contract must keep these version dimensions distinct:

- **NPC goal revision:** changes to the goal's own domain state.
- **NPC plan revision:** changes to the plan and its ordered steps/current status.
- **NPC store transaction/version:** concurrency boundary for atomic local writes.
- **Core world snapshot cursor:** the exact canonical world revision/commit sequence used as decision context, when provided by Core.
- **Schema version:** persistence format compatibility; it is not a freshness token.

No one version may be substituted for another. A fresh NPC plan revision does not prove that its world assumptions are current, and a current Core snapshot does not prove that the NPC plan has not concurrently changed.

Candidate acceptance must use compare-and-swap/expected-version semantics over the relevant NPC goal and plan revisions. A stale candidate is rejected; it is never silently rebased or overwritten.

## 7. Restart and recovery

After restart:

1. Load NPC-local goals, current plans, revision history, and pending reconciliation references from the NPC-local store.
2. Treat the stored plan as NPC-domain state, not proof that its assumptions still hold in the world.
3. Reacquire the required actor-scoped world context through Core.
4. Compare the current trusted context with the plan's recorded snapshot basis and assumptions.
5. Reassess stale, unknown, inaccessible, or contradicted assumptions before allowing a plan step to proceed.
6. Reconcile only outcomes with verifiable Core result references and idempotency identity.

Recovery must never replay a plan step or repeat a world effect merely because the local store did not record a completed reconciliation before the process stopped. The Core commit/result identity is the deduplication anchor; a repeated result must not advance the same step twice.

If the store is unavailable, corrupt, or cannot prove the relevant record/version, the NPC plan path fails closed (needs_review/non-ready). It must not fabricate an empty goal set, reset progress, or infer that no plan exists.

## 8. Rollback and causal reconciliation

Core remains the sole owner of canonical rollback and causal invalidation.

When Core invalidates or rolls back a world event, the NPC subsystem may receive or request the relevant invalidation/result references and reassess only the NPC-local assumptions and progress that depend on them.

- Do not implement a parallel rollback engine in the NPC store.
- Do not indiscriminately delete a goal or plan because one supporting event was rolled back.
- Preserve independent progress and alternative valid evidence.
- Mark affected assumptions/progress for reassessment when dependency cannot be established.
- A plan step previously reconciled from an invalidated result must be reconsidered under the NPC-local lifecycle contract; it must not be silently treated as permanently successful.
- Missing causal linkage fails closed and requires review rather than speculative repair.

The exact Core-to-NPC invalidation delivery/reconciliation interface is not yet verified and remains an integration dependency.

## 9. Security and trust requirements

- NPC-local persistence is not an authorization boundary for world actions.
- Store reads/writes must be scoped to the acting NPC and authorized runtime caller.
- Model-generated identifiers, versions, outcome claims, and provenance are untrusted until validated by the owning boundary.
- Candidate acceptance must validate exact goal/plan identity and expected revisions; it must not trust model-supplied current flags.
- Core snapshot references and committed-result references must be validated by Core-facing adapters, not accepted as arbitrary strings.
- Unknown actor identity, missing authority, stale context, ambiguous goal-plan association, or unverifiable outcome must fail closed.

## 10. Explicit non-goals

This decision does not authorize:

- moving goals/plans into Core canonical tables or Core's SQLite store;
- using Process Manager as the NPC planner or as the default NPC goal/plan repository;
- creating a parallel NPC world-event log, world revision counter, causal graph, or rollback engine;
- adding model invocation, prompt construction, autonomous scheduling, off-screen dispatch, or action execution;
- defining a production movement, communication, observation, or interaction action family;
- changing the existing plan schema/helpers before the identity/version contract is specified;
- changing Memory, Personality, Relationships, Host, or SillyTavern integration;
- implementing backup/restore or a specific storage technology.

## 11. Required follow-up contract work

Before implementation, specify and test:

1. Stable NPC, goal, plan, and step identity formats and ownership.
2. Authoritative goal-plan association and its mutation rules.
3. Goal and plan revision/version semantics, including atomic compare-and-swap.
4. Candidate states and the exact atomic acceptance/supersession transaction.
5. Mapping of current helper statuses to active, blocked, completed, abandoned, superseded, and closed semantics.
6. NPC-local repository interface and transaction guarantees, without exposing raw database access to cognition.
7. Trusted Core context request/response shape, actor binding, completeness/visibility/provenance, and snapshot cursor.
8. Action proposal binding to NPC, goal, plan revision, step, and world snapshot.
9. Authoritative Core result envelope, idempotency identity, and NPC progress reconciliation.
10. Rollback/invalidation handoff and dependency-aware plan reassessment.
11. Restart recovery, interrupted-write behavior, corruption/unavailable-store behavior, and migration strategy.
12. Acceptance tests for concurrent revisions, stale candidates, duplicate results, restart between commit and reconciliation, rollback of dependent progress, and preservation of independent progress.

Until these items are defined against real repository interfaces, the implementation remains blocked. The current pure autonomy-cycle and plan-progress helpers remain non-persistent and non-dispatching.

## 12. Source basis

- docs/00-architecture-baseline.md — canonical world authority, time, causality, and NPC autonomy boundaries.
- docs/31-npc-subsystem-contract.md — NPC ownership of goals/plans and separation of proposal from committed event.
- docs/33-npc-runtime-readiness-audit.md and docs/35-npc-test-boundary-map.md — missing NPC runtime persistence and blocked integration tests.
- docs/96-npc-plan-revision-contract-proposal.md — existing revision request boundary and unresolved goal linkage, versioning, acceptance, and result reconciliation.
- src/npc/autonomy-cycle.js and src/npc/plan-progress.js — current pure, non-persistent NPC decision/progress helpers.
- src/application/mechanic-executor.js and the Core proposal/approval/commit contracts — existing action evaluation and canonical commit boundary; not a complete NPC dispatcher.

This document records an architecture decision and a contract baseline. It does not claim that any of the proposed persistence or integration capabilities already exist.
