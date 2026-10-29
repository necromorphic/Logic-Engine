# NPC decision reconsideration trigger — isolated cognition slice

**Status:** isolated deterministic helper; no production invocation or persistence.  
**Purpose:** detect when a prior NPC decision needs to be reviewed because the caller reports a material change, while preserving the prior decision's rationale and conflict references.

## Scope

`src/npc/decision-reconsideration-evaluator.js` accepts a prior decision summary and a caller-prepared current-context change assessment. It classifies whether to request reconsideration, request review because the assessment is incomplete/ambiguous, or report no known material change.

It does not:
- authenticate evidence or change provenance/access rules;
- decide whether a source is true, trusted, or authorized;
- revise beliefs or replace the epistemic state machine in the cognition roadmap;
- choose a new option, rewrite the previous rationale, or resolve an internal conflict;
- persist history, call a model, execute actions, mutate canonical state, or advance world time;
- establish a production evidence-acquisition or caller path.

The caller must supply changes already assessed under its owning contracts. A source reference is traceability metadata, not proof of validity.

## Input contract

- `prior_decision`: stable decision ID, selected option ID, the context reference used for the decision, and references to the reasons and conflicts that informed it.
- `current_context`: a current snapshot/context reference, a completeness flag, and a list of changes.
- Each change has a unique ID, a supported change kind, a caller-assessed relevance (`relevant`, `irrelevant`, or `unknown`), and a source/reference identifier.

Supported change kinds: changed assumption, new evidence, changed feasibility, changed constraint, changed goal, changed conflict resolution, and observed outcome.

The helper deliberately does not infer relevance from raw text. The trusted caller must classify whether a change affects the prior decision.

## Outcomes

| Status | Meaning |
|---|---|
| `reconsideration_required` | At least one known change is marked relevant. Review the old decision against the current context; this helper does not choose a replacement. |
| `needs_review` | No known relevant change was supplied, but change relevance is unknown or the current assessment is incomplete. Do not assume the old decision is still valid. |
| `no_material_change` | The current assessment is marked complete and every supplied change is marked irrelevant (including when the change list is empty). This means only that the supplied assessment found no material change. |
| `non_ready` | Required fields, references, uniqueness, bounds, or input shape are invalid. The caller must stop and correct the input; `review_required` is conservatively `true` so invalid input cannot be mistaken for a safe no-review result. |

A known relevant change requests reconsideration even when other context is incomplete. The eventual decision must still be based on a newly prepared, authorized context.

## Preservation and history

Every valid result carries `preserved_prior_basis` with the original decision ID, selected option ID, prior context reference, reason references, and conflict references. The proposed review event repeats the prior decision/context identifiers and reason/conflict references. `trigger_change_ids` contains only changes marked `relevant`; `review_change_ids` contains changes marked `unknown`, which justify review but do not independently establish a material-change trigger.

This is an **event proposal**, not a persisted event. The owning state/history mechanism must decide whether and how to append it. The helper never overwrites the previous decision or claims that a new decision has been made. A later decision should have its own ID and reference the decision it supersedes; that lifecycle is outside this helper.

## Safety invariants

1. A new context does not retroactively rewrite the facts or reasons recorded for the old decision.
2. A known relevant change requests reconsideration; it does not dictate the new choice.
3. Unknown relevance and incomplete context are not treated as “no change.”
4. Source references do not authenticate the source or grant information access.
5. The helper does not revise beliefs, adjudicate truth, or implement the blocked information-acquisition stage.
6. No persistence, dispatch, Core mutation, Memory → NPC activation, or 3D/spatial behavior is added.
7. Malformed or ambiguous structural input fails closed as `non_ready`.

## Focused tests

Tests cover relevant and irrelevant changes, unknown relevance, incomplete context, preservation of the original decision basis, precedence of a known relevant change, malformed/duplicate references, sparse arrays, accessor-backed fields, and input immutability.

## Roadmap boundary

The cognition roadmap's belief-revision stage remains subject to its documented dependency on trusted information acquisition. This helper is only a decision-review trigger over caller-supplied assessments; it does not claim to implement that stage or unblock decision-context assembly.
