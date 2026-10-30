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


### 10.1 Exact-head lifecycle audit

The current PR head was checked against the following concrete shapes and call sites:

- `src/npc/plan-progress.js::validatePlan(...)` accepts a plan identity, plan status, and ordered steps. Each step carries its own identity, `action_id`, and step status. The helper does not require or validate `goal_id`, a plan version, or a snapshot reference.
- `getNpcPlanActiveStep(...)` returns only the active step identity and `action_id`; it is a read-only projection.
- `advanceNpcPlan(...)` returns a copied plan after a caller-supplied progress event. It does not authenticate the outcome, compare an expected version, or persist the plan.
- `src/npc/autonomous-intention-selector.js::selectNpcIntention(...)` validates `action.goal_id` against the supplied goal list. That action-to-goal association does **not** establish a plan-to-goal association.
- `src/npc/autonomy-cycle.js::evaluateNpcAutonomyCycle(...)` emits `plan_revision_required` with `plan.id` and viability reason codes only. It does not claim that a replacement plan exists.
- No plan acceptance/replacement helper or NPC-owned durable plan store is present in the files changed by this PR. The generic Process Manager is not an NPC goal/plan store.

**Result:** the current implementation has enough contract surface to detect that a plan needs reconsideration, but not enough to safely construct, accept, or persist a replacement while proving that it serves the same goal and does not overwrite a newer plan. The next safe code change must not add guessed `goal_id` or `version` fields. The owning NPC-state contract must define those identities and transitions first, or the coordinator must remain at the bounded request/review stage.


### 10.2 Broader runtime-state ownership audit

The goal/plan gap is larger than two absent fields. The repository's own NPC readiness and roadmap documents confirm that a durable NPC goal/plan runtime has not been established:

- `docs/31-npc-subsystem-contract.md` defines goals and plans as NPC-domain state and requires plans to be revisable, but explicitly frames the document as semantic specification rather than runtime/storage authorization.
- `docs/33-npc-runtime-readiness-audit.md` records that no NPC-specific runtime record model or end-to-end autonomous decision cycle was verified. It also warns against creating parallel state, event, revision, permission, or rollback infrastructure.
- `docs/35-npc-test-boundary-map.md` marks runtime persistence tests as blocked until the real NPC state representation and Core production interfaces are mapped and available. Goals/plans surviving restart and rollback are listed as future acceptance targets, not existing guarantees.
- `docs/88-npc-cognition-development-roadmap.md` marks goal formation as partial (helpers exist; goal generation/admissibility source unverified), planning/replanning as partial (progress helper exists; persistence, invocation and authoritative outcomes unverified), and end-to-end integration as blocked.
- The generic Process Manager is implemented, but its contract is for world-scoped scheduled processes/milestones. It is not the NPC goal/plan owner, and it does not invoke NPC reasoning or establish plan identity/version semantics.

This resolves an important ambiguity: **there is currently no verified runtime owner to which a `goal_id` or plan version field can simply be added.** The semantic owner of goal/plan decisions is NPC; the durable state representation and its authoritative persistence/reconciliation seam remain unverified. Core's canonical world-state authority does not by itself prove that a particular NPC-local goal/plan storage contract exists.

### 10.3 Minimum contract decisions before adding runtime state

The next design step is not to add fields to `plan-progress.js`. It is to establish a single NPC-state contract, then map that contract to the approved durable owner:

1. **Identity and ownership**
   - A goal has a stable identity scoped to its owning NPC and world.
   - A plan has a stable identity in the same scope.
   - An explicit, validated association states which goal a plan serves; labels, matching text, or action references are not substitutes.
   - The contract defines whether one goal may have multiple candidate/current plans and how exactly one current plan is designated, if that is the chosen rule.
2. **Freshness and concurrency**
   - Every accepted state transition has a freshness basis that prevents a revision prepared from stale state from replacing a newer plan.
   - The owner defines the token semantics (monotonic revision, compare-and-swap token, or another already-supported mechanism); this proposal does not choose a representation.
   - Snapshot/world revision and NPC-local plan revision are distinct dimensions. A current world snapshot does not alone prove that the NPC plan has not changed concurrently.
3. **Revision lifecycle**
   - A revision candidate names the exact goal and plan it revises and the freshness basis used to create it.
   - Candidate creation is non-mutating.
   - Acceptance is an explicit transition by the owning NPC-state authority.
   - Acceptance atomically makes the candidate current and supersedes the prior plan without deleting its audit/history; rejection or stale input leaves the current plan untouched.
