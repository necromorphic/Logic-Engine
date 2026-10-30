# NPC autonomy cycle coordinator — isolated composition slice

**Status:** implemented pure helper; not wired into production orchestration.  
**Purpose:** compose the existing NPC decision-review, plan-viability, and intention-selection helpers into one ordered, fail-closed decision pass.

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
3. **Select an intention** using `selectNpcIntention`.
   - Returns `intention_selected`, `no_eligible_action`, or `non_ready`.
   - Only the selected goal/action identifiers are returned.

## Input

The caller supplies the exact existing contracts without new shared schemas:

- `prior_decision` and `current_context`: decision-reconsideration evaluator input;
- `plan` and `assessment`: plan-viability evaluator input;
- `goals`, `actions`, and optional `current_intention`: intention-selector input.

The coordinator does not interpret free text or infer missing data. Each underlying helper remains responsible for validating its own bounded input contract.

## Safety and ownership boundaries

- This is NPC-local composition, not a trusted caller or dispatcher.
- It does not generate goals, motives, plans, alternatives, or action candidates.
- It does not authenticate actor identity, evidence, assessments, action permissions, or preconditions.
- It does not read Core, Memory, Personality, Relationships, Host, or World Pack state.
- It does not persist state, schedule work, invoke a model, execute actions, create proposals, or commit world effects.
- An intention is not an action result or canonical event.
- Mandatory StoryBeat/checkpoint constraints remain owned by the authoritative story/world execution boundary. This helper cannot validate or bypass them.
- Memory → NPC remains independently disabled/fail-closed.

## Acceptance

The focused suite covers the ordered gates, relevant and unknown changes, incomplete context, contradicted assumptions, active blockers, incomplete assessments, blocked-plan resume candidates, terminal plans, no eligible actions, malformed inputs, hostile reflection traps, and input immutability.

A passing unit suite proves only this deterministic composition helper. It does not establish end-to-end NPC autonomy or production readiness.
