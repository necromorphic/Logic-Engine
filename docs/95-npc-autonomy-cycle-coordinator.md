# NPC autonomy cycle coordinator — isolated composition slice

**Status:** implemented pure helper; not wired into production orchestration.  
**Purpose:** compose the existing decision-review, plan-viability, internal-conflict, and intention-selection helpers into one ordered, fail-closed decision pass.

## Execution order

1. **Reconsider the prior decision** using `evaluateNpcDecisionReconsideration`.
   - A relevant change returns `reconsideration_required`.
   - Unknown relevance or incomplete assessment returns `review_required`.
   - Only `no_material_change` proceeds.
2. **Assess the active plan** using `assessNpcPlanViability`.
   - Only `continue` proceeds.
   - `blocked`, `reconsider`, `needs_review`, and `resume_candidate` return `plan_not_ready`.
   - A terminal plan returns `no_active_plan`.
   - In particular, `resume_candidate` is not an unblock transition.
3. **Classify internal motive conflicts** using `evaluateNpcInternalConflict`.
   - Every action candidate must have exactly one conflict option with the same ID; missing, duplicate, or extra option identities fail closed.
   - Only options classified `eligible` proceed to intention selection.
   - If no option is eligible and at least one requires review, the cycle returns `review_required`.
   - If eligible options coexist with review options, selection is restricted to the eligible subset and the result records `eligible_with_review_options`.
   - Hard-constraint violations, explicit infeasibility, and conflict rules that oppose an option exclude it before priority selection.
   - The evaluator does not choose a winner or authenticate the supplied assessments/rules.
4. **Select an intention** using `selectNpcIntention`.
   - Selection applies the existing active-goal, allowed-action, precondition, priority, cost, and stable-ID rules.
   - Only the selected goal/action identifiers are returned.

## Input

The caller supplies the exact existing contracts without new shared schemas:

- `prior_decision` and `current_context`: decision-reconsideration evaluator input;
- `plan` and `assessment`: plan-viability evaluator input;
- `conflict_assessment: { motives, options, resolutions }`: internal-conflict evaluator input;
- `goals`, `actions`, and optional `current_intention`: intention-selector input.

Each conflict option ID must equal one action candidate ID, with exact one-to-one coverage. An empty action set is a valid no-action result only when the conflict option set is also empty.

The coordinator does not interpret free text or infer missing data. Each underlying helper remains responsible for validating its own bounded input contract.

## Safety and ownership boundaries

- This is NPC-local composition, not a trusted caller or dispatcher.
- It does not generate goals, motives, plans, alternatives, or action candidates.
- It does not authenticate actor identity, evidence, assessments, action permissions, preconditions, or conflict-resolution rules.
- It does not read Core, Memory, Personality, Relationships, Host, or World Pack state.
- It does not persist state, schedule work, invoke a model, execute actions, create proposals, or commit world effects.
- An intention is not an action result or canonical event.
- Mandatory StoryBeat/checkpoint constraints remain owned by the authoritative story/world execution boundary. This helper cannot validate or bypass them.
- Memory → NPC remains independently disabled/fail-closed.

## Acceptance

The focused suite covers the ordered gates, relevant and unknown changes, incomplete context, contradicted assumptions, active blockers, incomplete assessments, blocked-plan resume candidates, terminal plans, hard-constraint exclusion, unresolved and explicitly resolved motive conflicts, partial conflict-review outcomes, exact action/option identity coverage, no eligible actions, malformed inputs, hostile reflection traps, and input immutability.

A passing unit suite proves only this deterministic composition helper. It does not establish end-to-end NPC autonomy or production readiness.