4. **Outcome reconciliation**
   - Step progress accepts only a result reference from the trusted action-result path, not a caller-supplied success assertion from the model.
   - Duplicate result delivery is idempotent; a result for an old plan/step cannot advance the replacement plan.
   - Rollback/replay behavior is defined by the owning canonical causal lifecycle; NPC code does not maintain a second causal log.
5. **Durability and recovery**
   - The owner defines what survives request boundaries, restart, interruption, and rollback.
   - The test boundary covers atomic acceptance, stale-candidate rejection, duplicate results, restart recovery, and rollback of dependent progress while preserving independent state.

Until those decisions map to an existing or separately approved runtime owner, executable goal-plan association, plan revision acceptance, version checks, and persistence remain blocked. The current pure helpers should stay schema-neutral and proposal-only.

### 10.4 Updated readiness

| Boundary | Finding | Status |
|---|---|---|
| Goal/plan semantic ownership | NPC subsystem owns the semantics | Specified |
| Goal/plan runtime representation | No verified production record model | Blocked |
| Plan-to-goal association | Not present in current plan helper; no alternate authoritative association verified | Blocked |
| Plan concurrency/version token | Not present in current plan helper; no alternate NPC-plan token verified | Blocked |
| Candidate acceptance/replacement | No NPC plan acceptance transition verified | Blocked |
| Durable persistence/restart | NPC goal/plan persistence not verified | Blocked |
| Trusted action result → plan progress | Reducer accepts caller-reported outcomes; trusted end-to-end route not verified | Blocked |
| Pure invalidation/revision request | Implemented and covered by PR tests | Available, bounded |

This is a source-level audit of the inspected documents and helper files. It does not claim that every repository branch or unmerged worktree was exhaustively inspected; any newly identified production implementation must be traced to its exact owner, code path, and tests before changing these statuses.


### 10.5 Cross-branch and open-PR check

Because NPC work is spread across unmerged branches, the audit also checked relevant branch heads and open PRs rather than treating `main` or this PR as the only source.

- `npc/isolated-autonomy-planner-20261028` contains the earlier intention-selector, goal-lifecycle, and plan-progress helpers/tests. Its diff against current `main` does not contain a separate planner, goal-plan store, goal-plan association, or acceptance/versioning mechanism. It is substantially behind and diverged from current `main`; it is not a missing implementation to merge blindly.
- `npc/plan-viability-review-20261028` contains the pure plan-viability helper and tests. It adds assessment of caller-supplied assumptions, blockers, and deadlines, not goal-plan persistence or revision acceptance.
- `npc/goal-generation-contract-proposal-20261028` changes the autonomy inventory document only. It does not contain goal-generation code.
- `docs/npc-cognition-skeleton-2026-10-28` adds cognition design documentation, including belief/actor-model/conflict semantics. It does not establish durable goal/plan runtime state.
- Open Draft PR #353 (`docs/npc-autonomy-story-kt-rules`) contains `src/npc/decision-kernel.js`, a pure prototype that selects a unique highest-preference candidate from caller-supplied `feasible/blocked/unknown` classifications. Its own source says it is not a production contract or executor. It does not accept goals, plans, goal-plan links, versions, or authoritative results. PR #353 is non-mergeable and remains Draft.
- Open Draft PR #769 adds a pure NPC epistemic reducer; its scope explicitly excludes goal/plan runtime, a production NPC caller, and Memory dispatch.
- Open Draft Core candidates #699/#702/#764 concern canonical acquisition/belief state, not NPC goal/plan ownership or plan acceptance. Their presence must not be treated as an implementation of the missing plan lifecycle.

**Cross-branch conclusion:** the relevant unmerged work adds cognition primitives, candidate ranking prototypes, epistemic reduction, or design proposals. The inspected branches/PRs do not supply the missing durable goal-plan contract. This is not a claim that every branch in the repository was exhaustively reviewed; it is a targeted check of branches and open PRs whose names, diffs, or scope directly relate to NPC autonomy, goal generation, planning, or cognition.

### 10.6 Implementation consequence

Do not add a new `goal_id` or `version` field to the pure helper simply because the current branch lacks it. First define the NPC-local state record and the authoritative durable owner, then port that contract onto the current mainline and test its real persistence/acceptance boundary. Avoid stacking a new implementation on the stale planner/helper branch or merging PR #353's prototype as if it supplied production planning.

The current PR's next safe contribution remains the bounded, pure revision request plus evidence-backed contract. A later runtime PR must be separately scoped to the owner-approved goal/plan state lifecycle; it cannot be inferred from the current coordinator.
