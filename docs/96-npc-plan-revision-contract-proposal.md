# NPC Plan Revision — Isolated Contract Proposal

**Status:** design proposal only. No runtime, API, schema, storage, Host, Core, Memory, Personality, or Relationships integration is authorized by this document.
**Scope:** NPC-local semantics for revising an existing plan while preserving its goal.
**Prerequisite:** the current plan contract does not contain a verified goal reference or revision/version reference. Those are unresolved contract requirements, not fields that this proposal claims already exist.

## 1. Purpose

When an existing plan becomes invalid, the NPC decision cycle must be able to request a revision without silently abandoning or replacing the underlying goal.

The existing assessNpcPlanViability(...) helper can classify a plan as reconsider when an assumption is contradicted or its deadline has passed. The autonomy-cycle coordinator now turns that disposition into a bounded plan_revision_required result containing the existing plan ID and reason codes.

That result is a request signal only. It does not revise the plan, generate actions, select a new goal, persist state, schedule work, or execute effects.

## 2. Confirmed ownership boundaries

- **NPC subsystem:** owns NPC-local goals, plans, tasks, intentions and the semantic decision to propose a revised plan.
- **Core:** owns canonical world state, game time, revisions, causal provenance, authorized reads, validation, proposal lifecycle, commit and rollback.
- **Personality / Relationships:** own their respective semantics. A complete NPC-facing runtime handoff is not currently confirmed.
- **Mechanic / domain owners:** own the semantics of domain-specific actions and their prerequisites.
- **Trusted caller:** must bind the acting NPC and bounded decision input to an appropriate authoritative snapshot. The exact composite caller remains unconfirmed.
- **Model output:** is a proposal, not proof of truth, permission, action success or a committed event.

No parallel world log, revision cursor, permission system, causal graph or authoritative knowledge store may be introduced by the NPC subsystem.

## 3. Existing evidence and gaps

| Capability | Existing evidence | Limit |
|---|---|---|
| Detect plan invalidation | assessNpcPlanViability(...) | Consumes caller-supplied assessments; does not authenticate their evidence. |
| Request reconsideration | evaluateNpcAutonomyCycle(...) returns plan_revision_required, plan_id and reason codes | Request is not a revised plan and has no goal reference or snapshot binding. |
| Read active step | getNpcPlanActiveStep(...) | Read-only; does not alter the plan. |
| Apply explicit step outcome | advanceNpcPlan(...) | Consumes caller-reported outcome; does not verify execution or rebuild the plan. |
| Preserve goal lifecycle | transitionNpcGoal(...) | Validates explicit lifecycle transitions; does not decide whether a goal should be replaced. |
| Select an action | selectNpcIntention(...) | Selects from supplied eligible goals/actions; does not discover candidates or verify their authority. |
| Evaluate a mechanic action | MechanicExecutor.evaluate(...) | Evaluates a caller-supplied action ID against a pinned mechanic template and same-snapshot context; does not enumerate NPC candidates or dispatch them. |
| Commit a world effect | Core proposal/approval/commit path | Generic path only; a complete NPC authorization-to-result-to-plan-reconciliation path is not established. |

## 4. Proposed revision boundary

A future NPC-only revision operation should accept a bounded input with the following conceptual parts:

1. **Existing goal reference** — a stable reference to the goal the plan serves. This must come from an authoritative NPC-local goal/plan association. The current plan shape does not prove such an association; do not infer it from text, action IDs or matching labels.
2. **Existing plan reference** — stable plan identity plus an explicit version/revision token if the owning NPC-local state contract provides one. The current plan helper exposes an ID but no verified concurrency/version contract.
3. **Revision trigger** — the existing viability reason codes and any additional typed, source-backed reason references. A reason code alone is not evidence.
4. **Bounded decision context** — the relevant current facts, uncertainties, constraints, available resources and time, each with source/provenance and access/completeness status supplied by a trusted caller. Missing information remains unknown; it is not converted into a negative fact.
5. **Permitted action vocabulary** — only action families with an identified semantic owner, candidate source, precondition evaluator, actor/action authorization and supported effect mapping. Until those are established, the revision may return needs_review rather than invent actions.

The revision operation may propose a new sequence of steps for the same goal. It must not mutate the current plan in place.

## 5. Required output semantics

A future revision result should distinguish:

- **revision_proposed** — a complete candidate plan is returned for the same explicit goal reference; it remains non-committing.
- **needs_review** — required evidence, goal linkage, action ownership, authorization or causal rationale is missing or ambiguous.
- **no_viable_path** — the supplied, adequately assessed constraints show no supported path; the goal remains unchanged and active/blocked according to an explicit goal-lifecycle decision, not by inference.
- **stale_input** — the goal/plan/snapshot basis changed while revision was being prepared; discard the candidate and reassess from current authoritative state.
- **non_ready** — malformed or incomplete contract input.

A proposed candidate must carry, at minimum, the same goal reference, the existing plan reference it revises, its basis/snapshot reference, explicit assumptions and blockers, and an ordered set of typed steps. These are proposed semantic requirements, not existing production fields.

The existing plan must remain the authoritative NPC-local plan until a separately defined NPC-local acceptance transition accepts the candidate. A rejected or stale candidate must not erase the old plan or the goal. Acceptance must not itself execute an action or commit a world effect.

## 6. Safety and continuity rules

1. A failed plan does not automatically fail, abandon or replace its goal.
2. A revised plan must retain the exact goal reference unless an explicit, separately authorized goal-lifecycle decision changes it.
3. Do not fabricate past events, evidence, promises, capabilities, relationships, hidden motives or resource availability to make a candidate plan appear feasible.
4. Do not use model confidence or fluent rationale as evidence.
5. Unknown or inaccessible facts remain unknown/withheld. A missing reference is not proof of absence.
6. Do not treat a proposed step as an eligible action. Each action still requires a trusted candidate source, precondition evaluation and actor/action authorization.
7. Do not treat intention selection as dispatch, execution or commit.
8. Plan progress may be reconciled only from an authoritative result or an explicitly trusted adjudication path; a model's claim that an action succeeded is insufficient.
9. If a source event is rolled back, dependent plan assumptions and progress must be reconsidered according to actual causal dependencies. The NPC subsystem must not implement a parallel rollback system.
10. Do not author the player's voluntary actions, dialogue, thoughts, feelings, consent or unprovided reactions as steps in an NPC plan.

## 7. Acceptance scenarios for a future implementation

- A contradicted assumption requests revision while retaining the same goal reference.
- A passed deadline requests revision while retaining the same goal reference.
- An active blocker does not automatically become a revision request if the viability contract classifies it as blocked.
- A revised candidate cannot be accepted if its goal reference differs from the original.
- A missing or ambiguous goal-plan association returns needs_review.
- An unknown or inaccessible fact cannot be used as a satisfied precondition.
- A candidate based on a stale snapshot is rejected and requires reassessment.
- A revision with no supported action family returns needs_review or no_viable_path, not invented steps.
- Rejecting a candidate leaves the existing goal and plan unchanged.
- Accepting a candidate changes only NPC-local plan state; it does not dispatch or commit actions.
- Only authoritative action outcomes advance plan progress.
- Rollback of a causal prerequisite triggers dependent plan reassessment without indiscriminately deleting independent progress.

## 8. Decisions required before implementation

1. **Goal-plan linkage:** where is the authoritative association stored, and which owner may create/change it? The current plan contract has no verified goal_id.
2. **Plan versioning:** what existing NPC-local concurrency/version mechanism prevents a revision candidate from replacing a newer plan? None was verified in the inspected helpers.
3. **First action family:** which concrete action family is in scope for the first vertical slice?
4. **Candidate and authorization owners:** which existing component supplies candidates, evaluates preconditions and verifies the acting NPC's authority for that action family?
5. **Context owner:** which trusted caller assembles actor-relative context and binds it to the relevant snapshot, including completeness, visibility and provenance?
6. **Acceptance owner:** what explicit NPC-local transition accepts a proposed replacement plan while preserving the old plan until acceptance?
7. **Result reconciliation:** which trusted path reports authoritative success/failure to the NPC plan-progress reducer?

Until these questions have evidence-backed answers, this proposal authorizes no executable revision engine, goal-plan schema change, storage, scheduler, model dispatch, action dispatch or Core integration.

## 9. Source basis

- docs/31-npc-subsystem-contract.md — NPC ownership, goal/plan semantics, plan revisability, off-screen autonomy and player-agency boundaries.
- docs/80-npc-autonomy-contract-inventory-proposal.md — existing source ownership and unconfirmed integration gaps.
- docs/81-npc-goal-action-contracts-proposal.md — isolated design boundary and blocked trusted caller/action authorization.
- docs/34-npc-decision-context-and-proposal.md — trusted context, actor-relative access, snapshot and non-committing proposal limits.
- src/npc/plan-viability.js — pure plan viability assessment.
- src/npc/plan-progress.js — pure plan-step progression and active-step read.
- src/npc/goal-lifecycle.js — explicit NPC-local goal lifecycle transitions.
- src/npc/autonomous-intention-selector.js — selection from caller-supplied eligible goals/actions.
- src/npc/autonomy-cycle.js — bounded composition and plan-revision request signal.
- src/mechanics/mechanic-executor.js and its tests — bounded mechanic-action evaluation seam; not NPC action discovery or dispatch.
- docs/22-process-manager-runtime.md — generic process lifecycle and explicit-time limitations; not an NPC decision scheduler.

This proposal is based on the inspected repository contracts and source. Unverified production handoffs remain unconfirmed rather than inferred.


## 10. Sequencing decision — action-family-independent plan revision first (2026-10-30)

The first implementation slice for this work is **NPC-local plan-revision continuity**, not a world action family. This is the most useful next step because the current branch already has executable plan-viability classification and a tested, bounded `plan_revision_required` signal. It can be hardened without inventing movement, communication, observation, or object-interaction semantics.

A concrete movement action was considered as the first semantic action family, but the repository evidence does not support implementing it safely yet:

- `src/core/mechanic-effect-translator.js` currently executes only `create_entity`, `update_attribute`, and `assert_fact` intents. A generic attribute update is not a movement contract and does not define location, reachability, route validity, obstacles, or movement outcomes.
- `src/application/mechanic-executor.js` requires the caller to supply an exact `instanceId` and `actionId`; it does not discover NPC movement candidates or establish NPC-specific action authorization.
- `docs/81-npc-goal-action-contracts-proposal.md` records that no production World Pack/mechanic template with a semantically defined NPC action was identified in the reviewed paths. Its `wait` action is explicitly a test fixture that creates a character, not a production wait or movement action.
- No verified NPC dispatcher currently binds a trigger, acting NPC, trusted snapshot context, action candidate, authorization decision, and authoritative result into one path.

Therefore movement remains a sensible later action family, but selecting it now would create pressure to invent unsupported domain contracts. The current PR will first finish the NPC-owned continuity boundary: detect invalidation, issue a plan-scoped revision request, preserve the existing goal/plan until a separately defined acceptance transition, and fail closed when goal linkage or version freshness cannot be established.

### Work order

1. Keep the current `plan_revision_required` output as a request signal only; do not represent it as a rebuilt plan.
2. Complete the source/contract audit for goal-plan association, plan versioning, candidate acceptance, and authoritative result reconciliation.
3. Add executable behavior only where the existing NPC-local contracts provide enough identity and freshness guarantees. If not, retain an explicit `needs_review` boundary rather than add guessed fields.
4. After that boundary is stable, select the first production action template and trace its domain semantics, preconditions, actor authorization, effect mapping, and committed-result route. Movement is the provisional candidate, not an approved executable action.
5. Keep Core, Host, Memory, Personality, Relationships, scheduler, storage, and dispatch integration out of this PR unless separately approved.

This sequencing choice resolves the first-slice selection for the current work. It does not authorize plan persistence, candidate generation, action dispatch, world mutation, or PR merge.
